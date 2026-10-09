import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ConversationStatus,
  MessageDeliveryStatus,
  MessageDirection,
  MessageType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';
import { ConversationsService } from '../conversations/conversations.service';

import { CreateInboundMessageDto } from './dto/create-inbound-message.dto';
import { CreateOutboundMessageDto } from './dto/create-outbound-message.dto';

type RegisterSentParams = {
  messageId: string;
  whatsappMessageId: string;
  occurredAt?: Date;
  providerTimestamp?: Date;
  rawPayload?: Prisma.InputJsonValue;
};

type RegisterDeliveryStatusParams = {
  whatsappMessageId: string;
  status: MessageDeliveryStatus;
  occurredAt: Date;
  rawPayload?: Prisma.InputJsonValue;
  failureCode?: string;
  failureReason?: string;
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
    private readonly customersService: CustomersService,
    private readonly conversationsService: ConversationsService,
  ) {}

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  async findById(id: string) {
    const message = await this.prisma.message.findUnique({
      where: {
        id,
      },
      include: {
        customer: true,
        conversation: true,
        statusEvents: {
          orderBy: {
            occurredAt: 'asc',
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException(`No se encontró el mensaje con ID ${id}`);
    }

    return message;
  }

  async findByConversation(conversationId: string) {
    await this.conversationsService.findById(conversationId);

    return this.prisma.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findByCustomer(businessId: string, customerId: string) {
    await this.businessesService.findById(businessId);

    const customer = await this.customersService.findById(customerId);

    if (customer.businessId !== businessId) {
      throw new NotFoundException(
        'El cliente no pertenece al negocio indicado',
      );
    }

    return this.prisma.message.findMany({
      where: {
        businessId,
        customerId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findByWhatsappMessageId(whatsappMessageId: string) {
    const message = await this.prisma.message.findUnique({
      where: {
        whatsappMessageId,
      },
      include: {
        statusEvents: {
          orderBy: {
            occurredAt: 'asc',
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException(
        `No se encontró mensaje con whatsappMessageId ${whatsappMessageId}`,
      );
    }

    return message;
  }

  /* ─────────────────────────────────────────────
     INBOUND
  ───────────────────────────────────────────── */

  async createInbound(dto: CreateInboundMessageDto) {
    await this.validateRelations(
      dto.businessId,
      dto.customerId,
      dto.conversationId,
    );

    try {
      return await this.createInboundTransaction(dto);
    } catch (error) {
      this.handleCreateError(error);
    }
  }

  async createInboundIdempotent(dto: CreateInboundMessageDto) {
    await this.validateRelations(
      dto.businessId,
      dto.customerId,
      dto.conversationId,
    );

    if (dto.whatsappMessageId) {
      const existing = await this.prisma.message.findUnique({
        where: {
          whatsappMessageId: dto.whatsappMessageId,
        },
      });

      if (existing) {
        return {
          message: existing,
          duplicated: true,
        };
      }
    }

    try {
      const message = await this.createInboundTransaction(dto);

      return {
        message,
        duplicated: false,
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error) && dto.whatsappMessageId) {
        const existing = await this.prisma.message.findUnique({
          where: {
            whatsappMessageId: dto.whatsappMessageId,
          },
        });

        if (existing) {
          return {
            message: existing,
            duplicated: true,
          };
        }
      }

      throw error;
    }
  }

  private async createInboundTransaction(dto: CreateInboundMessageDto) {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          businessId: dto.businessId,
          customerId: dto.customerId,
          conversationId: dto.conversationId,

          direction: MessageDirection.INBOUND,

          messageType: dto.messageType ?? MessageType.TEXT,

          whatsappMessageId: dto.whatsappMessageId,

          content: dto.content,

          rawPayload: dto.rawPayload as Prisma.InputJsonValue | undefined,

          flowKey: dto.flowKey,
          stepKey: dto.stepKey,

          deliveryStatus: null,

          receivedAt: now,
          createdAt: now,
        },
      });

      if (dto.conversationId) {
        await tx.conversation.update({
          where: {
            id: dto.conversationId,
          },
          data: {
            lastMessageAt: now,
          },
        });
      }

      return message;
    });
  }

  /* ─────────────────────────────────────────────
     OUTBOUND
  ───────────────────────────────────────────── */

  async createOutbound(dto: CreateOutboundMessageDto) {
    await this.validateRelations(
      dto.businessId,
      dto.customerId,
      dto.conversationId,
    );

    try {
      return await this.createOutboundTransaction(dto);
    } catch (error) {
      this.handleCreateError(error);
    }
  }

  private async createOutboundTransaction(dto: CreateOutboundMessageDto) {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          businessId: dto.businessId,
          customerId: dto.customerId,
          conversationId: dto.conversationId,

          direction: MessageDirection.OUTBOUND,

          messageType: dto.messageType ?? MessageType.TEXT,

          whatsappMessageId: dto.whatsappMessageId,

          content: dto.content,

          rawPayload: dto.rawPayload as Prisma.InputJsonValue | undefined,

          flowKey: dto.flowKey,
          stepKey: dto.stepKey,

          deliveryStatus: MessageDeliveryStatus.QUEUED,

          queuedAt: now,
          createdAt: now,
        },
      });

      await tx.messageStatusEvent.create({
        data: {
          messageId: message.id,
          status: MessageDeliveryStatus.QUEUED,
          occurredAt: now,
          receivedAt: now,
        },
      });

      if (dto.conversationId) {
        await tx.conversation.update({
          where: {
            id: dto.conversationId,
          },
          data: {
            lastMessageAt: now,
          },
        });
      }

      return message;
    });
  }

  /* ─────────────────────────────────────────────
     META ACEPTÓ EL MENSAJE
  ───────────────────────────────────────────── */

  async registerSent(params: RegisterSentParams) {
    const message = await this.prisma.message.findUnique({
      where: {
        id: params.messageId,
      },
    });

    if (!message) {
      throw new NotFoundException(
        `No se encontró el mensaje con ID ${params.messageId}`,
      );
    }

    if (message.direction !== MessageDirection.OUTBOUND) {
      throw new BadRequestException(
        'Solo los mensajes OUTBOUND pueden marcarse como SENT',
      );
    }

    const occurredAt = params.occurredAt ?? new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.message.update({
          where: {
            id: message.id,
          },
          data: {
            whatsappMessageId: params.whatsappMessageId,

            deliveryStatus: MessageDeliveryStatus.SENT,

            sentAt: occurredAt,

            providerTimestamp: params.providerTimestamp ?? occurredAt,
          },
        });

        await tx.messageStatusEvent.create({
          data: {
            messageId: message.id,
            status: MessageDeliveryStatus.SENT,
            occurredAt,
            rawPayload: params.rawPayload,
            receivedAt: new Date(),
          },
        });

        return updated;
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const existing = await this.prisma.message.findUnique({
          where: {
            whatsappMessageId: params.whatsappMessageId,
          },
        });

        if (existing && existing.id === params.messageId) {
          return existing;
        }

        throw new ConflictException(
          'El whatsappMessageId ya pertenece a otro mensaje',
        );
      }

      throw error;
    }
  }

  /* ─────────────────────────────────────────────
     DELIVERY CALLBACKS
  ───────────────────────────────────────────── */

  async registerDeliveryStatus(params: RegisterDeliveryStatusParams) {
    const message = await this.prisma.message.findUnique({
      where: {
        whatsappMessageId: params.whatsappMessageId,
      },
    });

    if (!message) {
      throw new NotFoundException(
        `No existe un mensaje asociado al whatsappMessageId ${params.whatsappMessageId}`,
      );
    }

    if (message.direction !== MessageDirection.OUTBOUND) {
      throw new BadRequestException(
        'Los estados de entrega solo aplican a mensajes OUTBOUND',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.messageStatusEvent.create({
          data: {
            messageId: message.id,
            status: params.status,
            occurredAt: params.occurredAt,
            rawPayload: params.rawPayload,
            receivedAt: new Date(),
          },
        });

        const shouldUpdate = this.shouldAdvanceDeliveryStatus(
          message.deliveryStatus,
          params.status,
        );

        if (!shouldUpdate) {
          return message;
        }

        const lifecycleData = this.buildLifecycleUpdateData(params);

        return tx.message.update({
          where: {
            id: message.id,
          },
          data: lifecycleData,
        });
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return this.prisma.message.findUniqueOrThrow({
          where: {
            id: message.id,
          },
        });
      }

      throw error;
    }
  }

  /* ─────────────────────────────────────────────
     DELIVERY STATE MACHINE
  ───────────────────────────────────────────── */

  private shouldAdvanceDeliveryStatus(
    current: MessageDeliveryStatus | null,
    incoming: MessageDeliveryStatus,
  ): boolean {
    if (!current) {
      return true;
    }

    if (current === incoming) {
      return false;
    }

    /*
     * FAILED es terminal.
     */
    if (current === MessageDeliveryStatus.FAILED) {
      return false;
    }

    /*
     * FAILED solo puede reemplazar estados
     * previos a una entrega efectiva.
     */
    if (incoming === MessageDeliveryStatus.FAILED) {
      return (
        current === MessageDeliveryStatus.QUEUED ||
        current === MessageDeliveryStatus.SENT
      );
    }

    /*
     * Progresión normal:
     *
     * QUEUED
     *   ↓
     * SENT
     *   ↓
     * DELIVERED
     *   ↓
     * READ
     */
    const ranking: Partial<Record<MessageDeliveryStatus, number>> = {
      [MessageDeliveryStatus.QUEUED]: 1,
      [MessageDeliveryStatus.SENT]: 2,
      [MessageDeliveryStatus.DELIVERED]: 3,
      [MessageDeliveryStatus.READ]: 4,
    };

    const currentRank = ranking[current];
    const incomingRank = ranking[incoming];

    /*
     * Protección defensiva:
     * si agregamos un estado nuevo al enum y no
     * está contemplado aquí, no avanzamos.
     */
    if (currentRank === undefined || incomingRank === undefined) {
      return false;
    }

    return incomingRank > currentRank;
  }

  private buildLifecycleUpdateData(
    params: RegisterDeliveryStatusParams,
  ): Prisma.MessageUpdateInput {
    switch (params.status) {
      case MessageDeliveryStatus.QUEUED:
        return {
          deliveryStatus: MessageDeliveryStatus.QUEUED,
          queuedAt: params.occurredAt,
        };

      case MessageDeliveryStatus.SENT:
        return {
          deliveryStatus: MessageDeliveryStatus.SENT,
          sentAt: params.occurredAt,
        };

      case MessageDeliveryStatus.DELIVERED:
        return {
          deliveryStatus: MessageDeliveryStatus.DELIVERED,
          deliveredAt: params.occurredAt,
        };

      case MessageDeliveryStatus.READ:
        return {
          deliveryStatus: MessageDeliveryStatus.READ,
          readAt: params.occurredAt,
        };

      case MessageDeliveryStatus.FAILED:
        return {
          deliveryStatus: MessageDeliveryStatus.FAILED,
          failedAt: params.occurredAt,
          failureCode: params.failureCode,
          failureReason: params.failureReason,
        };

      default:
        throw new BadRequestException(
          `Estado de entrega no soportado: ${String(params.status)}`,
        );
    }
  }

  /* ─────────────────────────────────────────────
     RELACIONES / DOMINIO
  ───────────────────────────────────────────── */

  private async validateRelations(
    businessId: string,
    customerId: string,
    conversationId?: string,
  ) {
    await this.businessesService.ensureBusinessIsActive(businessId);

    const customer = await this.customersService.findById(customerId);

    if (customer.businessId !== businessId) {
      throw new NotFoundException(
        'El cliente no pertenece al negocio indicado',
      );
    }

    if (!conversationId) {
      return;
    }

    const conversation =
      await this.conversationsService.findById(conversationId);

    if (conversation.businessId !== businessId) {
      throw new NotFoundException(
        'La conversación no pertenece al negocio indicado',
      );
    }

    if (conversation.customerId !== customerId) {
      throw new NotFoundException(
        'La conversación no pertenece al cliente indicado',
      );
    }

    this.ensureConversationCanReceiveMessages(conversation.status);
  }

  private ensureConversationCanReceiveMessages(status: ConversationStatus) {
    const activeStatuses: ConversationStatus[] = [
      ConversationStatus.OPEN,
      ConversationStatus.HUMAN_HANDOFF,
    ];

    if (!activeStatuses.includes(status)) {
      throw new ConflictException(
        `La conversación con estado ${status} no admite nuevos mensajes`,
      );
    }
  }

  /* ─────────────────────────────────────────────
     PRISMA ERRORS
  ───────────────────────────────────────────── */

  private isUniqueConstraintError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private handleCreateError(error: unknown): never {
    if (this.isUniqueConstraintError(error)) {
      throw new ConflictException('El mensaje ya fue registrado previamente');
    }

    throw error;
  }
}
