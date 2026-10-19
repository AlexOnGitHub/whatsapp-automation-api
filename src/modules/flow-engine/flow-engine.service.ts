import { BadRequestException, Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { FLOW_KEYS, getFlowDefinition } from '../../common/flows/flow-registry';

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
         4. VALIDAR MENSAJE PERSISTIDO
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
         5. RESOLVER SESSION ACTIVA
      ───────────────────────────────────────── */

      let session =
        await this.conversationSessionsService.findUsableActiveSession(
          dto.conversationId,
        );

      let startingNewFlow = false;

      /*
       * Si no existe ninguna sesión activa,
       * MAIN_MENU es el punto de entrada del
       * runtime conversacional.
       */
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

        /* ───────────────────────────────────────
           OBSERVABILIDAD: SESSION_STARTED
        ─────────────────────────────────────── */

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

        /* ───────────────────────────────────────
           OBSERVABILIDAD: FLOW_STARTED
        ─────────────────────────────────────── */

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
         6. RESOLVER HANDLER
      ───────────────────────────────────────── */

      /*
       * Por el momento solamente MAIN_MENU tiene
       * handler implementado.
       *
       * Cuando agreguemos APPOINTMENT, FAQ,
       * REQUEST y HUMAN_HANDOFF esta validación
       * desaparecerá y resolveremos directamente
       * mediante FlowHandlerRegistry.
       */
      if (session.flowKey !== FLOW_KEYS.MAIN_MENU) {
        throw new BadRequestException(
          `El flujo ${session.flowKey} todavía no tiene implementación en FlowEngine`,
        );
      }

      const handler = this.flowHandlerRegistry.get(FLOW_KEYS.MAIN_MENU);

      /* ─────────────────────────────────────────
         7. CONSTRUIR FLOW CONTEXT
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
         8. EJECUTAR HANDLER
      ───────────────────────────────────────── */

      const result = startingNewFlow
        ? await handler.start(context)
        : await handler.handle(context);

      /* ─────────────────────────────────────────
         9. ¿EL HANDLER SOLICITÓ TRANSICIÓN?
      ───────────────────────────────────────── */

      /*
       * Si el handler únicamente quiere responder
       * dentro del mismo flow, terminamos aquí.
       *
       * Ejemplos:
       *
       * MAIN_MENU start()
       * MAIN_MENU opción inválida
       */
      if (!result.transition) {
        return result;
      }

      /*
       * Toda transición necesita una sesión origen.
       *
       * En condiciones normales siempre existe,
       * pero conservamos esta validación defensiva.
       */
      if (!session) {
        throw new BadRequestException(
          'No existe una sesión activa desde la cual realizar la transición',
        );
      }

      /* ─────────────────────────────────────────
         10. EJECUTAR TRANSICIÓN ATÓMICA
      ───────────────────────────────────────── */

      const transition = await this.flowTransitionService.transitionToFlow({
        currentSessionId: session.id,

        targetFlowKey: result.transition.targetFlowKey,

        correlationId,

        context: result.transition.context,

        reason: result.transition.reason,
      });

      /* ─────────────────────────────────────────
         11. RESPUESTA DE TRANSICIÓN
      ───────────────────────────────────────── */

      /*
       * IMPORTANTE:
       *
       * Por ahora todavía NO ejecutamos:
       *
       * targetHandler.start()
       *
       * porque aún no hemos creado los handlers de:
       *
       * APPOINTMENT
       * FAQ
       * REQUEST
       * HUMAN_HANDOFF
       *
       * En el siguiente bloque el engine hará:
       *
       * MainMenu.handle()
       *      ↓
       * transitionToFlow()
       *      ↓
       * Appointment.start()
       */
      return {
        handled: true,

        flowKey: result.transition.targetFlowKey,

        stepKey: transition.session.stepKey,

        sessionId: transition.session.id,

        responses: result.responses,

        metadata: {
          ...result.metadata,

          transitioned: true,

          previousSessionId: transition.previousSession.id,

          previousFlowKey: transition.previousSession.flowKey,

          targetSessionId: transition.session.id,

          targetFlowKey: transition.session.flowKey,

          targetStepKey: transition.session.stepKey,
        },
      };
    } catch (error) {
      /* ─────────────────────────────────────────
         ERROR OBSERVABILITY
      ───────────────────────────────────────── */

      /*
       * El logging técnico jamás debe sustituir
       * ni esconder el error original.
       */
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
      } catch {
        /*
         * Si incluso ErrorLog falla,
         * conservamos el error original.
         *
         * No hacemos throw aquí para no ocultarlo.
         */
      }

      throw error;
    }
  }
}
