import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

import { FLOW_KEYS } from '../../../common/flows/flow-registry';

import { INTERACTION_EVENT_TYPE_VALUES } from '../../../common/constants/interaction-event-types';

export class CreateInteractionLogDto {
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(INTERACTION_EVENT_TYPE_VALUES, {
    message: 'eventType no es un tipo de evento reconocido',
  })
  eventType!: string;

  @IsOptional()
  @IsString()
  @IsIn(Object.values(FLOW_KEYS), {
    message: 'flowKey no es un flujo reconocido',
  })
  flowKey?: string;

  @IsOptional()
  @IsString()
  stepKey?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
