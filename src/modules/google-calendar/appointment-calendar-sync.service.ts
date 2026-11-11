import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AppointmentStatus, IntegrationStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';

import { BusinessesService } from '../businesses/businesses.service';

import {
  GOOGLE_PROVIDER,
  googleWorkspaceLockKey,
  GOOGLE_WORKSPACE_INTEGRATION_TYPE,
} from '../google/google.constants';

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

  syncCreate(businessId: string, appointmentId: string) {
    return this.withAppointmentLock(businessId, appointmentId, () =>
      this.syncCreateLocked(businessId, appointmentId),
    );
  }

  private async syncCreateLocked(businessId: string, appointmentId: string) {
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
      const eventParams = {
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
      };

      const { event, created } =
        await this.googleCalendarAdapterService.createEvent(eventParams);

      if (!event.id) {
        throw new Error('Google Calendar no devolvió eventId');
      }

      if (!created) {
        // The orphan may have been created before the latest reschedule.
        await this.googleCalendarAdapterService.updateEvent({
          ...eventParams,
          eventId: event.id,
        });
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
       */
      if (updateResult.count !== 1) {
        throw new ConflictException(
          'La cita cambió su estado de sincronización mientras se creaba el evento de Google Calendar',
        );
      }

      await this.markIntegrationSuccess(businessId);

      return {
        synchronized: true,

        created,

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

  syncUpdate(businessId: string, appointmentId: string) {
    return this.withAppointmentLock(businessId, appointmentId, () =>
      this.syncUpdateLocked(businessId, appointmentId),
    );
  }

  private async syncUpdateLocked(businessId: string, appointmentId: string) {
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
      return this.syncCreateLocked(businessId, appointmentId);
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

  syncDelete(businessId: string, appointmentId: string) {
    return this.withAppointmentLock(businessId, appointmentId, () =>
      this.syncDeleteLocked(businessId, appointmentId),
    );
  }

  private async syncDeleteLocked(businessId: string, appointmentId: string) {
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

    const eventId = appointment.googleCalendarEventId;

    try {
      if (!eventId) {
        // A completed insert may have lost its local link before cancellation.
        const recoveredId = appointment.status === AppointmentStatus.CANCELLED
          ? await this.googleCalendarAdapterService.deleteUnlinkedAppointmentEvents(
              businessId,
              appointmentId,
            )
          : undefined;

        if (recoveredId) {
          await this.markIntegrationSuccess(businessId);
          return { synchronized: true, deleted: true, eventId: recoveredId };
        }

        return { synchronized: true, deleted: false, reason: 'NO_REMOTE_EVENT' };
      }

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

  private withAppointmentLock<T>(
    businessId: string,
    appointmentId: string,
    synchronize: () => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify(['google-calendar', businessId, appointmentId]);

    // The transaction holds the cross-process lock. Synchronization persists
    // its changes separately so a remote operation can be recovered on retry.
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT CASE
            WHEN pg_try_advisory_xact_lock_shared(hashtextextended(${googleWorkspaceLockKey(businessId)}, 0))
            THEN pg_try_advisory_xact_lock(hashtextextended(${key}, 0))
            ELSE FALSE
          END AS acquired
        `;

        if (!lock?.acquired) {
          throw new ConflictException('La cita ya se está sincronizando con Google Calendar');
        }

        return synchronize();
      },
      { timeout: 90_000 },
    );
  }


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

  private buildSummary(serviceName: string, customerName: string): string {
    return `${serviceName} - ${customerName}`;
  }

  private buildDescription(appointment: {
    id: string;

    customerName: string;

    customerPhone: string | null;

    serviceNameSnapshot: string;

    notes: string | null;

    source: string | null;
  }): string {
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
     GOOGLE WORKSPACE STATUS
  ───────────────────────────────────────────── */

  private async markIntegrationSuccess(businessId: string) {
    await this.prisma.integration.updateMany({
      where: {
        businessId,
        provider: GOOGLE_PROVIDER,
        integrationType: GOOGLE_WORKSPACE_INTEGRATION_TYPE,
        status: IntegrationStatus.ACTIVE,
      },

      data: {
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
      await this.prisma.integration.updateMany({
        where: {
          businessId,
          provider: GOOGLE_PROVIDER,
          integrationType: GOOGLE_WORKSPACE_INTEGRATION_TYPE,
          status: IntegrationStatus.ACTIVE,
        },

        data: {
          /*
           * IMPORTANTE:
           *
           * No cambiamos WORKSPACE a ERROR por
           * cualquier fallo operacional de Calendar.
           *
           * Un timeout, rate limit o fallo temporal
           * debe poder ser reintentado por
           * IntegrationJobs.
           *
           * Además, Calendar no debe deshabilitar
           * accidentalmente Google Sheets.
           */
          lastError: `Google Calendar: ${message}`.slice(0, 2000),

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
