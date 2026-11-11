import { Injectable, Logger } from '@nestjs/common';

import { IntegrationJob, IntegrationJobType } from '@prisma/client';

import { randomUUID } from 'crypto';

import { AppointmentCalendarSyncService } from '../google-calendar/appointment-calendar-sync.service';

import { IntegrationJobsService, MAX_BATCH_SIZE } from './integration-jobs.service';

const GOOGLE_CALENDAR_JOB_TYPES: IntegrationJobType[] = [
  IntegrationJobType.GOOGLE_CALENDAR_CREATE,
  IntegrationJobType.GOOGLE_CALENDAR_UPDATE,
  IntegrationJobType.GOOGLE_CALENDAR_DELETE,
];

const DEFAULT_PROCESS_BATCH_SIZE = 10;

const DEFAULT_LOCK_HEARTBEAT_MS = 60_000;

const MIN_LOCK_HEARTBEAT_MS = 5_000;

type ProcessedJobResult = {
  jobId: string;

  jobType: IntegrationJobType;

  entityType: string;

  entityId: string;

  outcome: 'COMPLETED' | 'RETRY_SCHEDULED' | 'FAILED' | 'UNCONFIRMED';

  attempts: number;

  error?: string;
};

class JobLockLostError extends Error {}

@Injectable()
export class IntegrationJobsProcessor {
  private readonly workerId = `integration-worker-${process.pid}-${randomUUID()}`;

  private readonly logger = new Logger(IntegrationJobsProcessor.name);

  private readonly lockHeartbeatMs: number;

  constructor(
    private readonly integrationJobsService: IntegrationJobsService,

    private readonly appointmentCalendarSyncService: AppointmentCalendarSyncService,
  ) {
    this.lockHeartbeatMs = Math.min(
      this.readLockHeartbeatMs(),
      Math.floor(this.integrationJobsService.workerLockTimeoutMs / 3),
    );
  }

  /* ─────────────────────────────────────────────
     PROCESS BATCH
  ───────────────────────────────────────────── */

  async processBatch(limit = DEFAULT_PROCESS_BATCH_SIZE, shouldContinue = () => true) {
    const recovery = await this.integrationJobsService.recoverStaleJobs();
    for (const job of recovery.failedJobs) {
      this.logger.warn(`job=${job.id} type=${job.jobType} outcome=FAILED error=${job.lastError}`);
    }

    const results: ProcessedJobResult[] = [];
    const batchSize = Math.min(Math.max(Math.trunc(limit), 1), MAX_BATCH_SIZE);

    for (let index = 0; index < batchSize && shouldContinue(); index++) {
      const lockOwner = `${this.workerId}:${randomUUID()}`;
      const [job] = await this.integrationJobsService.claimNextJobs({
        workerId: lockOwner,
        limit: 1,
        jobTypes: GOOGLE_CALENDAR_JOB_TYPES,
        requireActiveWorkspace: true,
      });

      if (!job) break;

      results.push(await this.processClaimedJob(job, lockOwner));
    }

    return {
      workerId: this.workerId,

      recoveredStaleJobs: recovery.recoveredJobs,

      claimedJobs: results.length,

      completedJobs: results.filter((result) => result.outcome === 'COMPLETED')
        .length,

      retryScheduledJobs: results.filter(
        (result) => result.outcome === 'RETRY_SCHEDULED',
      ).length,

      failedJobs: results.filter((result) => result.outcome === 'FAILED')
        .length,

      unconfirmedJobs: results.filter((result) => result.outcome === 'UNCONFIRMED')
        .length,

      results,

      processedAt: new Date(),
    };
  }

  /* ─────────────────────────────────────────────
     PROCESS ONE
  ───────────────────────────────────────────── */

  private async processClaimedJob(
    job: IntegrationJob,
    lockOwner: string,
  ): Promise<ProcessedJobResult> {
    try {
      await this.executeJobWithHeartbeat(job, lockOwner);

      const completed = await this.integrationJobsService.markCompleted({
        jobId: job.id,

        workerId: lockOwner,
      });

      return {
        jobId: completed.id,

        jobType: completed.jobType,

        entityType: completed.entityType,

        entityId: completed.entityId,

        outcome: 'COMPLETED',

        attempts: completed.attempts,
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);

      try {
        if (error instanceof JobLockLostError) throw error;

        const failed = await this.integrationJobsService.markFailed({
          jobId: job.id,

          workerId: lockOwner,

          error: errorMessage,
        });

        return {
          jobId: failed.id,

          jobType: failed.jobType,

          entityType: failed.entityType,

          entityId: failed.entityId,

          outcome: failed.status === 'FAILED' ? 'FAILED' : 'RETRY_SCHEDULED',

          attempts: failed.attempts,

          error: errorMessage,
        };
      } catch (transitionError) {
        return {
          jobId: job.id,

          jobType: job.jobType,

          entityType: job.entityType,

          entityId: job.entityId,

          outcome: 'UNCONFIRMED',

          attempts: job.attempts,

          error: error === transitionError
            ? errorMessage
            : `${errorMessage} Error al actualizar estado del job: ${this.getErrorMessage(transitionError)}`,
        };
      }
    }
  }

  /* ─────────────────────────────────────────────
     DISPATCHER
  ───────────────────────────────────────────── */

  private async executeJob(job: IntegrationJob) {
    if (job.entityType !== 'APPOINTMENT') {
      throw new Error(
        `Entity type no soportado para Google Calendar: ${job.entityType}`,
      );
    }

    switch (job.jobType) {
      case IntegrationJobType.GOOGLE_CALENDAR_CREATE:
        await this.appointmentCalendarSyncService.syncCreate(
          job.businessId,
          job.entityId,
        );

        return;

      case IntegrationJobType.GOOGLE_CALENDAR_UPDATE:
        await this.appointmentCalendarSyncService.syncUpdate(
          job.businessId,
          job.entityId,
        );

        return;

      case IntegrationJobType.GOOGLE_CALENDAR_DELETE:
        await this.appointmentCalendarSyncService.syncDelete(
          job.businessId,
          job.entityId,
        );

        return;

      default:
        throw new Error(
          `Integration job type no soportado por este processor: ${job.jobType}`,
        );
    }
  }

  /* ─────────────────────────────────────────────
   LOCK HEARTBEAT
───────────────────────────────────────────── */

  private async executeJobWithHeartbeat(job: IntegrationJob, lockOwner: string) {
    let stopped = false;
    let lockLost = false;
    let timer: NodeJS.Timeout | undefined;
    let renewal: Promise<void> | undefined;

    const schedule = () => {
      timer = setTimeout(() => {
        renewal = renew();
      }, this.lockHeartbeatMs);
      timer.unref();
    };

    const renew = async () => {
      try {
        const { refreshed } = await this.integrationJobsService.refreshLock({
          jobId: job.id,
          workerId: lockOwner,
        });
        lockLost = !refreshed;
      } catch (error) {
        this.logger.warn(
          `No se pudo renovar el lock del job ${job.id}: ${this.getErrorMessage(error)}`,
        );
      }

      if (!stopped && !lockLost) {
        schedule();
      }
    };

    schedule();
    try {
      await this.executeJob(job);
    } finally {
      stopped = true;
      clearTimeout(timer);
      await renewal;

      if (lockLost) {
        throw new JobLockLostError(`El job ${job.id} perdió su lock durante la ejecución`);
      }
    }
  }

  private readLockHeartbeatMs() {
    const raw = process.env.INTEGRATION_JOBS_LOCK_HEARTBEAT_MS;

    if (!raw) {
      return DEFAULT_LOCK_HEARTBEAT_MS;
    }

    const parsed = Number.parseInt(raw, 10);

    if (!Number.isInteger(parsed) || parsed < MIN_LOCK_HEARTBEAT_MS) {
      return DEFAULT_LOCK_HEARTBEAT_MS;
    }

    return parsed;
  }

  /* ─────────────────────────────────────────────
     ERROR HELPERS
  ───────────────────────────────────────────── */

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return 'Error desconocido procesando IntegrationJob';
    }
  }
}
