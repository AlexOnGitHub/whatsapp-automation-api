import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AppointmentStatus, IntegrationStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';

import { BusinessesService } from '../businesses/businesses.service';

import {
  GOOGLE_CALENDAR_INTEGRATION_TYPE,
  GOOGLE_CALENDAR_PROVIDER,
} from './google-calendar.constants';

import { GoogleCalendarAdapterService } from './google-calendar-adapter.service';

/* ─────────────────────────────────────────────
   ESTADOS SINCRONIZABLES
───────────────────────────────────────────── */

const SYNCHRONIZABLE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.RESCHEDULED,
];

@Injectable()
export class AppointmentCalendarSyncService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly businessesService: BusinessesService,

    private readonly googleCalendarAdapterService: GoogleCalendarAdapterService,
  ) {}

  /* ─────────────────────────────────────────────
     CREATE / ENSURE
  ───────────────────────────────────────────── */

  async syncCreate(businessId: string, appointmentId: string) {
    const { appointment, business } = await this.loadContext(
      businessId,
      appointmentId,
    );

    /*
     * Validamos primero el estado.
     *
     * No queremos considerar "sincronizada"
     * una cita CANCELLED/COMPLETED solamente
     * porque accidentalmente conserve un ID.
     */
    this.ensureCanCreateOrUpdate(appointment.status);

    /*
     * Idempotencia:
     *
     * Si ya existe un eventId remoto,
     * POST sync no vuelve a insertar.
     */
    if (appointment.googleCalendarEventId) {
      return {
        synchronized: true,

        created: false,

        eventId: appointment.googleCalendarEventId,
      };
    }

    try {
      const event = await this.googleCalendarAdapterService.createEvent({
        businessId,

        appointmentId: appointment.id,

        summary: this.buildSummary(
          appointment.serviceNameSnapshot,
          appointment.customerName,
        ),

        description: this.buildDescription(appointment),

        startTime: appointment.startTime,

        endTime: appointment.endTime,

        timeZone: business.timezone,
      });

      if (!event.id) {
        throw new Error('Google Calendar no devolvió eventId');
      }

      /*
       * Guardamos el vínculo local-remoto.
       */
      const updateResult = await this.prisma.appointment.updateMany({
        where: {
          id: appointment.id,

          businessId,

          /*
           * Evitamos pisar un eventId que
           * hubiera sido registrado por otra
           * operación concurrente.
           */
          googleCalendarEventId: null,
        },

        data: {
          googleCalendarEventId: event.id,
        },
      });

      /*
       * Si otra operación ganó la carrera después
       * de haber creado el evento remoto, tenemos
       * una situación excepcional de concurrencia.
       *
       * Por ahora la detectamos explícitamente.
       */
      if (updateResult.count !== 1) {
        throw new ConflictException(
          'La cita cambió su estado de sincronización mientras se creaba el evento de Google Calendar',
        );
      }

      await this.markIntegrationSuccess(businessId);

      return {
        synchronized: true,

        created: true,

        eventId: event.id,

        htmlLink: event.htmlLink ?? null,
      };
    } catch (error) {
      await this.markIntegrationError(businessId, error);

      throw error;
    }
  }

  /* ─────────────────────────────────────────────
     UPDATE
  ───────────────────────────────────────────── */

  async syncUpdate(businessId: string, appointmentId: string) {
    const { appointment, business } = await this.loadContext(
      businessId,
      appointmentId,
    );

    this.ensureCanCreateOrUpdate(appointment.status);

    /*
     * Si todavía no existe evento remoto,
     * usamos syncCreate.
     *
     * Esto permite recuperar una cita cuya
     * sincronización inicial haya fallado.
     */
    if (!appointment.googleCalendarEventId) {
      return this.syncCreate(businessId, appointmentId);
    }

    try {
      const event = await this.googleCalendarAdapterService.updateEvent({
        businessId,

        eventId: appointment.googleCalendarEventId,

        appointmentId: appointment.id,

        summary: this.buildSummary(
          appointment.serviceNameSnapshot,
          appointment.customerName,
        ),

        description: this.buildDescription(appointment),

        startTime: appointment.startTime,

        endTime: appointment.endTime,

        timeZone: business.timezone,
      });

      await this.markIntegrationSuccess(businessId);

      return {
        synchronized: true,

        updated: true,

        eventId: event.id ?? appointment.googleCalendarEventId,

        htmlLink: event.htmlLink ?? null,
      };
    } catch (error) {
      await this.markIntegrationError(businessId, error);

      throw error;
    }
  }

  /* ─────────────────────────────────────────────
     DELETE
  ───────────────────────────────────────────── */

  async syncDelete(businessId: string, appointmentId: string) {
    /*
     * Aquí deliberadamente NO usamos
     * ensureCanCreateOrUpdate().
     *
     * Una cita CANCELLED justamente necesita
     * poder borrar su evento remoto.
     */
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,

        businessId,
      },
    });

    if (!appointment) {
      throw new NotFoundException('No se encontró la cita');
    }

    /*
     * Idempotencia:
     * no existe vínculo remoto, por lo tanto
     * el estado deseado ya está conseguido.
     */
    if (!appointment.googleCalendarEventId) {
      return {
        synchronized: true,

        deleted: false,

        reason: 'NO_REMOTE_EVENT',
      };
    }

    const eventId = appointment.googleCalendarEventId;

    try {
      await this.googleCalendarAdapterService.deleteEvent(businessId, eventId);

      /*
       * Limpiamos la referencia únicamente si
       * sigue apuntando al mismo eventId que
       * acabamos de eliminar.
       */
      const updateResult = await this.prisma.appointment.updateMany({
        where: {
          id: appointment.id,

          businessId,

          googleCalendarEventId: eventId,
        },

        data: {
          googleCalendarEventId: null,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException(
          'La referencia de Google Calendar cambió mientras se eliminaba el evento',
        );
      }

      await this.markIntegrationSuccess(businessId);

      return {
        synchronized: true,

        deleted: true,

        eventId,
      };
    } catch (error) {
      await this.markIntegrationError(businessId, error);

      throw error;
    }
  }

  /* ─────────────────────────────────────────────
     DOMAIN VALIDATION
  ───────────────────────────────────────────── */

  private ensureCanCreateOrUpdate(status: AppointmentStatus) {
    if (!SYNCHRONIZABLE_APPOINTMENT_STATUSES.includes(status)) {
      throw new ConflictException(
        `No es posible sincronizar una cita con estado ${status}`,
      );
    }
  }

  /* ─────────────────────────────────────────────
     DOMAIN CONTEXT
  ───────────────────────────────────────────── */

  private async loadContext(businessId: string, appointmentId: string) {
    const business = await this.businessesService.findById(businessId);

    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,

        businessId,
      },
    });

    if (!appointment) {
      throw new NotFoundException('No se encontró la cita');
    }

    return {
      business,
      appointment,
    };
  }

  /* ─────────────────────────────────────────────
     EVENT CONTENT
  ───────────────────────────────────────────── */

  private buildSummary(serviceName: string, customerName: string) {
    return `${serviceName} - ${customerName}`;
  }

  private buildDescription(appointment: {
    id: string;

    customerName: string;

    customerPhone: string | null;

    serviceNameSnapshot: string;

    notes: string | null;

    source: string | null;
  }) {
    return [
      'Cita generada por WhatUp',

      '',

      `Folio: ${appointment.id}`,

      `Cliente: ${appointment.customerName}`,

      appointment.customerPhone
        ? `Teléfono: ${appointment.customerPhone}`
        : null,

      `Servicio: ${appointment.serviceNameSnapshot}`,

      appointment.notes ? `Notas: ${appointment.notes}` : null,

      appointment.source ? `Origen: ${appointment.source}` : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join('\n');
  }

  /* ─────────────────────────────────────────────
     INTEGRATION STATUS
  ───────────────────────────────────────────── */

  private async markIntegrationSuccess(businessId: string) {
    await this.prisma.integration.update({
      where: {
        businessId_provider_integrationType: {
          businessId,

          provider: GOOGLE_CALENDAR_PROVIDER,

          integrationType: GOOGLE_CALENDAR_INTEGRATION_TYPE,
        },
      },

      data: {
        status: IntegrationStatus.ACTIVE,

        lastSyncedAt: new Date(),

        lastError: null,

        lastErrorAt: null,
      },
    });
  }

  private async markIntegrationError(businessId: string, error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Error desconocido de Google Calendar';

    try {
      await this.prisma.integration.update({
        where: {
          businessId_provider_integrationType: {
            businessId,

            provider: GOOGLE_CALENDAR_PROVIDER,

            integrationType: GOOGLE_CALENDAR_INTEGRATION_TYPE,
          },
        },

        data: {
          status: IntegrationStatus.ERROR,

          lastError: message.slice(0, 2000),

          lastErrorAt: new Date(),
        },
      });
    } catch {
      /*
       * Nunca reemplazamos el error original
       * por un error secundario de observabilidad.
       */
    }
  }
}
