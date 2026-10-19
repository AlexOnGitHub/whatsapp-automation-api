import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ConversationStatus, Prisma, SessionStatus } from '@prisma/client';

import { PrismaService } from '../../../database/prisma/prisma.service';

import {
  FLOW_KEYS,
  FlowKey,
  getFlowDefinition,
  isValidFlowKey,
} from '../../../common/flows/flow-registry';

import { INTERACTION_EVENT_TYPES } from '../../../common/constants/interaction-event-types';

import { InteractionLogsService } from '../../interaction-logs/interaction-logs.service';

type TransitionToFlowParams = {
  currentSessionId: string;

  targetFlowKey: FlowKey;

  correlationId: string;

  /**
   * Context inicial que recibirá el nuevo flow.
   */
  context?: Record<string, unknown>;

  /**
   * Motivo funcional de la transición.
   */
  reason?: string;
};

type TransitionResult = {
  previousSession: {
    id: string;
    flowKey: string;
    status: SessionStatus;
  };

  session: {
    id: string;
    businessId: string;
    customerId: string;
    conversationId: string;

    flowKey: string;
    flowVersion: number;
    stepKey: string;

    status: SessionStatus;

    context: Prisma.JsonValue;

    failedAttempts: number;

    lastActivityAt: Date;
    expiresAt: Date | null;

    completedAt: Date | null;
    cancelledAt: Date | null;
    expiredAt: Date | null;

    createdAt: Date;
    updatedAt: Date;
  };
};

@Injectable()
export class FlowTransitionService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly interactionLogsService: InteractionLogsService,
  ) {}

  /* ─────────────────────────────────────────────
     TRANSICIÓN ENTRE FLOWS
  ───────────────────────────────────────────── */

  async transitionToFlow(
    params: TransitionToFlowParams,
  ): Promise<TransitionResult> {
    if (!isValidFlowKey(params.targetFlowKey)) {
      throw new BadRequestException(
        `El flow ${params.targetFlowKey} no está registrado`,
      );
    }

    const targetDefinition = getFlowDefinition(params.targetFlowKey);

    const result = await this.prisma.$transaction(async (tx) => {
      /* ─────────────────────────────────────
             SESIÓN ACTUAL
          ───────────────────────────────────── */

      const currentSession = await tx.conversationSession.findUnique({
        where: {
          id: params.currentSessionId,
        },
      });

      if (!currentSession) {
        throw new NotFoundException(
          `No se encontró la sesión ${params.currentSessionId}`,
        );
      }

      if (currentSession.status !== SessionStatus.ACTIVE) {
        throw new ConflictException(
          `La sesión ${currentSession.id} ya no está activa`,
        );
      }

      if (currentSession.flowKey === params.targetFlowKey) {
        throw new ConflictException(
          `La sesión ya se encuentra ejecutando el flujo ${params.targetFlowKey}`,
        );
      }

      /* ─────────────────────────────────────
             CONVERSACIÓN
          ───────────────────────────────────── */

      const conversation = await tx.conversation.findUnique({
        where: {
          id: currentSession.conversationId,
        },
      });

      if (!conversation) {
        throw new NotFoundException(
          `No se encontró la conversación ${currentSession.conversationId}`,
        );
      }

      if (conversation.status !== ConversationStatus.OPEN) {
        throw new ConflictException(
          `No es posible cambiar de flujo con la conversación en estado ${conversation.status}`,
        );
      }

      if (
        conversation.businessId !== currentSession.businessId ||
        conversation.customerId !== currentSession.customerId
      ) {
        throw new ConflictException(
          'La sesión y la conversación no pertenecen al mismo contexto',
        );
      }

      /* ─────────────────────────────────────
             BUSINESS CONFIG
          ───────────────────────────────────── */

      const config = await tx.businessConfig.findUnique({
        where: {
          businessId: currentSession.businessId,
        },
      });

      if (!config) {
        throw new NotFoundException(
          'El negocio no tiene configuración registrada',
        );
      }

      /* ─────────────────────────────────────
             MÓDULO TARGET
          ───────────────────────────────────── */

      const targetModule = await tx.businessModule.findUnique({
        where: {
          businessId_moduleKey: {
            businessId: currentSession.businessId,

            moduleKey: params.targetFlowKey,
          },
        },
      });

      if (!targetModule) {
        throw new ConflictException(
          `El módulo ${params.targetFlowKey} no está configurado para el negocio`,
        );
      }

      if (!targetModule.enabled) {
        throw new ConflictException(
          `El módulo ${params.targetFlowKey} está deshabilitado para el negocio`,
        );
      }

      const now = new Date();

      const expiresAt = new Date(
        now.getTime() + config.sessionExpirationMinutes * 60_000,
      );

      /* ─────────────────────────────────────
             CERRAR SESIÓN ACTUAL
          ───────────────────────────────────── */

      const closed = await tx.conversationSession.updateMany({
        where: {
          id: currentSession.id,
          status: SessionStatus.ACTIVE,
        },

        data: {
          status: SessionStatus.COMPLETED,

          completedAt: now,

          expiresAt: null,
        },
      });

      if (closed.count !== 1) {
        throw new ConflictException(
          'La sesión cambió de estado mientras se procesaba la transición',
        );
      }

      /* ─────────────────────────────────────
             CREAR NUEVA SESIÓN
          ───────────────────────────────────── */

      const nextSession = await tx.conversationSession.create({
        data: {
          businessId: currentSession.businessId,

          customerId: currentSession.customerId,

          conversationId: currentSession.conversationId,

          flowKey: targetDefinition.key,

          flowVersion: targetDefinition.version,

          stepKey: targetDefinition.initialStep,

          context: params.context as Prisma.InputJsonValue | undefined,

          status: SessionStatus.ACTIVE,

          failedAttempts: 0,

          lastActivityAt: now,
          expiresAt,

          completedAt: null,
          cancelledAt: null,
          expiredAt: null,
        },
      });

      return {
        previousSession: {
          id: currentSession.id,

          flowKey: currentSession.flowKey,

          status: SessionStatus.COMPLETED,
        },

        session: nextSession,
      };
    });

    await this.writeTransitionLogsSafely({
      correlationId: params.correlationId,

      reason: params.reason,

      previousSessionId: result.previousSession.id,

      previousFlowKey: result.previousSession.flowKey,

      nextSessionId: result.session.id,

      nextFlowKey: result.session.flowKey,

      nextStepKey: result.session.stepKey,

      businessId: result.session.businessId,

      customerId: result.session.customerId,

      conversationId: result.session.conversationId,
    });

    return result;
  }

  /* ─────────────────────────────────────────────
     OBSERVABILIDAD
  ───────────────────────────────────────────── */

  private async writeTransitionLogsSafely(params: {
    correlationId: string;

    reason?: string;

    previousSessionId: string;
    previousFlowKey: string;

    nextSessionId: string;
    nextFlowKey: string;
    nextStepKey: string;

    businessId: string;
    customerId: string;
    conversationId: string;
  }) {
    try {
      await this.interactionLogsService.create({
        businessId: params.businessId,

        customerId: params.customerId,

        conversationId: params.conversationId,

        correlationId: params.correlationId,

        eventType: INTERACTION_EVENT_TYPES.FLOW_COMPLETED,

        flowKey: params.previousFlowKey,

        description: `Se completó el flujo ${params.previousFlowKey}.`,

        metadata: {
          sessionId: params.previousSessionId,

          nextFlowKey: params.nextFlowKey,

          reason: params.reason,
        },
      });

      await this.interactionLogsService.create({
        businessId: params.businessId,

        customerId: params.customerId,

        conversationId: params.conversationId,

        correlationId: params.correlationId,

        eventType: INTERACTION_EVENT_TYPES.SESSION_COMPLETED,

        flowKey: params.previousFlowKey,

        description:
          'La sesión anterior fue completada durante una transición de flujo.',

        metadata: {
          sessionId: params.previousSessionId,

          nextSessionId: params.nextSessionId,
        },
      });

      await this.interactionLogsService.create({
        businessId: params.businessId,

        customerId: params.customerId,

        conversationId: params.conversationId,

        correlationId: params.correlationId,

        eventType: INTERACTION_EVENT_TYPES.SESSION_STARTED,

        flowKey: params.nextFlowKey,

        stepKey: params.nextStepKey,

        description: 'Se creó la sesión del siguiente flujo.',

        metadata: {
          sessionId: params.nextSessionId,

          previousSessionId: params.previousSessionId,
        },
      });

      await this.interactionLogsService.create({
        businessId: params.businessId,

        customerId: params.customerId,

        conversationId: params.conversationId,

        correlationId: params.correlationId,

        eventType: INTERACTION_EVENT_TYPES.FLOW_STARTED,

        flowKey: params.nextFlowKey,

        stepKey: params.nextStepKey,

        description: `Se inició el flujo ${params.nextFlowKey}.`,

        metadata: {
          sessionId: params.nextSessionId,

          previousFlowKey: params.previousFlowKey,

          reason: params.reason,
        },
      });
    } catch {}
  }
}
