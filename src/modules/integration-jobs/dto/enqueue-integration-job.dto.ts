import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { IntegrationJobType } from '@prisma/client';

export class EnqueueIntegrationJobDto {
  @IsString()
  businessId!: string;

  @IsEnum(IntegrationJobType)
  jobType!: IntegrationJobType;

  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;
}
