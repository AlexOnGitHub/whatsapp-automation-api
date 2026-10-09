import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

import { BusinessPlan, BusinessStatus } from '@prisma/client';

export class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug solo puede contener letras minúsculas, números y guiones',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  businessType?: string;

  @IsOptional()
  @IsString()
  whatsappPhoneNumber?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsEnum(BusinessStatus)
  status?: BusinessStatus;

  @IsOptional()
  @IsEnum(BusinessPlan)
  plan?: BusinessPlan;
}
