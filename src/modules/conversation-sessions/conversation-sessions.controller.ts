import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { ConversationSessionsService } from './conversation-sessions.service';

import { CreateConversationSessionDto } from './dto/create-conversation-session.dto';
import { UpdateSessionStateDto } from './dto/update-session-state.dto';

@Controller('conversation-sessions')
export class ConversationSessionsController {
  constructor(
    private readonly conversationSessionsService: ConversationSessionsService,
  ) {}

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  @Get('conversation/:conversationId')
  findAllByConversation(
    @Param('conversationId')
    conversationId: string,
  ) {
    return this.conversationSessionsService.findAllByConversation(
      conversationId,
    );
  }

  @Get('conversation/:conversationId/active')
  findActiveByConversation(
    @Param('conversationId')
    conversationId: string,
  ) {
    return this.conversationSessionsService.findUsableActiveSession(
      conversationId,
    );
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.conversationSessionsService.findById(id);
  }

  /* ─────────────────────────────────────────────
     CREACIÓN
  ───────────────────────────────────────────── */

  @Post()
  create(
    @Body()
    dto: CreateConversationSessionDto,
  ) {
    return this.conversationSessionsService.create(dto);
  }

  /**
   * Endpoint idempotente que utilizará después
   * FlowEngine.
   */
  @Post('active')
  getOrCreateActive(
    @Body()
    dto: CreateConversationSessionDto,
  ) {
    return this.conversationSessionsService.getOrCreateActiveSession(dto);
  }

  /* ─────────────────────────────────────────────
     FLOW STATE
  ───────────────────────────────────────────── */

  @Patch(':id/state')
  updateState(@Param('id') id: string, @Body() dto: UpdateSessionStateDto) {
    return this.conversationSessionsService.updateState(id, dto);
  }

  @Patch(':id/touch')
  touchActivity(@Param('id') id: string) {
    return this.conversationSessionsService.touchActivity(id);
  }

  /* ─────────────────────────────────────────────
     FAILED ATTEMPTS
  ───────────────────────────────────────────── */

  @Patch(':id/failed-attempt')
  incrementFailedAttempts(@Param('id') id: string) {
    return this.conversationSessionsService.incrementFailedAttempts(id);
  }

  @Patch(':id/reset-failed-attempts')
  resetFailedAttempts(@Param('id') id: string) {
    return this.conversationSessionsService.resetFailedAttempts(id);
  }

  /* ─────────────────────────────────────────────
     TERMINAL STATES
  ───────────────────────────────────────────── */

  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.conversationSessionsService.completeSession(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.conversationSessionsService.cancelSession(id);
  }

  @Patch(':id/expire')
  expire(@Param('id') id: string) {
    return this.conversationSessionsService.expireSession(id);
  }
}
