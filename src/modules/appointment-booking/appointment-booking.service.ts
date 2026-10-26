import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AppointmentStatus, Prisma, SessionStatus } from '@prisma/client';

import { DateTime } from 'luxon';

import { PrismaService } from '../../database/prisma/prisma.service';

import { APPOINTMENT_STEPS, FLOW_KEYS } from '../../common/flows/flow-registry';

import { INTERACTION_EVENT_TYPES } from '../../common/constants/interaction-event-types';

import { BusinessesService } from '../businesses/businesses.service';

import { ServicesCatalogService } from '../services-catalog/services-catalog.service';

import { AppointmentAvailabilityService } from '../appointment-availability/appointment-availability.service';

import { InteractionLogsService } from '../interaction-logs/interaction-logs.service';

import { AppointmentSlotUnavailableException } from './appointment-booking.errors';

type ConfirmAppointmentParams = {
  businessId: string;

  customerId: string;

  sessionId: string;

  serviceId: string;

  date: string;

  startTime: string;

  customerName: string;

  notes?: string | null;

  correlationId: string;
};

@Injectable()
export class AppointmentBookingService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly businessesService: BusinessesService,

    private readonly servicesCatalogService: ServicesCatalogService,

    private readonly appointmentAvailabilityService: AppointmentAvailabilityService,

    private readonly interactionLogsService: InteractionLogsService,
  ) {}

  /* ─────────────────────────────────────────────
     CONFIRM BOOKING
  ───────────────────────────────────────────── */

  async confirmAppointment(params: ConfirmAppointmentParams) {
    /*
     * Primera validación.
     *
     * Sirve para verificar:
     * - business activo
     * - service activo
     * - horario de negocio
     * - fecha
     * - disponibilidad actual
     */
    const business = await this.businessesService.ensureBusinessIsActive(
      params.businessId,
    );

    const service = await this.servicesCatalogService.findEnabledById(
      params.businessId,
      params.serviceId,
    );

    const requestedStart = DateTime.fromISO(params.startTime, {
      setZone: true,
    }).toUTC();

    if (!requestedStart.isValid) {
      throw new ConflictException(
        'El horario almacenado en la sesión no es válido',
      );
    }

    const availableSlots =
      await this.appointmentAvailabilityService.getAvailableSlots({
        businessId: params.businessId,

        serviceId: params.serviceId,

        date: params.date,
      });

    const selectedSlot = availableSlots.find(
      (slot) =>
        slot.startTime.getTime() === requestedStart.toJSDate().getTime(),
    );

    if (!selectedSlot) {
      throw new AppointmentSlotUnavailableException();
    }

    /*
     * Todos los bookings del mismo negocio y fecha
     * utilizarán el mismo advisory lock.
     *
     * Eso serializa las confirmaciones para esa
     * agenda/día sin bloquear otros negocios o días.
     */
    const lockKey = `appointment:${params.businessId}:${params.date}`;

    const result = await this.prisma.$transaction(async (tx) => {
      /* ─────────────────────────────────────
             ADVISORY LOCK
          ───────────────────────────────────── */

      await tx.$queryRaw<{ lockResult: string | null }[]>`
        SELECT
          pg_advisory_xact_lock(
            hashtext(${lockKey})::bigint
          )::text AS "lockResult"
      `;
      /*
       * A partir de este punto ningún otro
       * AppointmentBookingService para el
       * mismo business/date puede continuar
       * hasta que termine esta transacción.
       */

      /* ─────────────────────────────────────
             SESSION
          ───────────────────────────────────── */

      const session = await tx.conversationSession.findUnique({
        where: {
          id: params.sessionId,
        },
      });

      if (!session) {
        throw new NotFoundException(
          `No se encontró la sesión ${params.sessionId}`,
        );
      }

      if (
        session.businessId !== params.businessId ||
        session.customerId !== params.customerId
      ) {
        throw new ConflictException(
          'La sesión no pertenece al contexto indicado',
        );
      }

      if (session.status !== SessionStatus.ACTIVE) {
        throw new ConflictException('La sesión ya no está activa');
      }

      if (session.flowKey !== FLOW_KEYS.APPOINTMENT) {
        throw new ConflictException(
          'La sesión no pertenece al flujo APPOINTMENT',
        );
      }

      if (session.stepKey !== APPOINTMENT_STEPS.CONFIRMATION) {
        throw new ConflictException(
          `La sesión no se encuentra en CONFIRMATION sino en ${session.stepKey}`,
        );
      }

      /* ─────────────────────────────────────
             CUSTOMER
          ───────────────────────────────────── */

      const customer = await tx.customer.findUnique({
        where: {
          id: params.customerId,
        },
      });

      if (!customer) {
        throw new NotFoundException('No se encontró el cliente');
      }

      if (customer.businessId !== params.businessId) {
        throw new ConflictException(
          'El cliente no pertenece al negocio indicado',
        );
      }

      /* ─────────────────────────────────────
             SERVICE FRESH STATE
          ───────────────────────────────────── */

      const freshService = await tx.service.findFirst({
        where: {
          id: params.serviceId,

          businessId: params.businessId,

          enabled: true,
        },
      });

      if (!freshService) {
        throw new ConflictException('El servicio ya no está disponible');
      }

      /*
       * Si alguien modificó la duración después
       * de que el usuario seleccionó el slot,
       * obligamos a seleccionar horario otra vez.
       */
      if (freshService.durationMinutes !== service.durationMinutes) {
        throw new AppointmentSlotUnavailableException(
          'La duración del servicio cambió. Selecciona nuevamente un horario.',
        );
      }

      const startTime = selectedSlot.startTime;

      const endTime = new Date(
        startTime.getTime() + freshService.durationMinutes * 60_000,
      );

      /* ─────────────────────────────────────
             REVALIDACIÓN BAJO LOCK
          ───────────────────────────────────── */

      const overlappingAppointment = await tx.appointment.findFirst({
        where: {
          businessId: params.businessId,

          status: {
            in: [
              AppointmentStatus.PENDING,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.RESCHEDULED,
            ],
          },

          /*
           * Traslape real:
           *
           * existing.start < candidate.end
           * AND
           * existing.end > candidate.start
           */
          startTime: {
            lt: endTime,
          },

          endTime: {
            gt: startTime,
          },
        },

        select: {
          id: true,
        },
      });

      if (overlappingAppointment) {
        throw new AppointmentSlotUnavailableException();
      }

      /* ─────────────────────────────────────
             APPOINTMENT DATE
          ───────────────────────────────────── */

      const appointmentDate = DateTime.fromISO(params.date, {
        zone: business.timezone,
      })
        .startOf('day')
        .toUTC()
        .toJSDate();

      const now = new Date();

      /* ─────────────────────────────────────
             CREATE APPOINTMENT
          ───────────────────────────────────── */

      const appointment = await tx.appointment.create({
        data: {
          businessId: params.businessId,

          customerId: params.customerId,

          serviceId: freshService.id,

          /* Snapshots */
          customerName: params.customerName,

          customerPhone: customer.whatsappPhone,

          serviceNameSnapshot: freshService.name,

          servicePriceSnapshot: freshService.price,

          durationMinutesSnapshot: freshService.durationMinutes,

          /* Fecha / hora */
          appointmentDate,

          startTime,

          endTime,

          /* Estado */
          status: AppointmentStatus.CONFIRMED,

          confirmedAt: now,

          notes: params.notes ?? null,

          source: 'WHATSAPP',
        },
      });

      /* ─────────────────────────────────────
             ACTUALIZAR CONTEXT
          ───────────────────────────────────── */

      const sessionContext = this.toObject(session.context);

      const appointmentContext = this.toObject(sessionContext.appointment);

      const completedContext = {
        ...sessionContext,

        appointment: {
          ...appointmentContext,

          appointmentId: appointment.id,

          bookingStatus: AppointmentStatus.CONFIRMED,
        },
      };

      /* ─────────────────────────────────────
             COMPLETAR SESSION
          ───────────────────────────────────── */

      const completedSession = await tx.conversationSession.update({
        where: {
          id: session.id,
        },

        data: {
          status: SessionStatus.COMPLETED,

          completedAt: now,

          expiresAt: null,

          context: completedContext as Prisma.InputJsonValue,
        },
      });

      return {
        appointment,
        session: completedSession,
      };
    });

    /*
     * Observabilidad después del COMMIT.
     *
     * Un error de InteractionLog no debe revertir
     * una cita que ya fue confirmada.
     */
    await this.writeBookingLogsSafely({
      correlationId: params.correlationId,

      businessId: params.businessId,

      customerId: params.customerId,

      conversationId: result.session.conversationId,

      sessionId: result.session.id,

      appointmentId: result.appointment.id,

      serviceId: result.appointment.serviceId,

      startTime: result.appointment.startTime,
    });

    return result;
  }

  /* ─────────────────────────────────────────────
     LOGGING
  ───────────────────────────────────────────── */

  private async writeBookingLogsSafely(params: {
    correlationId: string;

    businessId: string;

    customerId: string;

    conversationId: string;

    sessionId: string;

    appointmentId: string;

    serviceId: string | null;

    startTime: Date;
  }) {
    try {
      await this.interactionLogsService.create({
        businessId: params.businessId,

        customerId: params.customerId,

        conversationId: params.conversationId,

        correlationId: params.correlationId,

        eventType: INTERACTION_EVENT_TYPES.APPOINTMENT_CREATED,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.CONFIRMATION,

        description: 'La cita fue creada y confirmada.',

        metadata: {
          appointmentId: params.appointmentId,

          serviceId: params.serviceId,

          startTime: params.startTime.toISOString(),
        },
      });

      await this.interactionLogsService.create({
        businessId: params.businessId,

        customerId: params.customerId,

        conversationId: params.conversationId,

        correlationId: params.correlationId,

        eventType: INTERACTION_EVENT_TYPES.SESSION_COMPLETED,

        flowKey: FLOW_KEYS.APPOINTMENT,

        description: 'La sesión de agendamiento fue completada.',

        metadata: {
          sessionId: params.sessionId,

          appointmentId: params.appointmentId,
        },
      });

      await this.interactionLogsService.create({
        businessId: params.businessId,

        customerId: params.customerId,

        conversationId: params.conversationId,

        correlationId: params.correlationId,

        eventType: INTERACTION_EVENT_TYPES.FLOW_COMPLETED,

        flowKey: FLOW_KEYS.APPOINTMENT,

        description: 'El flujo APPOINTMENT terminó correctamente.',

        metadata: {
          sessionId: params.sessionId,

          appointmentId: params.appointmentId,
        },
      });
    } catch {
      /*
       * La cita ya está confirmada.
       * La observabilidad no debe revertirla.
       */
    }
  }

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */

  private toObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}
