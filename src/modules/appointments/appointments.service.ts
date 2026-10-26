import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AppointmentStatus, Prisma } from '@prisma/client';

import { randomUUID } from 'crypto';

import { PrismaService } from '../../database/prisma/prisma.service';

import { INTERACTION_EVENT_TYPES } from '../../common/constants/interaction-event-types';

import { FLOW_KEYS } from '../../common/flows/flow-registry';

import { BusinessesService } from '../businesses/businesses.service';

import { CustomersService } from '../customers/customers.service';

import { InteractionLogsService } from '../interaction-logs/interaction-logs.service';

import type { InteractionEventType } from '../../common/constants/interaction-event-types';

import { AppointmentActionDto } from './dto/appointment-action.dto';

import { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto';

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.RESCHEDULED,
];

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly businessesService: BusinessesService,

    private readonly customersService: CustomersService,

    private readonly interactionLogsService: InteractionLogsService,
  ) {}

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  async findById(businessId: string, appointmentId: string) {
    await this.businessesService.findById(businessId);

    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,

        businessId,
      },
    });

    if (!appointment) {
      throw new NotFoundException(
        `No se encontró la cita ${appointmentId} para el negocio indicado`,
      );
    }

    return appointment;
  }

  async findAllByBusiness(businessId: string, query: ListAppointmentsQueryDto) {
    await this.businessesService.findById(businessId);

    return this.prisma.appointment.findMany({
      where: {
        businessId,

        ...(query.status
          ? {
              status: query.status,
            }
          : {}),
      },

      orderBy: {
        startTime: 'desc',
      },

      take: query.limit ?? 100,
    });
  }

  async findUpcomingByBusiness(businessId: string, limit = 50) {
    await this.businessesService.findById(businessId);

    const safeLimit = Math.min(Math.max(limit, 1), 200);

    return this.prisma.appointment.findMany({
      where: {
        businessId,

        status: {
          in: ACTIVE_APPOINTMENT_STATUSES,
        },

        startTime: {
          gte: new Date(),
        },
      },

      orderBy: {
        startTime: 'asc',
      },

      take: safeLimit,
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

    return this.prisma.appointment.findMany({
      where: {
        businessId,
        customerId,
      },

      orderBy: {
        startTime: 'desc',
      },
    });
  }

  async findUpcomingByCustomer(businessId: string, customerId: string) {
    await this.businessesService.findById(businessId);

    const customer = await this.customersService.findById(customerId);

    if (customer.businessId !== businessId) {
      throw new NotFoundException(
        'El cliente no pertenece al negocio indicado',
      );
    }

    return this.prisma.appointment.findMany({
      where: {
        businessId,
        customerId,

        status: {
          in: ACTIVE_APPOINTMENT_STATUSES,
        },

        startTime: {
          gte: new Date(),
        },
      },

      orderBy: {
        startTime: 'asc',
      },
    });
  }

  /* ─────────────────────────────────────────────
     CANCEL
  ───────────────────────────────────────────── */

  async cancel(
    businessId: string,
    appointmentId: string,
    dto: AppointmentActionDto,
  ) {
    const correlationId = dto.correlationId ?? randomUUID();

    const appointment = await this.findById(businessId, appointmentId);

    this.ensureTransitionAllowed(
      appointment.status,
      AppointmentStatus.CANCELLED,
    );

    const now = new Date();

    const updated = await this.updateStatusSafely({
      appointmentId: appointment.id,

      businessId,

      currentStatus: appointment.status,

      targetStatus: AppointmentStatus.CANCELLED,

      data: {
        status: AppointmentStatus.CANCELLED,

        cancelledAt: now,
      },
    });

    await this.writeLifecycleLogSafely({
      appointment: updated,

      correlationId,

      eventType: INTERACTION_EVENT_TYPES.APPOINTMENT_CANCELLED,

      description: 'La cita fue cancelada.',

      reason: dto.reason,
    });

    return updated;
  }

  /* ─────────────────────────────────────────────
     COMPLETE
  ───────────────────────────────────────────── */

  async complete(
    businessId: string,
    appointmentId: string,
    dto: AppointmentActionDto,
  ) {
    const correlationId = dto.correlationId ?? randomUUID();

    const appointment = await this.findById(businessId, appointmentId);

    this.ensureTransitionAllowed(
      appointment.status,
      AppointmentStatus.COMPLETED,
    );

    const now = new Date();

    const updated = await this.updateStatusSafely({
      appointmentId: appointment.id,

      businessId,

      currentStatus: appointment.status,

      targetStatus: AppointmentStatus.COMPLETED,

      data: {
        status: AppointmentStatus.COMPLETED,

        completedAt: now,
      },
    });

    await this.writeLifecycleLogSafely({
      appointment: updated,

      correlationId,

      eventType: INTERACTION_EVENT_TYPES.APPOINTMENT_COMPLETED,

      description: 'La cita fue marcada como completada.',

      reason: dto.reason,
    });

    return updated;
  }

  /* ─────────────────────────────────────────────
     NO SHOW
  ───────────────────────────────────────────── */

  async markNoShow(
    businessId: string,
    appointmentId: string,
    dto: AppointmentActionDto,
  ) {
    const correlationId = dto.correlationId ?? randomUUID();

    const appointment = await this.findById(businessId, appointmentId);

    this.ensureTransitionAllowed(appointment.status, AppointmentStatus.NO_SHOW);

    const now = new Date();

    const updated = await this.updateStatusSafely({
      appointmentId: appointment.id,

      businessId,

      currentStatus: appointment.status,

      targetStatus: AppointmentStatus.NO_SHOW,

      data: {
        status: AppointmentStatus.NO_SHOW,

        noShowAt: now,
      },
    });

    await this.writeLifecycleLogSafely({
      appointment: updated,

      correlationId,

      eventType: INTERACTION_EVENT_TYPES.APPOINTMENT_NO_SHOW,

      description: 'La cita fue marcada como no-show.',

      reason: dto.reason,
    });

    return updated;
  }

  /* ─────────────────────────────────────────────
     STATE MACHINE
  ───────────────────────────────────────────── */

  private ensureTransitionAllowed(
    current: AppointmentStatus,

    target: AppointmentStatus,
  ) {
    const allowedTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
      [AppointmentStatus.PENDING]: [
        AppointmentStatus.CONFIRMED,
        AppointmentStatus.CANCELLED,
      ],

      [AppointmentStatus.CONFIRMED]: [
        AppointmentStatus.CANCELLED,
        AppointmentStatus.RESCHEDULED,
        AppointmentStatus.COMPLETED,
        AppointmentStatus.NO_SHOW,
      ],

      [AppointmentStatus.RESCHEDULED]: [
        AppointmentStatus.CANCELLED,
        AppointmentStatus.RESCHEDULED,
        AppointmentStatus.COMPLETED,
        AppointmentStatus.NO_SHOW,
      ],

      [AppointmentStatus.CANCELLED]: [],

      [AppointmentStatus.COMPLETED]: [],

      [AppointmentStatus.NO_SHOW]: [],
    };

    const allowed = allowedTransitions[current];

    if (!allowed.includes(target)) {
      throw new ConflictException(
        `No es posible cambiar una cita de ${current} a ${target}`,
      );
    }
  }

  /* ─────────────────────────────────────────────
     SAFE UPDATE / CONCURRENCY
  ───────────────────────────────────────────── */

  private async updateStatusSafely(params: {
    appointmentId: string;

    businessId: string;

    currentStatus: AppointmentStatus;

    targetStatus: AppointmentStatus;

    data: Prisma.AppointmentUpdateManyMutationInput;
  }) {
    /*
     * Compare-and-set:
     *
     * actualiza únicamente si el status sigue
     * siendo exactamente el que leímos.
     *
     * Si dos requests compiten:
     *
     * CONFIRMED -> CANCELLED
     * CONFIRMED -> COMPLETED
     *
     * solo uno podrá ganar.
     */
    const result = await this.prisma.appointment.updateMany({
      where: {
        id: params.appointmentId,

        businessId: params.businessId,

        status: params.currentStatus,
      },

      data: params.data,
    });

    if (result.count !== 1) {
      throw new ConflictException(
        `La cita cambió de estado mientras se procesaba la transición a ${params.targetStatus}`,
      );
    }

    return this.prisma.appointment.findUniqueOrThrow({
      where: {
        id: params.appointmentId,
      },
    });
  }

  /* ─────────────────────────────────────────────
     OBSERVABILIDAD
  ───────────────────────────────────────────── */

  private async writeLifecycleLogSafely(params: {
    appointment: {
      id: string;

      businessId: string;

      customerId: string;

      status: AppointmentStatus;

      startTime: Date;
    };

    correlationId: string;

    eventType: InteractionEventType;

    description: string;

    reason?: string;
  }) {
    try {
      await this.interactionLogsService.create({
        businessId: params.appointment.businessId,

        customerId: params.appointment.customerId,

        correlationId: params.correlationId,

        eventType: params.eventType,

        flowKey: FLOW_KEYS.APPOINTMENT,

        description: params.description,

        metadata: {
          appointmentId: params.appointment.id,

          status: params.appointment.status,

          startTime: params.appointment.startTime.toISOString(),

          reason: params.reason,
        },
      });
    } catch {
      /*
       * Una transición de dominio confirmada
       * no debe revertirse por un error del log.
       */
    }
  }
}
