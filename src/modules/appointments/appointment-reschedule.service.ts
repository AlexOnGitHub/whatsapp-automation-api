import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AppointmentStatus } from '@prisma/client';

import { randomUUID } from 'crypto';

import { DateTime } from 'luxon';

import { PrismaService } from '../../database/prisma/prisma.service';

import {
  BUSINESS_WEEKDAYS,
  parseBusinessHoursConfig,
} from '../../common/config/business-hours.config';

import { INTERACTION_EVENT_TYPES } from '../../common/constants/interaction-event-types';

import { FLOW_KEYS } from '../../common/flows/flow-registry';

import { BusinessesService } from '../businesses/businesses.service';

import { BusinessConfigsService } from '../business-configs/business-configs.service';

import { ServicesCatalogService } from '../services-catalog/services-catalog.service';

import { AppointmentAvailabilityService } from '../appointment-availability/appointment-availability.service';

import { InteractionLogsService } from '../interaction-logs/interaction-logs.service';

import { AppointmentSlotUnavailableException } from '../appointment-booking/appointment-booking.errors';

import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';

const RESCHEDULABLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.RESCHEDULED,
];

const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.RESCHEDULED,
];

@Injectable()
export class AppointmentRescheduleService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly businessesService: BusinessesService,

    private readonly businessConfigsService: BusinessConfigsService,

    private readonly servicesCatalogService: ServicesCatalogService,

    private readonly appointmentAvailabilityService: AppointmentAvailabilityService,

    private readonly interactionLogsService: InteractionLogsService,
  ) {}

  /* ─────────────────────────────────────────────
     RESCHEDULE
  ───────────────────────────────────────────── */

  async reschedule(
    businessId: string,
    appointmentId: string,
    dto: RescheduleAppointmentDto,
  ) {
    const correlationId = dto.correlationId ?? randomUUID();

    /* ───────────────────────────────────────────
       PREVALIDACIONES
    ─────────────────────────────────────────── */

    const business =
      await this.businessesService.ensureBusinessIsActive(businessId);

    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,

        businessId,
      },
    });

    if (!appointment) {
      throw new NotFoundException(`No se encontró la cita ${appointmentId}`);
    }

    this.ensureCanReschedule(appointment.status);

    if (!appointment.serviceId) {
      throw new ConflictException(
        'La cita no tiene un servicio asociado y no puede reprogramarse automáticamente',
      );
    }

    await this.servicesCatalogService.findEnabledById(
      businessId,
      appointment.serviceId,
    );

    /* ───────────────────────────────────────────
       DISPONIBILIDAD PRELIMINAR
    ─────────────────────────────────────────── */

    const availableSlots =
      await this.appointmentAvailabilityService.getAvailableSlots({
        businessId,

        serviceId: appointment.serviceId,

        date: dto.date,

        excludeAppointmentId: appointment.id,
      });

    const selectedSlot = availableSlots.find(
      (slot) => slot.localTime === dto.time,
    );

    if (!selectedSlot) {
      throw new AppointmentSlotUnavailableException(
        'El nuevo horario seleccionado no está disponible',
      );
    }

    if (
      selectedSlot.startTime.getTime() === appointment.startTime.getTime() &&
      selectedSlot.endTime.getTime() === appointment.endTime.getTime()
    ) {
      throw new ConflictException(
        'La nueva fecha y horario son iguales a los actuales',
      );
    }

    const previousSchedule = {
      startTime: appointment.startTime,

      endTime: appointment.endTime,

      status: appointment.status,
    };

    /*
     * Serializamos operaciones que intentan
     * reservar el mismo business/date.
     */
    const lockKey = `appointment:${businessId}:${dto.date}`;

    const result = await this.prisma.$transaction(async (tx) => {
      /* ─────────────────────────────────────
             ADVISORY LOCK
          ───────────────────────────────────── */

      /*
       * IMPORTANTE:
       * pg_advisory_xact_lock devuelve void.
       *
       * Prisma + adapter-pg no puede
       * deserializar void, por eso hacemos
       * cast explícito a text.
       */
      await tx.$queryRaw<
        {
          lockResult: string | null;
        }[]
      >`
            SELECT
              pg_advisory_xact_lock(
                hashtext(${lockKey})::bigint
              )::text AS "lockResult"
          `;

      /* ─────────────────────────────────────
             FRESH APPOINTMENT
          ───────────────────────────────────── */

      const freshAppointment = await tx.appointment.findUnique({
        where: {
          id: appointmentId,
        },
      });

      if (!freshAppointment) {
        throw new NotFoundException(`No se encontró la cita ${appointmentId}`);
      }

      if (freshAppointment.businessId !== businessId) {
        throw new ConflictException('La cita no pertenece al negocio indicado');
      }

      this.ensureCanReschedule(freshAppointment.status);

      if (!freshAppointment.serviceId) {
        throw new ConflictException('La cita no tiene un servicio asociado');
      }

      /* ─────────────────────────────────────
             FRESH SERVICE
          ───────────────────────────────────── */

      const service = await tx.service.findFirst({
        where: {
          id: freshAppointment.serviceId,

          businessId,

          enabled: true,
        },
      });

      if (!service) {
        throw new ConflictException(
          'El servicio de la cita ya no está habilitado',
        );
      }

      /* ─────────────────────────────────────
             BUSINESS HOURS
          ───────────────────────────────────── */

      const config = await tx.businessConfig.findUnique({
        where: {
          businessId,
        },
      });

      if (!config) {
        throw new NotFoundException(
          'El negocio no tiene configuración registrada',
        );
      }

      const targetStart = DateTime.fromISO(`${dto.date}T${dto.time}`, {
        zone: business.timezone,
      });

      if (!targetStart.isValid) {
        throw new ConflictException('La nueva fecha u horario no es válido');
      }

      const now = DateTime.now().setZone(business.timezone);

      if (targetStart <= now) {
        throw new ConflictException(
          'No es posible reprogramar una cita hacia una fecha u horario pasado',
        );
      }

      const targetEnd = targetStart.plus({
        minutes: service.durationMinutes,
      });

      /*
       * Revalidamos horario comercial DENTRO
       * de la transacción.
       */
      const businessHours = parseBusinessHoursConfig(
        config.businessHoursConfig,
      );

      const weekday = BUSINESS_WEEKDAYS[targetStart.weekday - 1];

      if (!weekday) {
        throw new ConflictException(
          'No fue posible determinar el día de la semana',
        );
      }

      const schedule = businessHours[weekday];

      if (!schedule.enabled || !schedule.open || !schedule.close) {
        throw new AppointmentSlotUnavailableException(
          'El negocio no opera en la fecha seleccionada',
        );
      }

      const opening = DateTime.fromISO(`${dto.date}T${schedule.open}`, {
        zone: business.timezone,
      });

      const closing = DateTime.fromISO(`${dto.date}T${schedule.close}`, {
        zone: business.timezone,
      });

      if (targetStart < opening || targetEnd > closing) {
        throw new AppointmentSlotUnavailableException(
          'El horario seleccionado está fuera del horario del negocio',
        );
      }

      /*
       * También respetamos la cuadrícula
       * configurada de slots.
       */
      const minutesFromOpening = targetStart.diff(opening, 'minutes').minutes;

      if (
        minutesFromOpening < 0 ||
        minutesFromOpening % schedule.slotIntervalMinutes !== 0
      ) {
        throw new AppointmentSlotUnavailableException(
          'El horario seleccionado no corresponde a un slot válido',
        );
      }

      const startTime = targetStart.toUTC().toJSDate();

      const endTime = targetEnd.toUTC().toJSDate();

      /* ─────────────────────────────────────
             REVALIDAR TRASLAPES BAJO LOCK
          ───────────────────────────────────── */

      const overlap = await tx.appointment.findFirst({
        where: {
          businessId,

          /*
           * Excluir la propia cita.
           */
          id: {
            not: freshAppointment.id,
          },

          status: {
            in: BLOCKING_STATUSES,
          },

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

      if (overlap) {
        throw new AppointmentSlotUnavailableException(
          'El horario dejó de estar disponible mientras se procesaba la reprogramación',
        );
      }

      /* ─────────────────────────────────────
             UPDATE COMPARE-AND-SET
          ───────────────────────────────────── */

      const updated = await tx.appointment.updateMany({
        where: {
          id: freshAppointment.id,

          businessId,

          /*
           * Protege contra:
           *
           * RESCHEDULE vs CANCEL
           * RESCHEDULE vs COMPLETE
           * RESCHEDULE vs NO_SHOW
           */
          status: freshAppointment.status,
        },

        data: {
          appointmentDate: targetStart.startOf('day').toUTC().toJSDate(),

          startTime,

          endTime,

          /*
           * La duración puede haber cambiado
           * en el catálogo desde la reserva
           * original.
           */
          durationMinutesSnapshot: service.durationMinutes,

          status: AppointmentStatus.RESCHEDULED,

          rescheduledAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException(
          'La cita cambió de estado mientras se procesaba la reprogramación',
        );
      }

      return tx.appointment.findUniqueOrThrow({
        where: {
          id: freshAppointment.id,
        },
      });
    });

    /* ───────────────────────────────────────────
       OBSERVABILIDAD
    ─────────────────────────────────────────── */

    await this.writeRescheduleLogSafely({
      correlationId,

      appointment: result,

      previousStartTime: previousSchedule.startTime,

      previousEndTime: previousSchedule.endTime,

      previousStatus: previousSchedule.status,

      reason: dto.reason,
    });

    return result;
  }

  /* ─────────────────────────────────────────────
     STATE MACHINE
  ───────────────────────────────────────────── */

  private ensureCanReschedule(status: AppointmentStatus) {
    if (!RESCHEDULABLE_STATUSES.includes(status)) {
      throw new ConflictException(
        `No es posible reprogramar una cita con estado ${status}`,
      );
    }
  }

  /* ─────────────────────────────────────────────
     OBSERVABILITY
  ───────────────────────────────────────────── */

  private async writeRescheduleLogSafely(params: {
    correlationId: string;

    appointment: {
      id: string;

      businessId: string;

      customerId: string;

      startTime: Date;

      endTime: Date;

      status: AppointmentStatus;
    };

    previousStartTime: Date;

    previousEndTime: Date;

    previousStatus: AppointmentStatus;

    reason?: string;
  }) {
    try {
      await this.interactionLogsService.create({
        businessId: params.appointment.businessId,

        customerId: params.appointment.customerId,

        correlationId: params.correlationId,

        eventType: INTERACTION_EVENT_TYPES.APPOINTMENT_RESCHEDULED,

        flowKey: FLOW_KEYS.APPOINTMENT,

        description: 'La cita fue reprogramada.',

        metadata: {
          appointmentId: params.appointment.id,

          previousStatus: params.previousStatus,

          previousStartTime: params.previousStartTime.toISOString(),

          previousEndTime: params.previousEndTime.toISOString(),

          newStatus: params.appointment.status,

          newStartTime: params.appointment.startTime.toISOString(),

          newEndTime: params.appointment.endTime.toISOString(),

          reason: params.reason,
        },
      });
    } catch {
      /*
       * Una reprogramación confirmada
       * no debe revertirse por logging.
       */
    }
  }
}
