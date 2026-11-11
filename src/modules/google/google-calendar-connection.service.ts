import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  IntegrationJobType,
  IntegrationStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';

import { PrismaService } from '../../database/prisma/prisma.service';
import {
  GOOGLE_CALENDAR_DEFAULT_ID,
  GOOGLE_PROVIDER,
  GOOGLE_WORKSPACE_INTEGRATION_TYPE,
  googleWorkspaceLockKey,
} from './google.constants';
import type { GoogleOAuth2Client } from './google-oauth.service';

type CalendarDestination = {
  accountCalendarId: string;
  calendarId: string;
  selection: string;
};

type PendingDestination = CalendarDestination & { confirmationId: string };

function readSettings(value: Prisma.JsonValue): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function destination(
  value: Prisma.JsonValue | undefined,
): CalendarDestination | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { accountCalendarId, calendarId, selection } = value;
  return typeof accountCalendarId === 'string' &&
    typeof calendarId === 'string' &&
    typeof selection === 'string'
    ? { accountCalendarId, calendarId, selection }
    : null;
}

@Injectable()
export class GoogleCalendarConnectionService {
  constructor(private readonly prisma: PrismaService) {}

  async connect(
    businessId: string,
    auth: GoogleOAuth2Client,
    credentialsEncrypted: string,
    requestedCalendar?: string,
  ) {
    const existing = await this.prisma.integration.findUnique({
      where: this.integrationKey(businessId),
    });
    const currentSettings = readSettings(existing?.settings ?? null);
    const current = destination(currentSettings.calendarDestination);
    const selection =
      requestedCalendar ??
      current?.selection ??
      (typeof currentSettings.calendarId === 'string'
        ? currentSettings.calendarId
        : GOOGLE_CALENDAR_DEFAULT_ID);
    const calendar = google.calendar({
      version: 'v3',
      auth,
      timeout: 15_000,
      retry: false,
    });
    const { data: primary } = await calendar.calendars.get({
      calendarId: GOOGLE_CALENDAR_DEFAULT_ID,
    });
    const target =
      selection === GOOGLE_CALENDAR_DEFAULT_ID
        ? primary
        : (await calendar.calendars.get({ calendarId: selection })).data;
    if (!primary.id || !target.id)
      throw new ConflictException(
        'Google no identificó el calendario de destino',
      );
    const next = {
      accountCalendarId: primary.id,
      calendarId: target.id,
      selection,
    };

    return this.withConnectionLock(businessId, async (tx) => {
      const integration = await tx.integration.findUnique({
        where: this.integrationKey(businessId),
      });
      const settings = readSettings(integration?.settings ?? null);
      const previous = destination(settings.calendarDestination);
      const changed =
        integration &&
        (previous?.accountCalendarId !== next.accountCalendarId ||
          previous.calendarId !== next.calendarId);
      if (changed) {
        const pendingCalendar: PendingDestination = {
          ...next,
          confirmationId: randomUUID(),
        };
        await tx.integration.update({
          where: this.integrationKey(businessId),
          data: {
            status: IntegrationStatus.INACTIVE,
            pendingCredentialsEncrypted: credentialsEncrypted,
            settings: { ...settings, pendingCalendar },
            lastError:
              'Confirma el destino de Google Calendar para reanudar la sincronización',
            lastErrorAt: new Date(),
          },
        });
        return {
          connected: false,
          businessId,
          status: IntegrationStatus.INACTIVE,
          requiresConfirmation: true,
        };
      }

      return this.activate(
        tx,
        businessId,
        settings,
        next,
        credentialsEncrypted,
        false,
        Boolean(integration),
      );
    });
  }

  async getConnection(businessId: string) {
    const integration = await this.prisma.integration.findUnique({
      where: this.integrationKey(businessId),
    });
    if (!integration)
      throw new NotFoundException(
        'No existe una conexión con Google Workspace',
      );
    const settings = readSettings(integration.settings);
    return {
      status: integration.status,
      destination: destination(settings.calendarDestination),
      pendingDestination: settings.pendingCalendar ?? null,
    };
  }

  async confirm(
    businessId: string,
    confirmationId: string,
    preserveLegacyLinks?: boolean,
  ) {
    return this.withConnectionLock(businessId, async (tx) => {
      const integration = await tx.integration.findUnique({
        where: this.integrationKey(businessId),
      });
      const settings = readSettings(integration?.settings ?? null);
      const pending = settings.pendingCalendar;
      const next = destination(pending);
      if (
        !next ||
        !pending ||
        typeof pending !== 'object' ||
        Array.isArray(pending) ||
        pending.confirmationId !== confirmationId ||
        !integration?.pendingCredentialsEncrypted
      ) {
        throw new ConflictException(
          'El destino pendiente no coincide con esta confirmación',
        );
      }

      const previous = destination(settings.calendarDestination);
      if (!previous && preserveLegacyLinks === undefined) {
        throw new BadRequestException(
          'Indica si el destino coincide con el calendario de la conexión anterior',
        );
      }
      const changed = Boolean(previous) || !preserveLegacyLinks;
      return this.activate(
        tx,
        businessId,
        settings,
        next,
        integration.pendingCredentialsEncrypted,
        changed,
        true,
      );
    });
  }

  private async activate(
    tx: Prisma.TransactionClient,
    businessId: string,
    settings: Prisma.JsonObject,
    target: CalendarDestination,
    credentialsEncrypted: string,
    changed: boolean,
    reconnecting: boolean,
  ) {
    const nextSettings: Prisma.JsonObject = {
      ...settings,
      calendarId: target.calendarId,
      calendarDestination: target,
    };
    delete nextSettings.pendingCalendar;
    const data = {
      status: IntegrationStatus.ACTIVE,
      credentialsEncrypted,
      pendingCredentialsEncrypted: null,
      settings: nextSettings as Prisma.InputJsonObject,
      lastError: null,
      lastErrorAt: null,
    };
    const integration = await tx.integration.upsert({
      where: this.integrationKey(businessId),
      create: {
        ...data,
        businessId,
        provider: GOOGLE_PROVIDER,
        integrationType: GOOGLE_WORKSPACE_INTEGRATION_TYPE,
      },
      update: data,
    });

    if (changed) {
      await tx.appointment.updateMany({
        where: { businessId, googleCalendarEventId: { not: null } },
        data: { googleCalendarEventId: null },
      });
    }

    const appointments = await tx.appointment.findMany({
      where: {
        businessId,
        OR: [
          {
            status: {
              in: [AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED],
            },
            endTime: { gt: new Date() },
          },
          ...(reconnecting && !changed
            ? [{ status: AppointmentStatus.CANCELLED }]
            : []),
        ],
      },
      select: { id: true, status: true },
    });
    const pending = await tx.integrationJob.findMany({
      where: {
        businessId,
        status: { in: ['PENDING', 'PROCESSING'] },
        entityType: 'APPOINTMENT',
        jobType: {
          in: [
            IntegrationJobType.GOOGLE_CALENDAR_UPDATE,
            IntegrationJobType.GOOGLE_CALENDAR_DELETE,
          ],
        },
      },
      select: { entityId: true, jobType: true },
    });
    const queued = new Set(
      pending.map((job) => `${job.entityId}:${job.jobType}`),
    );
    const jobs = appointments.flatMap(({ id, status }) => {
      const jobType =
        status === AppointmentStatus.CANCELLED
          ? IntegrationJobType.GOOGLE_CALENDAR_DELETE
          : IntegrationJobType.GOOGLE_CALENDAR_UPDATE;
      return queued.has(`${id}:${jobType}`)
        ? []
        : [{ businessId, entityId: id, entityType: 'APPOINTMENT', jobType }];
    });
    if (jobs.length) await tx.integrationJob.createMany({ data: jobs });
    return {
      connected: true,
      businessId,
      provider: integration.provider,
      integrationType: integration.integrationType,
      status: integration.status,
      queuedJobs: jobs.length,
    };
  }

  private integrationKey(
    businessId: string,
  ): Prisma.IntegrationWhereUniqueInput {
    return {
      businessId_provider_integrationType: {
        businessId,
        provider: GOOGLE_PROVIDER,
        integrationType: GOOGLE_WORKSPACE_INTEGRATION_TYPE,
      },
    };
  }

  private withConnectionLock<T>(
    businessId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const key = googleWorkspaceLockKey(businessId);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
        return operation(tx);
      },
      { timeout: 30_000 },
    );
  }
}
