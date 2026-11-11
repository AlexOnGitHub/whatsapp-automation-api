import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AppointmentStatus,
  IntegrationJobType,
  Prisma,
} from '@prisma/client';

import { randomUUID } from 'crypto';

import { PrismaService } from '../../database/prisma/prisma.service';

import { INTERACTION_EVENT_TYPES } from '../../common/constants/interaction-event-types';

import { FLOW_KEYS } from '../../common/flows/flow-registry';

import { BusinessesService } from '../businesses/businesses.service';

import { CustomersService } from '../customers/customers.service';

import { InteractionLogsService } from '../interaction-logs/interaction-logs.service';

import { IntegrationJobsService } from '../integration-jobs/integration-jobs.service';

import {
  GOOGLE_PROVIDER,
  GOOGLE_WORKSPACE_INTEGRATION_TYPE,
} from '../google/google.constants';

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

    private readonly integrationJobsService: IntegrationJobsService,
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

    await this.businessesService.findById(businessId);

    const result = await this.prisma.$transaction(async (tx) => {
      /* ─────────────────────────────────
             FRESH APPOINTMENT
          ───────────────────────────────── */

      const appointment = await tx.appointment.findFirst({
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

      this.ensureTransitionAllowed(
        appointment.status,

        AppointmentStatus.CANCELLED,
      );

      const now = new Date();

      /* ─────────────────────────────────
             COMPARE-AND-SET
          ───────────────────────────────── */

      const updated = await tx.appointment.updateMany({
        where: {
          id: appointment.id,

          businessId,

          status: appointment.status,
        },

        data: {
          status: AppointmentStatus.CANCELLED,

          cancelledAt: now,
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException(
          'La cita cambió de estado mientras se procesaba la cancelación',
        );
      }

      /* ─────────────────────────────────
             GOOGLE CALENDAR OUTBOX
          ───────────────────────────────── */

      /*
       * Comprobamos que Google Workspace esté
       * conectado y activo.
       *
       * Calendar utiliza las credenciales
       * compartidas de Google Workspace.
       *
       * La cancelación de la cita y la creación
       * del job DELETE ocurren dentro de la misma
       * transacción.
       *
       * Si cualquiera de las dos operaciones
       * falla, ambas hacen rollback.
       */
      const googleIntegration = await tx.integration.findUnique({
        where: {
          businessId_provider_integrationType: {
            businessId,

            provider: GOOGLE_PROVIDER,

            integrationType: GOOGLE_WORKSPACE_INTEGRATION_TYPE,
          },
        },

        select: {
          status: true,
        },
      });

      if (googleIntegration) {
        await this.integrationJobsService.enqueueWithTransaction(tx, {
          businessId,

          jobType: IntegrationJobType.GOOGLE_CALENDAR_DELETE,

          entityType: 'APPOINTMENT',

          entityId: appointment.id,

          correlationId,

          payload: {
            source: 'APPOINTMENT_CANCEL',

            previousStatus: appointment.status,

            newStatus: AppointmentStatus.CANCELLED,

            previousStartTime: appointment.startTime.toISOString(),

            previousEndTime: appointment.endTime.toISOString(),

            googleCalendarEventId: appointment.googleCalendarEventId ?? null,

            reason: dto.reason ?? null,
          },
        });
      }

      /* ─────────────────────────────────
             FRESH RESULT
          ───────────────────────────────── */

      return tx.appointment.findUniqueOrThrow({
        where: {
          id: appointment.id,
        },
      });
    });

    /* ───────────────────────────────────────────
       OBSERVABILIDAD
    ─────────────────────────────────────────── */

    await this.writeLifecycleLogSafely({
      appointment: result,

      correlationId,

      eventType: INTERACTION_EVENT_TYPES.APPOINTMENT_CANCELLED,

      description: 'La cita fue cancelada.',

      reason: dto.reason,
    });

    return result;
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

    this.ensureTransitionAllowed(
      appointment.status,

      AppointmentStatus.NO_SHOW,
    );

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
