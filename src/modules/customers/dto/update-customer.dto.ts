import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  whatsappName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  displayName?: string;
}
