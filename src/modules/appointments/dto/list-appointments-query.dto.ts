import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { Type } from 'class-transformer';

import { AppointmentStatus } from '@prisma/client';

export class ListAppointmentsQueryDto {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
