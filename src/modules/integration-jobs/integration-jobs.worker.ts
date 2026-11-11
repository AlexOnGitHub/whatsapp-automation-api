import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';

import { IntegrationJobsProcessor } from './integration-jobs.processor';

@Injectable()
export class IntegrationJobsWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(IntegrationJobsWorker.name);

  private timer: NodeJS.Timeout | null = null;

  private running = false;

  private shuttingDown = false;

  private readonly enabled: boolean;

  private readonly pollIntervalMs: number;

  private readonly batchSize: number;

  private readonly shutdownTimeoutMs = this.readPositiveIntegerEnvironmentVariable(
    'INTEGRATION_JOBS_SHUTDOWN_TIMEOUT_MS',
    30_000,
  );

  private currentCycle: Promise<void> | null = null;

  constructor(private readonly processor: IntegrationJobsProcessor) {
    this.enabled = this.readBooleanEnvironmentVariable(
      'INTEGRATION_JOBS_WORKER_ENABLED',
      true,
    );

    this.pollIntervalMs = this.readPositiveIntegerEnvironmentVariable(
      'INTEGRATION_JOBS_WORKER_POLL_INTERVAL_MS',
      5000,
    );

    this.batchSize = this.readPositiveIntegerEnvironmentVariable(
      'INTEGRATION_JOBS_WORKER_BATCH_SIZE',
      10,
    );
  }

  /* ─────────────────────────────────────────────
     APPLICATION LIFECYCLE
  ───────────────────────────────────────────── */

  onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log('Integration Jobs Worker deshabilitado.');

      return;
    }

    this.logger.log(
      [
        'Integration Jobs Worker iniciado.',
        `pollIntervalMs=${this.pollIntervalMs}`,
        `batchSize=${this.batchSize}`,
      ].join(' '),
    );

    this.scheduleNextRun(0);
  }

  async onModuleDestroy() {
    this.shuttingDown = true;

    if (this.timer) {
      clearTimeout(this.timer);

      this.timer = null;
    }

    if (this.currentCycle) {
      let deadline: NodeJS.Timeout | undefined;
      try {
        const drained = await Promise.race([
          this.currentCycle.then(() => true),
          new Promise<false>((resolve) => {
            deadline = setTimeout(() => resolve(false), this.shutdownTimeoutMs);
          }),
        ]);
        if (!drained) {
          this.logger.warn('Se agotó el plazo de apagado. El job se recuperará cuando venza su lock.');
        }
      } finally {
        clearTimeout(deadline);
      }
    }

    this.logger.log('Integration Jobs Worker detenido.');
  }

  /* ─────────────────────────────────────────────
     WORKER LOOP
  ───────────────────────────────────────────── */

  private scheduleNextRun(delayMs: number) {
    if (!this.enabled || this.shuttingDown) {
      return;
    }

    this.timer = setTimeout(() => {
      this.currentCycle = this.runCycle();

      void this.currentCycle.finally(() => {
        this.currentCycle = null;
      });
    }, delayMs);

    this.timer.unref();
  }

  private async runCycle() {
    if (this.running || this.shuttingDown) {
      return;
    }

    this.running = true;

    try {
      const result = await this.processor.processBatch(
        this.batchSize,
        () => !this.shuttingDown,
      );

      for (const job of result.results) {
        if (job.outcome === 'FAILED' || job.outcome === 'UNCONFIRMED') {
          this.logger.warn(`job=${job.jobId} type=${job.jobType} outcome=${job.outcome} attempts=${job.attempts} error=${job.error}`);
        }
      }

      if (result.claimedJobs > 0 || result.recoveredStaleJobs > 0) {
        this.logger.log(
          [
            `workerId=${result.workerId}`,
            `claimed=${result.claimedJobs}`,
            `completed=${result.completedJobs}`,
            `retryScheduled=${result.retryScheduledJobs}`,
            `failed=${result.failedJobs}`,
            `unconfirmed=${result.unconfirmedJobs}`,
            `recoveredStale=${result.recoveredStaleJobs}`,
          ].join(' '),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Falló el ciclo del Integration Jobs Worker: ${message}`,
        stack,
      );
    } finally {
      this.running = false;

      if (!this.shuttingDown) {
        this.scheduleNextRun(this.pollIntervalMs);
      }
    }
  }

  /* ─────────────────────────────────────────────
     ENV HELPERS
  ───────────────────────────────────────────── */

  private readBooleanEnvironmentVariable(key: string, defaultValue: boolean) {
    const raw = process.env[key];

    if (raw === undefined) {
      return defaultValue;
    }

    const normalized = raw.trim().toLowerCase();

    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }

    this.logger.warn(
      `${key} tiene un valor inválido "${raw}". Se utilizará ${defaultValue}.`,
    );

    return defaultValue;
  }

  private readPositiveIntegerEnvironmentVariable(
    key: string,
    defaultValue: number,
  ) {
    const raw = process.env[key];

    if (!raw) {
      return defaultValue;
    }

    const parsed = Number.parseInt(raw, 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      this.logger.warn(
        `${key} tiene un valor inválido "${raw}". Se utilizará ${defaultValue}.`,
      );

      return defaultValue;
    }

    return parsed;
  }
}
