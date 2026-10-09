import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { MessagesService } from './messages.service';

import { CreateInboundMessageDto } from './dto/create-inbound-message.dto';
import { CreateOutboundMessageDto } from './dto/create-outbound-message.dto';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

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

  @Post('inbound')
  createInbound(@Body() dto: CreateInboundMessageDto) {
    return this.messagesService.createInbound(dto);
  }

  @Post('outbound')
  createOutbound(@Body() dto: CreateOutboundMessageDto) {
    return this.messagesService.createOutbound(dto);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.messagesService.findById(id);
  }
}
