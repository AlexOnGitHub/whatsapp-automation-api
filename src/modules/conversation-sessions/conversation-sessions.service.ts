import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ConversationStatus, Prisma, SessionStatus } from '@prisma/client';

import { isValidStepForFlow } from '../../common/flows/flow-registry';

import { PrismaService } from '../../database/prisma/prisma.service';

import { BusinessesService } from '../businesses/businesses.service';
import { BusinessConfigsService } from '../business-configs/business-configs.service';
import { CustomersService } from '../customers/customers.service';
import { ConversationsService } from '../conversations/conversations.service';

import { CreateConversationSessionDto } from './dto/create-conversation-session.dto';
import { UpdateSessionStateDto } from './dto/update-session-state.dto';

@Injectable()
export class ConversationSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
    private readonly businessConfigsService: BusinessConfigsService,
    private readonly customersService: CustomersService,
    private readonly conversationsService: ConversationsService,
  ) {}

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  async findById(id: string) {
    const session = await this.prisma.conversationSession.findUnique({
      where: {
        id,
      },
    });

    if (!session) {
      throw new NotFoundException(`No se encontró la sesión con ID ${id}`);
    }

    return session;
  }

  async findAllByConversation(conversationId: string) {
    await this.conversationsService.findById(conversationId);

    return this.prisma.conversationSession.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findActiveByConversation(conversationId: string) {
    return this.prisma.conversationSession.findFirst({
      where: {
        conversationId,
        status: SessionStatus.ACTIVE,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findUsableActiveSession(conversationId: string) {
    const session = await this.findActiveByConversation(conversationId);

    if (!session) {
      return null;
    }

    if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
      await this.expireSession(session.id);

      return null;
    }

    return session;
  }

  /* ─────────────────────────────────────────────
     CREACIÓN EXPLÍCITA
  ───────────────────────────────────────────── */

  async create(dto: CreateConversationSessionDto) {
    await this.validateRelations(dto);

    const existing = await this.findUsableActiveSession(dto.conversationId);

    if (existing) {
      throw new ConflictException('La conversación ya tiene una sesión activa');
    }

    try {
      return await this.createActiveSession(dto);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'La conversación ya tiene una sesión activa',
        );
      }

      throw error;
    }
  }

  /* ─────────────────────────────────────────────
     CREACIÓN IDEMPOTENTE
  ───────────────────────────────────────────── */

  async getOrCreateActiveSession(dto: CreateConversationSessionDto) {
    await this.validateRelations(dto);

    const existing = await this.findUsableActiveSession(dto.conversationId);

    if (existing) {
      if (
        existing.flowKey === dto.flowKey &&
        existing.flowVersion === (dto.flowVersion ?? 1)
      ) {
        return existing;
      }

      throw new ConflictException(
        `La conversación ya tiene una sesión activa para el flujo ${existing.flowKey}`,
      );
    }

    try {
      return await this.createActiveSession(dto);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const winner = await this.findActiveByConversation(dto.conversationId);

        if (
          winner &&
          winner.flowKey === dto.flowKey &&
          winner.flowVersion === (dto.flowVersion ?? 1)
        ) {
          return winner;
        }

        throw new ConflictException(
          'La conversación ya tiene otra sesión activa',
        );
      }

      throw error;
    }
  }

  private async createActiveSession(dto: CreateConversationSessionDto) {
    const now = new Date();

    const expiresAt = await this.calculateExpirationDate(dto.businessId, now);

    return this.prisma.conversationSession.create({
      data: {
        businessId: dto.businessId,
        customerId: dto.customerId,
        conversationId: dto.conversationId,

        flowKey: dto.flowKey,
        flowVersion: dto.flowVersion ?? 1,

        stepKey: dto.stepKey,

        context: dto.context as Prisma.InputJsonValue | undefined,

        status: SessionStatus.ACTIVE,

        failedAttempts: 0,

        lastActivityAt: now,
        expiresAt,

        completedAt: null,
        cancelledAt: null,
        expiredAt: null,
      },
    });
  }

  /* ─────────────────────────────────────────────
     ESTADO DEL FLOW
  ───────────────────────────────────────────── */

  async updateState(id: string, dto: UpdateSessionStateDto) {
    const session = await this.findById(id);

    this.ensureSessionIsActive(session.status);

    if (!isValidStepForFlow(session.flowKey, dto.stepKey)) {
      throw new BadRequestException(
        `El paso ${dto.stepKey} no pertenece al flujo ${session.flowKey}`,
      );
    }

    const now = new Date();

    const expiresAt = await this.calculateExpirationDate(
      session.businessId,
      now,
    );

    return this.prisma.conversationSession.update({
      where: {
        id,
      },
      data: {
        stepKey: dto.stepKey,

        context: dto.context as Prisma.InputJsonValue | undefined,

        lastActivityAt: now,
        expiresAt,
      },
    });
  }

  /* ─────────────────────────────────────────────
     ACTIVIDAD
  ───────────────────────────────────────────── */

  async touchActivity(id: string) {
    const session = await this.findById(id);

    this.ensureSessionIsActive(session.status);

    const now = new Date();

    const expiresAt = await this.calculateExpirationDate(
      session.businessId,
      now,
    );

    return this.prisma.conversationSession.update({
      where: {
        id,
      },
      data: {
        lastActivityAt: now,
        expiresAt,
      },
    });
  }

  /* ─────────────────────────────────────────────
     INTENTOS FALLIDOS
  ───────────────────────────────────────────── */

  async incrementFailedAttempts(id: string) {
    const session = await this.findById(id);

    this.ensureSessionIsActive(session.status);

    const config = await this.businessConfigsService.findByBusinessId(
      session.businessId,
    );

    const now = new Date();

    const expiresAt = this.buildExpirationDate(
      now,
      config.sessionExpirationMinutes,
    );

    const updated = await this.prisma.conversationSession.update({
      where: {
        id,
      },
      data: {
        failedAttempts: {
          increment: 1,
        },
        lastActivityAt: now,
        expiresAt,
      },
    });

    return {
      session: updated,

      maxFailedAttempts: config.maxFailedAttempts,

      limitReached: updated.failedAttempts >= config.maxFailedAttempts,
    };
  }

  async resetFailedAttempts(id: string) {
    const session = await this.findById(id);

    this.ensureSessionIsActive(session.status);

    return this.prisma.conversationSession.update({
      where: {
        id,
      },
      data: {
        failedAttempts: 0,
      },
    });
  }

  /* ─────────────────────────────────────────────
     MÁQUINA DE ESTADOS
  ───────────────────────────────────────────── */

  async completeSession(id: string) {
    return this.transitionToTerminalStatus(id, SessionStatus.COMPLETED);
  }

  async cancelSession(id: string) {
    return this.transitionToTerminalStatus(id, SessionStatus.CANCELLED);
  }

  async expireSession(id: string) {
    return this.transitionToTerminalStatus(id, SessionStatus.EXPIRED);
  }

  private async transitionToTerminalStatus(
    id: string,
    targetStatus: SessionStatus,
  ) {
    const session = await this.findById(id);

    this.ensureSessionIsActive(session.status);

    const now = new Date();

    switch (targetStatus) {
      case SessionStatus.COMPLETED:
        return this.prisma.conversationSession.update({
          where: {
            id,
          },
          data: {
            status: SessionStatus.COMPLETED,

            completedAt: now,
            expiresAt: null,
          },
        });

      case SessionStatus.CANCELLED:
        return this.prisma.conversationSession.update({
          where: {
            id,
          },
          data: {
            status: SessionStatus.CANCELLED,

            cancelledAt: now,
            expiresAt: null,
          },
        });

      case SessionStatus.EXPIRED:
        return this.prisma.conversationSession.update({
          where: {
            id,
          },
          data: {
            status: SessionStatus.EXPIRED,

            expiredAt: now,
            expiresAt: null,
          },
        });

      default:
        throw new ConflictException(
          `No es posible realizar la transición ACTIVE → ${targetStatus}`,
        );
    }
  }

  /* ─────────────────────────────────────────────
     EXPIRACIÓN AUTOMÁTICA
  ───────────────────────────────────────────── */

  async expireDueSessions() {
    const now = new Date();

    const result = await this.prisma.conversationSession.updateMany({
      where: {
        status: SessionStatus.ACTIVE,

        expiresAt: {
          lte: now,
        },
      },
      data: {
        status: SessionStatus.EXPIRED,
        expiredAt: now,
        expiresAt: null,
      },
    });

    return {
      expiredSessions: result.count,
      processedAt: now,
    };
  }

  /* ─────────────────────────────────────────────
     VALIDACIONES DE DOMINIO
  ───────────────────────────────────────────── */

  private async validateRelations(dto: CreateConversationSessionDto) {
    /*
     * Flow y step deben formar una combinación válida.
     *
     * Ejemplo válido:
     * APPOINTMENT + SELECT_SERVICE
     *
     * Ejemplo inválido:
     * FAQ + SELECT_SERVICE
     */
    if (!isValidStepForFlow(dto.flowKey, dto.stepKey)) {
      throw new BadRequestException(
        `El paso ${dto.stepKey} no pertenece al flujo ${dto.flowKey}`,
      );
    }

    await this.businessesService.ensureBusinessIsActive(dto.businessId);

    const customer = await this.customersService.findById(dto.customerId);

    if (customer.businessId !== dto.businessId) {
      throw new NotFoundException(
        'El cliente no pertenece al negocio indicado',
      );
    }

    const conversation = await this.conversationsService.findById(
      dto.conversationId,
    );

    if (conversation.businessId !== dto.businessId) {
      throw new NotFoundException(
        'La conversación no pertenece al negocio indicado',
      );
    }

    if (conversation.customerId !== dto.customerId) {
      throw new NotFoundException(
        'La conversación no pertenece al cliente indicado',
      );
    }

    /*
     * Solo una Conversation OPEN puede ejecutar
     * automatización.
     *
     * HUMAN_HANDOFF requiere primero:
     *
     * HUMAN_HANDOFF → OPEN
     *
     * mediante ConversationsService.resumeAutomation().
     */
    if (conversation.status !== ConversationStatus.OPEN) {
      throw new ConflictException(
        `No es posible iniciar una sesión automática en una conversación con estado ${conversation.status}`,
      );
    }
  }

  private ensureSessionIsActive(status: SessionStatus) {
    if (status !== SessionStatus.ACTIVE) {
      throw new ConflictException(
        `La sesión con estado ${status} ya no puede modificarse`,
      );
    }
  }

  /* ─────────────────────────────────────────────
     EXPIRATION HELPERS
  ───────────────────────────────────────────── */

  private async calculateExpirationDate(businessId: string, from: Date) {
    const config =
      await this.businessConfigsService.findByBusinessId(businessId);

    return this.buildExpirationDate(from, config.sessionExpirationMinutes);
  }

  private buildExpirationDate(from: Date, expirationMinutes: number) {
    return new Date(from.getTime() + expirationMinutes * 60_000);
  }

  /* ─────────────────────────────────────────────
     DATABASE ERRORS
  ───────────────────────────────────────────── */

  private isUniqueConstraintError(error: unknown): boolean {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return true;
    }

    if (typeof error === 'object' && error !== null && 'code' in error) {
      const databaseError = error as {
        code?: unknown;
      };

      return databaseError.code === '23505';
    }

    return false;
  }
}
