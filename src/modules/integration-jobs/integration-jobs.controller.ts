import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ClaimIntegrationJobsDto } from './dto/claim-integration-jobs.dto';

import { CompleteIntegrationJobDto } from './dto/complete-integration-job.dto';

import { EnqueueIntegrationJobDto } from './dto/enqueue-integration-job.dto';

import { FailIntegrationJobDto } from './dto/fail-integration-job.dto';

import { IntegrationJobsService } from './integration-jobs.service';

import { IntegrationJobsProcessor } from './integration-jobs.processor';

@Controller('integration-jobs')
export class IntegrationJobsController {
  constructor(
    private readonly integrationJobsService: IntegrationJobsService,

    private readonly integrationJobsProcessor: IntegrationJobsProcessor,
  ) {}

  /* ─────────────────────────────────────────────
     ENQUEUE
  ───────────────────────────────────────────── */

  @Post()
  enqueue(
    @Body()
    dto: EnqueueIntegrationJobDto,
  ) {
    return this.integrationJobsService.enqueue(dto);
  }

  /* ─────────────────────────────────────────────
     CLAIM
  ───────────────────────────────────────────── */

  @Post('claim')
  claim(
    @Body()
    dto: ClaimIntegrationJobsDto,
  ) {
    return this.integrationJobsService.claimNextJobs({
      workerId: dto.workerId,

      limit: dto.limit,
    });
  }

  /* ─────────────────────────────────────────────
     RECOVER STALE
  ───────────────────────────────────────────── */

  @Post('recover-stale')
  recoverStale() {
    return this.integrationJobsService.recoverStaleJobs();
  }

  /* ─────────────────────────────────────────────
     QUERIES
  ───────────────────────────────────────────── */

  @Get('pending')
  findPending(
    @Query('businessId')
    businessId?: string,
  ) {
    return this.integrationJobsService.findPending(businessId);
  }

  @Get('entity/:businessId/:entityType/:entityId')
  findByEntity(
    @Param('businessId')
    businessId: string,

    @Param('entityType')
    entityType: string,

    @Param('entityId')
    entityId: string,
  ) {
    return this.integrationJobsService.findByEntity(
      businessId,
      entityType,
      entityId,
    );
  }

  @Get(':id')
  findById(
    @Param('id')
    id: string,
  ) {
    return this.integrationJobsService.findById(id);
  }

  /* ─────────────────────────────────────────────
     COMPLETE
  ───────────────────────────────────────────── */

  @Patch(':id/complete')
  complete(
    @Param('id')
    id: string,

    @Body()
    dto: CompleteIntegrationJobDto,
  ) {
    return this.integrationJobsService.markCompleted({
      jobId: id,

      workerId: dto.workerId,
    });
  }

  /* ─────────────────────────────────────────────
     FAIL
  ───────────────────────────────────────────── */

  @Patch(':id/fail')
  fail(
    @Param('id')
    id: string,

    @Body()
    dto: FailIntegrationJobDto,
  ) {
    return this.integrationJobsService.markFailed({
      jobId: id,

      workerId: dto.workerId,

      error: dto.error,
    });
  }

  /* ─────────────────────────────────────────────
   PROCESS ONCE
───────────────────────────────────────────── */

  @Post('process-once')
  processOnce(
    @Query('limit')
    limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;

    return this.integrationJobsProcessor.processBatch(
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
  }
}
