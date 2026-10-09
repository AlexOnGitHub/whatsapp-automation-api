import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class UpsertCustomerDto {
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10,15}$/, {
    message: 'whatsappPhone debe contener entre 10 y 15 dígitos',
  })
  whatsappPhone!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  whatsappName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  displayName?: string;
}
