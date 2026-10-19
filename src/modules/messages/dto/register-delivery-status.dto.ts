import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

import { MessageDeliveryStatus } from '@prisma/client';

export class RegisterDeliveryStatusDto {
  @IsString()
  @IsNotEmpty()
  whatsappMessageId!: string;

  @IsEnum(MessageDeliveryStatus)
  status!: MessageDeliveryStatus;

  @IsDateString()
  occurredAt!: string;

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;

  @ValidateIf(
    (dto: RegisterDeliveryStatusDto) =>
      dto.status === MessageDeliveryStatus.FAILED,
  )
  @IsString()
  @IsNotEmpty()
  failureCode?: string;

  @ValidateIf(
    (dto: RegisterDeliveryStatusDto) =>
      dto.status === MessageDeliveryStatus.FAILED,
  )
  @IsString()
  @IsNotEmpty()
  failureReason?: string;
}
