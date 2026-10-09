import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpsertBusinessConfigDto {
  @IsOptional()
  @IsString()
  welcomeMessage?: string;

  @IsOptional()
  @IsString()
  humanHandoffMessage?: string;

  @IsOptional()
  @IsString()
  fallbackMessage?: string;

  @IsOptional()
  @IsObject()
  mainMenuConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  businessHoursConfig?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paymentMethods?: string[];

  @IsOptional()
  @IsString()
  locationText?: string;

  @IsOptional()
  @IsString()
  googleMapsUrl?: string;

  @IsOptional()
  @IsString()
  cancellationPolicy?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxFailedAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  sessionExpirationMinutes?: number;
}
