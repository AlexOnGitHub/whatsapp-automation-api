import {
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class RegisterSentDto {
  @IsString()
  @IsNotEmpty()
  whatsappMessageId!: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsDateString()
  providerTimestamp?: string;

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}
