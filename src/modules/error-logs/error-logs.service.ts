import { Injectable, NotFoundException } from '@nestjs/common';

import { ErrorSeverity, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';

import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';
import { ConversationsService } from '../conversations/conversations.service';

import { CreateErrorLogDto } from './dto/create-error-log.dto';

@Injectable()
export class ErrorLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
    private readonly customersService: CustomersService,
    private readonly conversationsService: ConversationsService,
  ) {}

  /* ─────────────────────────────────────────────
     CREACIÓN
  ───────────────────────────────────────────── */

  async create(dto: CreateErrorLogDto) {
    await this.validateRelations(dto);

    return this.prisma.errorLog.create({
      data: {
        businessId: dto.businessId,
        customerId: dto.customerId,
        conversationId: dto.conversationId,
        correlationId: dto.correlationId,

        severity: dto.severity ?? ErrorSeverity.ERROR,

        source: dto.source,
        errorCode: dto.errorCode,
        errorMessage: dto.errorMessage,
        stackTrace: dto.stackTrace,

        payload: dto.payload as Prisma.InputJsonValue | undefined,

        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async createFromError(params: {
    error: unknown;

    source: string;

    businessId?: string;
    customerId?: string;
    conversationId?: string;
    correlationId?: string;

    severity?: ErrorSeverity;
    errorCode?: string;

    payload?: Prisma.InputJsonValue;
    metadata?: Prisma.InputJsonValue;
  }) {
    const normalized = this.normalizeError(params.error);

    return this.create({
      businessId: params.businessId,
      customerId: params.customerId,
      conversationId: params.conversationId,
      correlationId: params.correlationId,

      severity: params.severity ?? ErrorSeverity.ERROR,

      source: params.source,
      errorCode: params.errorCode ?? normalized.code,

      errorMessage: normalized.message,

      stackTrace: normalized.stack,

      payload: params.payload as Record<string, unknown> | undefined,

      metadata: params.metadata as Record<string, unknown> | undefined,
    });
  }

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  async findById(id: string) {
    const error = await this.prisma.errorLog.findUnique({
      where: {
        id,
      },
    });

    if (!error) {
      throw new NotFoundException(`No se encontró el ErrorLog con ID ${id}`);
    }

    return error;
  }

  async findByBusiness(businessId: string) {
    await this.businessesService.findById(businessId);

    return this.prisma.errorLog.findMany({
      where: {
        businessId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findByCorrelationId(correlationId: string) {
    return this.prisma.errorLog.findMany({
      where: {
        correlationId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findBySource(source: string) {
    return this.prisma.errorLog.findMany({
      where: {
        source,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findBySeverity(severity: ErrorSeverity) {
    return this.prisma.errorLog.findMany({
      where: {
        severity,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /* ─────────────────────────────────────────────
     VALIDACIONES MULTI-TENANT
  ───────────────────────────────────────────── */

  private async validateRelations(dto: CreateErrorLogDto) {
    if (dto.businessId) {
      await this.businessesService.findById(dto.businessId);
    }

    if (dto.customerId) {
      const customer = await this.customersService.findById(dto.customerId);

      if (dto.businessId && customer.businessId !== dto.businessId) {
        throw new NotFoundException(
          'El cliente no pertenece al negocio indicado',
        );
      }
    }

    if (dto.conversationId) {
      const conversation = await this.conversationsService.findById(
        dto.conversationId,
      );

      if (dto.businessId && conversation.businessId !== dto.businessId) {
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

  /* ─────────────────────────────────────────────
     ERROR NORMALIZATION
  ───────────────────────────────────────────── */

  private normalizeError(error: unknown): {
    message: string;
    stack?: string;
    code?: string;
  } {
    if (error instanceof Error) {
      const possibleCode =
        'code' in error
          ? String(
              (
                error as Error & {
                  code?: unknown;
                }
              ).code,
            )
          : undefined;

      return {
        message: error.message,
        stack: error.stack,
        code: possibleCode,
      };
    }

    if (typeof error === 'string') {
      return {
        message: error,
      };
    }

    try {
      return {
        message: JSON.stringify(error),
      };
    } catch {
      return {
        message: 'Unknown error',
      };
    }
  }
}
