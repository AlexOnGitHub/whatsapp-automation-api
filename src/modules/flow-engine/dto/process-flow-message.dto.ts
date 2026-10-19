import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProcessFlowMessageDto {
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @IsOptional()
  @IsString()
  messageId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsString()
  @IsIn(['TEXT', 'INTERACTIVE'])
  messageType!: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  interactiveId?: string;
}
