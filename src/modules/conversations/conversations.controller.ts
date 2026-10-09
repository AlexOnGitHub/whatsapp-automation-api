import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { ConversationsService } from './conversations.service';

import { CreateConversationDto } from './dto/create-conversation.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get('business/:businessId')
  findAllByBusiness(@Param('businessId') businessId: string) {
    return this.conversationsService.findAllByBusiness(businessId);
  }

  @Get('business/:businessId/customer/:customerId')
  findAllByCustomer(
    @Param('businessId') businessId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.conversationsService.findAllByCustomer(businessId, customerId);
  }

  @Post('active')
  getOrCreateActiveConversation(@Body() dto: CreateConversationDto) {
    return this.conversationsService.getOrCreateActiveConversation(
      dto.businessId,
      dto.customerId,
    );
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.conversationsService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateConversationDto) {
    return this.conversationsService.create(dto);
  }

  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.conversationsService.closeConversation(id);
  }

  @Patch(':id/expire')
  expire(@Param('id') id: string) {
    return this.conversationsService.expireConversation(id);
  }

  @Patch(':id/human-handoff')
  humanHandoff(@Param('id') id: string) {
    return this.conversationsService.markAsHumanHandoff(id);
  }

  @Patch(':id/resume-automation')
  resumeAutomation(@Param('id') id: string) {
    return this.conversationsService.resumeAutomation(id);
  }
}
