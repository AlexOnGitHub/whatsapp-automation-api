import { IsString, MaxLength } from 'class-validator';

export class FailIntegrationJobDto {
  @IsString()
  workerId!: string;

  @IsString()
  @MaxLength(4000)
  error!: string;
}
