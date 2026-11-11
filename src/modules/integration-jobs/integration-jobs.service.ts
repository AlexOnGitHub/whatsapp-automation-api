import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  IntegrationJob,
  IntegrationJobStatus,
  IntegrationJobType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';

import { BusinessesService } from '../businesses/businesses.service';

import { EnqueueIntegrationJobDto } from './dto/enqueue-integration-job.dto';

type ClaimJobsParams = {
  workerId: string;
  limit?: number;
  jobTypes?: IntegrationJobType[];
  requireActiveWorkspace?: boolean;
};

type CompleteJobParams = {
  jobId: string;
  workerId: string;
};

type FailJobParams = {
  jobId: string;
  workerId: string;
  error: string;
};

const DEFAULT_BATCH_SIZE = 10;

export const MAX_BATCH_SIZE = 50;

const DEFAULT_MAX_ATTEMPTS = 5;

const BASE_RETRY_DELAY_MS = 30_000;

const MAX_RETRY_DELAY_MS = 30 * 60 * 1000;

const DEFAULT_WORKER_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

const MIN_WORKER_LOCK_TIMEOUT_MS = 30_000;

const STALE_RECOVERY_RETRY_DELAY_MS = BASE_RETRY_DELAY_MS;

@Injectable()
export class IntegrationJobsService {
  readonly workerLockTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,

    private readonly businessesService: BusinessesService,
  ) {
    this.workerLockTimeoutMs = this.readWorkerLockTimeoutMs();
  }

  /* ─────────────────────────────────────────────
     ENQUEUE
  ───────────────────────────────────────────── */

  async enqueue(dto: EnqueueIntegrationJobDto) {
    await this.businessesService.ensureBusinessIsActive(dto.businessId);

    return this.prisma.integrationJob.create({
      data: {
        businessId: dto.businessId,

        jobType: dto.jobType,

        entityType: dto.entityType.trim().toUpperCase(),

        entityId: dto.entityId,

        payload: dto.payload
          ? (dto.payload as Prisma.InputJsonValue)
          : undefined,

        correlationId: dto.correlationId,

        maxAttempts: dto.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,

        status: IntegrationJobStatus.PENDING,

        attempts: 0,

        nextAttemptAt: new Date(),

        lockedAt: null,

        lockedBy: null,

        lastError: null,

        completedAt: null,
      },
    });
  }

  async enqueueWithTransaction(
    tx: Prisma.TransactionClient,
    params: {
      businessId: string;
      jobType: IntegrationJobType;
      entityType: string;
      entityId: string;
      payload?: Prisma.InputJsonValue;
      correlationId?: string;
      maxAttempts?: number;
    },
  ) {
    return tx.integrationJob.create({
      data: {
        businessId: params.businessId,

        jobType: params.jobType,

        entityType: params.entityType.trim().toUpperCase(),

        entityId: params.entityId,

        payload: params.payload,

        correlationId: params.correlationId,

        maxAttempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,

        status: IntegrationJobStatus.PENDING,

        attempts: 0,

        nextAttemptAt: new Date(),

        lockedAt: null,

        lockedBy: null,

        lastError: null,

        completedAt: null,
      },
    });
  }

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  async findById(id: string) {
    const job = await this.prisma.integrationJob.findUnique({
      where: {
        id,
      },
    });

    if (!job) {
      throw new NotFoundException(`No se encontró IntegrationJob ${id}`);
    }

    return job;
  }

  async findByEntity(businessId: string, entityType: string, entityId: string) {
    await this.businessesService.findById(businessId);

    return this.prisma.integrationJob.findMany({
      where: {
        businessId,

        entityType: entityType.trim().toUpperCase(),

        entityId,
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findPending(businessId?: string) {
    return this.prisma.integrationJob.findMany({
      where: {
        ...(businessId
          ? {
              businessId,
            }
          : {}),

        status: IntegrationJobStatus.PENDING,
      },

      orderBy: [
        {
          nextAttemptAt: 'asc',
        },

        {
          createdAt: 'asc',
        },
      ],
    });
  }

  /* ─────────────────────────────────────────────
     CLAIM
  ───────────────────────────────────────────── */

  async claimNextJobs(params: ClaimJobsParams): Promise<IntegrationJob[]> {
    const workerId = this.normalizeWorkerId(params.workerId);

    const limit = Math.min(
      Math.max(params.limit ?? DEFAULT_BATCH_SIZE, 1),
      MAX_BATCH_SIZE,
    );

    const jobTypeFilter =
      params.jobTypes && params.jobTypes.length > 0
        ? Prisma.sql`
            AND "jobType" IN (
              ${Prisma.join(
                params.jobTypes.map(
                  (jobType) => Prisma.sql`${jobType}::"IntegrationJobType"`,
                ),
              )}
            )
          `
        : Prisma.empty;

    const workspaceFilter = params.requireActiveWorkspace
      ? Prisma.sql`
          AND EXISTS (
            SELECT 1 FROM "Integration" AS workspace
            WHERE workspace."businessId" = "IntegrationJob"."businessId"
              AND workspace."provider" = 'GOOGLE'
              AND workspace."integrationType" = 'WORKSPACE'
              AND workspace."status" = 'ACTIVE'
          )
        `
      : Prisma.empty;

    return this.prisma.$transaction(async (tx) => {
      const jobs = await tx.$queryRaw<IntegrationJob[]>`
            WITH candidates AS (
              SELECT
                "id"

              FROM
                "IntegrationJob"

              WHERE
                "status" =
                  'PENDING'::"IntegrationJobStatus"

                AND "nextAttemptAt" <= NOW()

                AND "attempts" < "maxAttempts"

                AND "lockedAt" IS NULL

                ${jobTypeFilter}
                ${workspaceFilter}

              ORDER BY
                "nextAttemptAt" ASC,
                "createdAt" ASC

              FOR UPDATE SKIP LOCKED

              LIMIT ${limit}
            )

            UPDATE
              "IntegrationJob" AS job

            SET
              "status" =
                'PROCESSING'::"IntegrationJobStatus",

              "attempts" =
                job."attempts" + 1,

              "lockedAt" =
                NOW(),

              "lockedBy" =
                ${workerId},

              "updatedAt" =
                NOW()

            FROM
              candidates

            WHERE
              job."id" =
                candidates."id"

            RETURNING
              job.*;
          `;

      return jobs;
    });
  }

  /* ─────────────────────────────────────────────
     COMPLETE
  ───────────────────────────────────────────── */

  async markCompleted(params: CompleteJobParams) {
    const workerId = this.normalizeWorkerId(params.workerId);

    const now = new Date();

    const result = await this.prisma.integrationJob.updateMany({
      where: {
        id: params.jobId,

        status: IntegrationJobStatus.PROCESSING,

        lockedBy: workerId,
        lockedAt: { gt: new Date(Date.now() - this.workerLockTimeoutMs) },
      },

      data: {
        status: IntegrationJobStatus.COMPLETED,

        completedAt: now,

        lockedAt: null,

        lockedBy: null,

        lastError: null,
      },
    });

    if (result.count !== 1) {
      await this.throwTransitionError(params.jobId, workerId);
    }

    return this.findById(params.jobId);
  }

  /* ─────────────────────────────────────────────
     FAILURE / RETRY
  ───────────────────────────────────────────── */

  async markFailed(params: FailJobParams) {
    const workerId = this.normalizeWorkerId(params.workerId);

    const job = await this.findById(params.jobId);

    if (job.status !== IntegrationJobStatus.PROCESSING) {
      throw new ConflictException(`El job ${job.id} no está en PROCESSING`);
    }

    if (job.lockedBy !== workerId) {
      throw new ConflictException(
        `El job ${job.id} pertenece al worker ${job.lockedBy ?? 'desconocido'}`,
      );
    }

    const exhausted = job.attempts >= job.maxAttempts;

    const lastError = this.normalizeError(params.error);

    if (exhausted) {
      const result = await this.prisma.integrationJob.updateMany({
        where: {
          id: job.id,

          status: IntegrationJobStatus.PROCESSING,

          lockedBy: workerId,
          lockedAt: { gt: new Date(Date.now() - this.workerLockTimeoutMs) },
        },

        data: {
          status: IntegrationJobStatus.FAILED,

          lastError,

          lockedAt: null,

          lockedBy: null,

          nextAttemptAt: new Date(),
        },
      });

      if (result.count !== 1) {
        await this.throwTransitionError(job.id, workerId);
      }

      return this.findById(job.id);
    }

    const nextAttemptAt = this.calculateNextAttemptAt(job.attempts);

    const result = await this.prisma.integrationJob.updateMany({
      where: {
        id: job.id,

        status: IntegrationJobStatus.PROCESSING,

        lockedBy: workerId,
        lockedAt: { gt: new Date(Date.now() - this.workerLockTimeoutMs) },
      },

      data: {
        status: IntegrationJobStatus.PENDING,

        nextAttemptAt,

        lastError,

        lockedAt: null,

        lockedBy: null,
      },
    });

    if (result.count !== 1) {
      await this.throwTransitionError(job.id, workerId);
    }

    return this.findById(job.id);
  }

  /* ─────────────────────────────────────────────
     STALE LOCK RECOVERY
  ───────────────────────────────────────────── */

  async recoverStaleJobs() {
    const lockTimeoutMs = this.workerLockTimeoutMs;

    const retryDelayMs = STALE_RECOVERY_RETRY_DELAY_MS;

    const recovered = await this.prisma.$queryRaw<
      Pick<IntegrationJob, 'id' | 'jobType' | 'status' | 'lastError'>[]
    >`
        UPDATE
          "IntegrationJob"

        SET
          "status" =
            CASE
              WHEN "attempts" >= "maxAttempts"
                THEN 'FAILED'::"IntegrationJobStatus"

              ELSE
                'PENDING'::"IntegrationJobStatus"
            END,

          "nextAttemptAt" =
            CASE
              WHEN "attempts" >= "maxAttempts"
                THEN NOW()

              ELSE
                NOW() +
                (
                  ${retryDelayMs}
                  * INTERVAL '1 millisecond'
                )
            END,

          "lastError" =
            CASE
              WHEN "lastError" IS NULL
                THEN
                  'Worker lock expired before completion'

              ELSE
                "lastError"
            END,

          "lockedAt" =
            NULL,

          "lockedBy" =
            NULL,

          "updatedAt" =
            NOW()

        WHERE
          "status" =
            'PROCESSING'::"IntegrationJobStatus"

          AND "lockedAt" IS NOT NULL

          AND "lockedAt" <=
            NOW() -
            (
              ${lockTimeoutMs}
              * INTERVAL '1 millisecond'
            )
        RETURNING "id", "jobType", "status", "lastError";
      `;

    return {
      recoveredJobs: recovered.length,
      failedJobs: recovered.filter((job) => job.status === IntegrationJobStatus.FAILED),

      lockTimeoutMs,

      processedAt: new Date(),
    };
  }

  /* ─────────────────────────────────────────────
     RETRY HELPERS
  ───────────────────────────────────────────── */

  private calculateNextAttemptAt(attempts: number) {
    /*
     * attempts ya incluye el intento que acaba
     * de fallar porque incrementamos al reclamar.
     */
    const multiplier = Math.pow(2, Math.max(attempts - 1, 0));

    const delay = Math.min(
      BASE_RETRY_DELAY_MS * multiplier,

      MAX_RETRY_DELAY_MS,
    );

    return new Date(Date.now() + delay);
  }

  /* ─────────────────────────────────────────────
     WORKER HELPERS
  ───────────────────────────────────────────── */

  private normalizeWorkerId(workerId: string) {
    const normalized = workerId?.trim();

    if (!normalized) {
      throw new ConflictException('workerId es obligatorio');
    }

    return normalized;
  }

  private readWorkerLockTimeoutMs() {
    const raw = process.env.INTEGRATION_JOBS_STALE_LOCK_MS;

    if (!raw) {
      return DEFAULT_WORKER_LOCK_TIMEOUT_MS;
    }

    const parsed = Number.parseInt(raw, 10);

    if (!Number.isInteger(parsed) || parsed < MIN_WORKER_LOCK_TIMEOUT_MS) {
      return DEFAULT_WORKER_LOCK_TIMEOUT_MS;
    }

    return parsed;
  }

  private normalizeError(error: string) {
    const normalized =
      error?.trim() || 'Error desconocido procesando IntegrationJob';

    return normalized.slice(0, 4000);
  }

  /* ─────────────────────────────────────────────
     DOMAIN ERRORS
  ───────────────────────────────────────────── */

  private async throwTransitionError(
    jobId: string,
    workerId: string,
  ): Promise<never> {
    const job = await this.prisma.integrationJob.findUnique({
      where: {
        id: jobId,
      },
    });

    if (!job) {
      throw new NotFoundException(`No se encontró IntegrationJob ${jobId}`);
    }

    if (job.status !== IntegrationJobStatus.PROCESSING) {
      throw new ConflictException(
        `El job ${jobId} ya no está en PROCESSING. Estado actual: ${job.status}`,
      );
    }

    if (job.lockedBy !== workerId) {
      throw new ConflictException(
        `El worker ${workerId} no posee el lock del job ${jobId}. Lock actual: ${job.lockedBy ?? 'ninguno'}`,
      );
    }

    throw new ConflictException(
      `No fue posible completar la transición del job ${jobId}`,
    );
  }

  /* ─────────────────────────────────────────────
   LOCK HEARTBEAT
───────────────────────────────────────────── */

  async refreshLock(params: { jobId: string; workerId: string }) {
    const workerId = this.normalizeWorkerId(params.workerId);

    const result = await this.prisma.integrationJob.updateMany({
      where: {
        id: params.jobId,

        status: IntegrationJobStatus.PROCESSING,

        lockedBy: workerId,
        lockedAt: { gt: new Date(Date.now() - this.workerLockTimeoutMs) },
      },

      data: {
        lockedAt: new Date(),
      },
    });

    return {
      refreshed: result.count === 1,

      refreshedAt: new Date(),
    };
  }
}
