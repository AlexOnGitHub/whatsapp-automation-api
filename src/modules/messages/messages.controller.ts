import { ApiAccess } from '../../common/security/api-access.guard';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { MessagesService } from './messages.service';

import { CreateInboundMessageDto } from './dto/create-inbound-message.dto';
import { CreateOutboundMessageDto } from './dto/create-outbound-message.dto';
import { RegisterSentDto } from './dto/register-sent.dto';
import { RegisterDeliveryStatusDto } from './dto/register-delivery-status.dto';

@ApiAccess('message')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  @Get('conversation/:conversationId')
  findByConversation(@Param('conversationId') conversationId: string) {
    return this.messagesService.findByConversation(conversationId);
  }

  @Get('business/:businessId/customer/:customerId')
  findByCustomer(
    @Param('businessId') businessId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.messagesService.findByCustomer(businessId, customerId);
  }

  @Get('whatsapp/:whatsappMessageId')
  findByWhatsappMessageId(
    @Param('whatsappMessageId')
    whatsappMessageId: string,
  ) {
    return this.messagesService.findByWhatsappMessageId(whatsappMessageId);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.messagesService.findById(id);
  }

  /* ─────────────────────────────────────────────
     CREACIÓN
  ───────────────────────────────────────────── */

  @Post('inbound')
  async createInbound(@Body() dto: CreateInboundMessageDto) {
    const { message } = await this.messagesService.createInboundIdempotent(dto);
    return message;
  }

  @Post('outbound')
  createOutbound(@Body() dto: CreateOutboundMessageDto) {
    return this.messagesService.createOutbound(dto);
  }

  /* ─────────────────────────────────────────────
     DELIVERY LIFECYCLE
  ───────────────────────────────────────────── */

  @Patch(':id/sent')
  registerSent(@Param('id') id: string, @Body() dto: RegisterSentDto) {
    return this.messagesService.registerSent({
      messageId: id,
      whatsappMessageId: dto.whatsappMessageId,

      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,

      providerTimestamp: dto.providerTimestamp
        ? new Date(dto.providerTimestamp)
        : undefined,

      rawPayload: dto.rawPayload as Prisma.InputJsonValue | undefined,
    });
  }

  @ApiAccess('delivery')
  @Post('delivery-status')
  registerDeliveryStatus(@Body() dto: RegisterDeliveryStatusDto) {
    return this.messagesService.registerDeliveryStatus({
      whatsappMessageId: dto.whatsappMessageId,

      status: dto.status,

      occurredAt: new Date(dto.occurredAt),

      rawPayload: dto.rawPayload as Prisma.InputJsonValue | undefined,

      failureCode: dto.failureCode,

      failureReason: dto.failureReason,
    });
  }
}
