import { isValidStepForFlow } from '../../common/flows/flow-registry';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';

import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';
import { ConversationsService } from '../conversations/conversations.service';

import { CreateInteractionLogDto } from './dto/create-interaction-log.dto';

@Injectable()
export class InteractionLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
    private readonly customersService: CustomersService,
    private readonly conversationsService: ConversationsService,
  ) {}

  /* ─────────────────────────────────────────────
     CREACIÓN
  ───────────────────────────────────────────── */

  async create(dto: CreateInteractionLogDto) {
    await this.validateRelations(dto);

    return this.prisma.interactionLog.create({
      data: {
        businessId: dto.businessId,

        customerId: dto.customerId,

        conversationId: dto.conversationId,

        correlationId: dto.correlationId,

        eventType: dto.eventType,

        flowKey: dto.flowKey,

        stepKey: dto.stepKey,

        description: dto.description,

        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  async findById(id: string) {
    const log = await this.prisma.interactionLog.findUnique({
      where: {
        id,
      },
    });

    if (!log) {
      throw new NotFoundException(
        `No se encontró el InteractionLog con ID ${id}`,
      );
    }

    return log;
  }

  async findByBusiness(businessId: string) {
    await this.businessesService.findById(businessId);

    return this.prisma.interactionLog.findMany({
      where: {
        businessId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findByConversation(conversationId: string) {
    await this.conversationsService.findById(conversationId);

    return this.prisma.interactionLog.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findByCorrelationId(correlationId: string) {
    return this.prisma.interactionLog.findMany({
      where: {
        correlationId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findByEventType(businessId: string, eventType: string) {
    await this.businessesService.findById(businessId);

    return this.prisma.interactionLog.findMany({
      where: {
        businessId,
        eventType,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /* ─────────────────────────────────────────────
     VALIDACIÓN MULTI-TENANT
  ───────────────────────────────────────────── */

  private async validateRelations(dto: CreateInteractionLogDto) {
    await this.businessesService.findById(dto.businessId);

    if (dto.stepKey && !dto.flowKey) {
      throw new BadRequestException('stepKey requiere flowKey');
    }

    if (
      dto.flowKey &&
      dto.stepKey &&
      !isValidStepForFlow(dto.flowKey, dto.stepKey)
    ) {
      throw new BadRequestException(
        `El stepKey ${dto.stepKey} no pertenece al flujo ${dto.flowKey}`,
      );
    }

    if (dto.customerId) {
      const customer = await this.customersService.findById(dto.customerId);

      if (customer.businessId !== dto.businessId) {
        throw new NotFoundException(
          'El cliente no pertenece al negocio indicado',
        );
      }
    }

    if (dto.conversationId) {
      const conversation = await this.conversationsService.findById(
        dto.conversationId,
      );

      if (conversation.businessId !== dto.businessId) {
        throw new NotFoundException(
          'La conversación no pertenece al negocio indicado',
        );
      }

      if (dto.customerId && conversation.customerId !== dto.customerId) {
        throw new NotFoundException(
          'La conversación no pertenece al cliente indicado',
        );
      }
    }
  }
}
