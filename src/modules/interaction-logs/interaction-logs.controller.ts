import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { InteractionLogsService } from './interaction-logs.service';

import { CreateInteractionLogDto } from './dto/create-interaction-log.dto';

@Controller('interaction-logs')
export class InteractionLogsController {
  constructor(
    private readonly interactionLogsService: InteractionLogsService,
  ) {}

  @Post()
  create(
    @Body()
    dto: CreateInteractionLogDto,
  ) {
    return this.interactionLogsService.create(dto);
  }

  @Get('business/:businessId')
  findByBusiness(
    @Param('businessId')
    businessId: string,
  ) {
    return this.interactionLogsService.findByBusiness(businessId);
  }

  @Get('conversation/:conversationId')
  findByConversation(
    @Param('conversationId')
    conversationId: string,
  ) {
    return this.interactionLogsService.findByConversation(conversationId);
  }

  @Get('correlation/:correlationId')
  findByCorrelationId(
    @Param('correlationId')
    correlationId: string,
  ) {
    return this.interactionLogsService.findByCorrelationId(correlationId);
  }

  @Get('business/:businessId/event/:eventType')
  findByEventType(
    @Param('businessId')
    businessId: string,

    @Param('eventType')
    eventType: string,
  ) {
    return this.interactionLogsService.findByEventType(businessId, eventType);
  }

  @Get(':id')
  findById(
    @Param('id')
    id: string,
  ) {
    return this.interactionLogsService.findById(id);
  }
}
