import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ConversationStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';

import { CreateConversationDto } from './dto/create-conversation.dto';

const ACTIVE_CONVERSATION_STATUSES: ConversationStatus[] = [
  ConversationStatus.OPEN,
  ConversationStatus.HUMAN_HANDOFF,
];

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
    private readonly customersService: CustomersService,
  ) {}

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  async findAllByBusiness(businessId: string) {
    await this.businessesService.findById(businessId);

    return this.prisma.conversation.findMany({
      where: {
        businessId,
      },
      include: {
        customer: true,
      },
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  async findAllByCustomer(businessId: string, customerId: string) {
    await this.validateCustomerBelongsToBusiness(businessId, customerId);

    return this.prisma.conversation.findMany({
      where: {
        businessId,
        customerId,
      },
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  async findById(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: {
        id,
      },
      include: {
        customer: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException(
        `No se encontró la conversación con ID ${id}`,
      );
    }

    return conversation;
  }

  async findActiveConversation(businessId: string, customerId: string) {
    return this.prisma.conversation.findFirst({
      where: {
        businessId,
        customerId,
        status: {
          in: ACTIVE_CONVERSATION_STATUSES,
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  /* ─────────────────────────────────────────────
     CREACIÓN
  ───────────────────────────────────────────── */

  async create(dto: CreateConversationDto) {
    await this.businessesService.ensureBusinessIsActive(dto.businessId);

    await this.validateCustomerBelongsToBusiness(
      dto.businessId,
      dto.customerId,
    );

    const existing = await this.findActiveConversation(
      dto.businessId,
      dto.customerId,
    );

    if (existing) {
      throw new ConflictException(
        'El cliente ya tiene una conversación activa',
      );
    }

    try {
      return await this.createOpenConversation(dto.businessId, dto.customerId);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'El cliente ya tiene una conversación activa',
        );
      }

      throw error;
    }
  }

  async getOrCreateActiveConversation(businessId: string, customerId: string) {
    await this.businessesService.ensureBusinessIsActive(businessId);

    await this.validateCustomerBelongsToBusiness(businessId, customerId);

    const existing = await this.findActiveConversation(businessId, customerId);

    if (existing) {
      return existing;
    }

    try {
      return await this.createOpenConversation(businessId, customerId);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const winner = await this.findActiveConversation(
          businessId,
          customerId,
        );

        if (winner) {
          return winner;
        }
      }

      throw error;
    }
  }

  async getOrCreateOpenConversation(businessId: string, customerId: string) {
    return this.getOrCreateActiveConversation(businessId, customerId);
  }

  private async createOpenConversation(businessId: string, customerId: string) {
    return this.prisma.conversation.create({
      data: {
        businessId,
        customerId,
        status: ConversationStatus.OPEN,
        startedAt: new Date(),
        lastMessageAt: null,
        closedAt: null,
      },
    });
  }

  /* ─────────────────────────────────────────────
     ACTIVIDAD
  ───────────────────────────────────────────── */

  async touchLastMessage(id: string) {
    const conversation = await this.findById(id);

    this.ensureConversationIsActive(conversation.status);

    return this.prisma.conversation.update({
      where: {
        id,
      },
      data: {
        lastMessageAt: new Date(),
      },
    });
  }

  /* ─────────────────────────────────────────────
     MÁQUINA DE ESTADOS
  ───────────────────────────────────────────── */

  async markAsHumanHandoff(id: string) {
    return this.transition(id, ConversationStatus.HUMAN_HANDOFF);
  }

  async resumeAutomation(id: string) {
    return this.transition(id, ConversationStatus.OPEN);
  }

  async closeConversation(id: string) {
    return this.transition(id, ConversationStatus.CLOSED);
  }

  async expireConversation(id: string) {
    return this.transition(id, ConversationStatus.EXPIRED);
  }

  private async transition(id: string, targetStatus: ConversationStatus) {
    const conversation = await this.findById(id);

    this.validateTransition(conversation.status, targetStatus);

    const terminal =
      targetStatus === ConversationStatus.CLOSED ||
      targetStatus === ConversationStatus.EXPIRED;

    try {
      return await this.prisma.conversation.update({
        where: {
          id,
        },
        data: {
          status: targetStatus,

          closedAt: terminal ? new Date() : null,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Ya existe otra conversación activa para este cliente',
        );
      }

      throw error;
    }
  }

  private validateTransition(
    current: ConversationStatus,
    target: ConversationStatus,
  ) {
    const allowedTransitions: Record<ConversationStatus, ConversationStatus[]> =
      {
        [ConversationStatus.OPEN]: [
          ConversationStatus.HUMAN_HANDOFF,
          ConversationStatus.CLOSED,
          ConversationStatus.EXPIRED,
        ],

        [ConversationStatus.HUMAN_HANDOFF]: [
          ConversationStatus.OPEN,
          ConversationStatus.CLOSED,
          ConversationStatus.EXPIRED,
        ],

        [ConversationStatus.CLOSED]: [],

        [ConversationStatus.EXPIRED]: [],
      };

    if (!allowedTransitions[current].includes(target)) {
      throw new ConflictException(
        `Transición de conversación no permitida: ${current} → ${target}`,
      );
    }
  }

  /* ─────────────────────────────────────────────
     VALIDACIONES DE DOMINIO
  ───────────────────────────────────────────── */

  private async validateCustomerBelongsToBusiness(
    businessId: string,
    customerId: string,
  ) {
    await this.businessesService.findById(businessId);

    const customer = await this.customersService.findById(customerId);

    if (customer.businessId !== businessId) {
      throw new NotFoundException(
        'El cliente no pertenece al negocio indicado',
      );
    }

    return customer;
  }

  private ensureConversationIsActive(status: ConversationStatus) {
    if (!ACTIVE_CONVERSATION_STATUSES.includes(status)) {
      throw new ConflictException(
        `La conversación con estado ${status} ya no está activa`,
      );
    }
  }

  /* ─────────────────────────────────────────────
     PRISMA
  ───────────────────────────────────────────── */

  private isUniqueConstraintError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
