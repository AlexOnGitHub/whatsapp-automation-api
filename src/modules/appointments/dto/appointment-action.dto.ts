import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AppointmentActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
