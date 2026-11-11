import { IsString } from 'class-validator';

export class CompleteIntegrationJobDto {
  @IsString()
  workerId!: string;
}
