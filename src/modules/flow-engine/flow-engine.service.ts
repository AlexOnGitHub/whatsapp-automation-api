import { BadRequestException, Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

import {
  FLOW_KEYS,
  getFlowDefinition,
  isValidFlowKey,
  type FlowKey,
} from '../../common/flows/flow-registry';

import { INTERACTION_EVENT_TYPES } from '../../common/constants/interaction-event-types';

import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationSessionsService } from '../conversation-sessions/conversation-sessions.service';
import { MessagesService } from '../messages/messages.service';
import { InteractionLogsService } from '../interaction-logs/interaction-logs.service';
import { ErrorLogsService } from '../error-logs/error-logs.service';

import { FlowHandlerRegistry } from './handlers/flow-handler.registry';
import { FlowTransitionService } from './services/flow-transition.service';

import type { FlowContext } from './types/flow-context.types';

import type { FlowEngineResult } from './types/flow-result.types';

import { ProcessFlowMessageDto } from './dto/process-flow-message.dto';

@Injectable()
export class FlowEngineService {
  constructor(
    private readonly businessesService: BusinessesService,

    private readonly customersService: CustomersService,

    private readonly conversationsService: ConversationsService,

    private readonly conversationSessionsService: ConversationSessionsService,

    private readonly messagesService: MessagesService,

    private readonly interactionLogsService: InteractionLogsService,

    private readonly errorLogsService: ErrorLogsService,

    private readonly flowHandlerRegistry: FlowHandlerRegistry,

    private readonly flowTransitionService: FlowTransitionService,
  ) {}

  /* ─────────────────────────────────────────────
     PROCESS
  ───────────────────────────────────────────── */

  async process(dto: ProcessFlowMessageDto): Promise<FlowEngineResult> {
    const correlationId = dto.correlationId ?? randomUUID();

    try {
      /* ─────────────────────────────────────────
         1. VALIDAR BUSINESS
      ───────────────────────────────────────── */

      await this.businessesService.ensureBusinessIsActive(dto.businessId);

      /* ─────────────────────────────────────────
         2. VALIDAR CUSTOMER
      ───────────────────────────────────────── */

      const customer = await this.customersService.findById(dto.customerId);

      if (customer.businessId !== dto.businessId) {
        throw new BadRequestException(
          'El cliente no pertenece al negocio indicado',
        );
      }

      /* ─────────────────────────────────────────
         3. VALIDAR CONVERSATION
      ───────────────────────────────────────── */

      const conversation = await this.conversationsService.findById(
        dto.conversationId,
      );

      if (
        conversation.businessId !== dto.businessId ||
        conversation.customerId !== dto.customerId
      ) {
        throw new BadRequestException(
          'La conversación no pertenece al negocio/cliente indicado',
        );
      }

      /* ─────────────────────────────────────────
         4. VALIDAR MESSAGE PERSISTIDO
      ───────────────────────────────────────── */

      const message = dto.messageId
        ? await this.messagesService.findById(dto.messageId)
        : undefined;

      if (message) {
        if (
          message.businessId !== dto.businessId ||
          message.customerId !== dto.customerId ||
          message.conversationId !== dto.conversationId
        ) {
          throw new BadRequestException(
            'El mensaje no pertenece al contexto indicado',
          );
        }
      }

      /* ─────────────────────────────────────────
         5. BUSCAR SESSION ACTIVA
      ───────────────────────────────────────── */

      let session =
        await this.conversationSessionsService.findUsableActiveSession(
          dto.conversationId,
        );

      let startingNewFlow = false;

      /* ─────────────────────────────────────────
         6. SIN SESSION → MAIN_MENU
      ───────────────────────────────────────── */

      if (!session) {
        const definition = getFlowDefinition(FLOW_KEYS.MAIN_MENU);

        session =
          await this.conversationSessionsService.getOrCreateActiveSession({
            businessId: dto.businessId,

            customerId: dto.customerId,

            conversationId: dto.conversationId,

            flowKey: definition.key,

            flowVersion: definition.version,

            stepKey: definition.initialStep,

            context: {},
          });

        startingNewFlow = true;

        await this.interactionLogsService.create({
          businessId: dto.businessId,

          customerId: dto.customerId,

          conversationId: dto.conversationId,

          correlationId,

          eventType: INTERACTION_EVENT_TYPES.SESSION_STARTED,

          flowKey: session.flowKey,

          stepKey: session.stepKey,

          description: 'Se creó una nueva sesión conversacional.',
        });

        await this.interactionLogsService.create({
          businessId: dto.businessId,

          customerId: dto.customerId,

          conversationId: dto.conversationId,

          correlationId,

          eventType: INTERACTION_EVENT_TYPES.FLOW_STARTED,

          flowKey: session.flowKey,

          stepKey: session.stepKey,

          description: `Se inició el flujo ${session.flowKey}.`,
        });
      }

      /* ─────────────────────────────────────────
         7. VALIDAR FLOW KEY PERSISTIDO
      ───────────────────────────────────────── */

      if (!isValidFlowKey(session.flowKey)) {
        throw new BadRequestException(
          `La sesión contiene un flowKey no reconocido: ${session.flowKey}`,
        );
      }

      const currentFlowKey: FlowKey = session.flowKey;

      /* ─────────────────────────────────────────
         8. RESOLVER HANDLER DINÁMICAMENTE
      ───────────────────────────────────────── */

      const handler = this.flowHandlerRegistry.get(currentFlowKey);

      /* ─────────────────────────────────────────
         9. CONSTRUIR CONTEXTO
      ───────────────────────────────────────── */

      const context: FlowContext = {
        correlationId,

        businessId: dto.businessId,

        customerId: dto.customerId,

        conversationId: dto.conversationId,

        customer,

        conversation,

        session,

        message,

        input: {
          messageType: dto.messageType,

          text: dto.text,

          interactiveId: dto.interactiveId,
        },
      };

      /* ─────────────────────────────────────────
         10. EJECUTAR FLOW ACTUAL
      ───────────────────────────────────────── */

      const result = startingNewFlow
        ? await handler.start(context)
        : await handler.handle(context);

      /* ─────────────────────────────────────────
         11. SIN TRANSICIÓN
      ───────────────────────────────────────── */

      if (!result.transition) {
        return result;
      }

      /* ─────────────────────────────────────────
         12. TRANSICIÓN ATÓMICA
      ───────────────────────────────────────── */

      const transition = await this.flowTransitionService.transitionToFlow({
        currentSessionId: session.id,

        targetFlowKey: result.transition.targetFlowKey,

        correlationId,

        context: result.transition.context,

        reason: result.transition.reason,
      });

      const targetFlowKey = result.transition.targetFlowKey;

      /* ─────────────────────────────────────────
         13. RESOLVER HANDLER DESTINO
      ───────────────────────────────────────── */

      const targetHandler = this.flowHandlerRegistry.get(targetFlowKey);

      /* ─────────────────────────────────────────
         14. CREAR CONTEXTO DEL NUEVO FLOW
      ───────────────────────────────────────── */

      const targetContext: FlowContext = {
        correlationId,

        businessId: dto.businessId,

        customerId: dto.customerId,

        conversationId: dto.conversationId,

        customer,

        conversation,

        session: transition.session,

        message,

        input: {
          messageType: dto.messageType,

          text: dto.text,

          interactiveId: dto.interactiveId,
        },
      };

      /* ─────────────────────────────────────────
         15. START DEL FLOW DESTINO
      ───────────────────────────────────────── */

      const targetResult = await targetHandler.start(targetContext);

      /* ─────────────────────────────────────────
         16. RESPUESTA FINAL
      ───────────────────────────────────────── */

      return {
        handled: true,

        flowKey: targetFlowKey,

        stepKey: targetResult.stepKey,

        sessionId: transition.session.id,

        responses: [...result.responses, ...targetResult.responses],

        metadata: {
          ...result.metadata,

          transitioned: true,

          previousSessionId: transition.previousSession.id,

          previousFlowKey: transition.previousSession.flowKey,

          targetSessionId: transition.session.id,

          targetFlowKey,

          targetStepKey: transition.session.stepKey,

          targetReason: targetResult.metadata?.reason,
        },
      };
    } catch (error) {
      /* ─────────────────────────────────────────
         ERROR OBSERVABILITY
      ───────────────────────────────────────── */

      try {
        await this.errorLogsService.createFromError({
          error,

          source: 'FlowEngineService.process',

          businessId: dto.businessId,

          customerId: dto.customerId,

          conversationId: dto.conversationId,

          correlationId,

          metadata: {
            messageId: dto.messageId,

            messageType: dto.messageType,

            text: dto.text,

            interactiveId: dto.interactiveId,
          },
        });
      } catch {}

      throw error;
    }
  }
}
