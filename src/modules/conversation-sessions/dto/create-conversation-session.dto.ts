import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  IsIn,
} from 'class-validator';

import { FLOW_KEYS } from '../../../common/flows/flow-registry';

export class CreateConversationSessionDto {
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(Object.values(FLOW_KEYS), {
    message: 'flowKey no es un flujo reconocido',
  })
  flowKey!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  flowVersion?: number;

  @IsString()
  @IsNotEmpty()
  stepKey!: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
