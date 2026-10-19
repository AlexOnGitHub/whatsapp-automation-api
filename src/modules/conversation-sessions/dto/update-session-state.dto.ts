import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateSessionStateDto {
  @IsString()
  @IsNotEmpty()
  stepKey!: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
