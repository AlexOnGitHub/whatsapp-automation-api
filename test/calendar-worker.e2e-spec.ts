import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { google, type calendar_v3 } from 'googleapis';
import { IntegrationCryptoService } from '../src/common/security/integration-crypto.service';
import { GoogleClientService } from '../src/modules/google/google-client.service';
import { GoogleCalendarConnectionService } from '../src/modules/google/google-calendar-connection.service';
import type { GoogleOAuth2Client } from '../src/modules/google/google-oauth.service';
import { DateTime } from 'luxon';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { BUSINESS_WEEKDAYS } from '../src/common/config/business-hours.config';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { AppointmentAvailabilityService } from '../src/modules/appointment-availability/appointment-availability.service';
import { AppointmentBookingService } from '../src/modules/appointment-booking/appointment-booking.service';
import { AppointmentCalendarSyncService } from '../src/modules/google-calendar/appointment-calendar-sync.service';
import { GoogleCalendarClientService } from '../src/modules/google-calendar/google-calendar-client.service';
import { IntegrationJobsProcessor } from '../src/modules/integration-jobs/integration-jobs.processor';
import { IntegrationJobsWorker } from '../src/modules/integration-jobs/integration-jobs.worker';
import { IntegrationJobsService } from '../src/modules/integration-jobs/integration-jobs.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const connectionString = process.env.CALENDAR_E2E_DATABASE_URL;
const describeWithDatabase = connectionString ? describe : describe.skip;

describeWithDatabase('Calendar worker and HTTP isolation', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let firstWorker: IntegrationJobsProcessor;
  let secondWorker: IntegrationJobsProcessor;
  let jobs: IntegrationJobsService;
  let businessId: string;
  let otherBusinessId: string;
  let customerId: string;
  let otherCustomerId: string;
  let serviceId: string;
  const date = DateTime.utc().plus({ days: 7 }).toISODate()!;
  const operator = 'Bearer calendar-e2e-operator';
  const events = new Map<string, calendar_v3.Schema$Event>();
  let pauseInsert: (() => Promise<void>) | undefined;
  let failAfterInsert = false;
  let insertCalls = 0;

  const calendar = {
    events: {
      insert: async ({
        requestBody,
      }: {
        requestBody: calendar_v3.Schema$Event;
      }) => {
        insertCalls++;
        const id = requestBody.id!;
        if (events.has(id))
          throw Object.assign(new Error('duplicate'), {
            response: { status: 409 },
          });
        events.set(id, requestBody);
        await pauseInsert?.();
        if (failAfterInsert)
          throw new Error('Connection dropped after Calendar accepted insert');
        return { data: requestBody };
      },
      get: async ({ eventId }: { eventId: string }) => ({
        data: events.get(eventId),
      }),
      list: async ({
        privateExtendedProperty,
      }: {
        privateExtendedProperty: string[];
      }) => ({
        data: {
          items: [...events.values()].filter((event) =>
            privateExtendedProperty.includes(
              `appointmentId=${event.extendedProperties?.private?.appointmentId}`,
            ),
          ),
        },
      }),
      update: async ({
        eventId,
        requestBody,
      }: {
        eventId: string;
        requestBody: calendar_v3.Schema$Event;
      }) => {
        if (!events.has(eventId))
          throw new Error('Updating missing Calendar event');
        const event = { ...requestBody, id: eventId };
        events.set(eventId, event);
        return { data: event };
      },
      delete: async ({ eventId }: { eventId: string }) => {
        if (!events.delete(eventId))
          throw Object.assign(new Error('gone'), { response: { status: 410 } });
      },
    },
  };

  beforeAll(async () => {
    const schema = new URL(connectionString!).searchParams.get('schema') ?? '';
    if (!/^calendar_e2e_[a-f0-9]{12}$/.test(schema)) {
      throw new Error('Use a disposable calendar_e2e schema');
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString, options: `-c search_path=${schema}` },
        { schema },
      ),
    });
    const businessHoursConfig = Object.fromEntries(
      BUSINESS_WEEKDAYS.map((day) => [
        day,
        { open: '09:00', close: '18:00', slotIntervalMinutes: 30 },
      ]),
    );
    const business = await prisma.business.create({
      data: {
        name: 'Calendar E2E',
        slug: 'calendar-e2e',
        timezone: 'UTC',
        modules: { create: { moduleKey: 'APPOINTMENT' } },
        config: { create: { welcomeMessage: 'Test', businessHoursConfig } },
        customers: { create: { whatsappPhone: '5210000000001' } },
        services: { create: { name: 'Test booking', durationMinutes: 30 } },
        integrations: {
          create: { provider: 'GOOGLE', integrationType: 'WORKSPACE' },
        },
      },
      include: { customers: true, services: true },
    });
    const otherBusiness = await prisma.business.create({
      data: {
        name: 'Other E2E',
        slug: 'calendar-e2e-other',
        customers: { create: { whatsappPhone: '5210000000002' } },
      },
      include: { customers: true },
    });
    businessId = business.id;
    customerId = business.customers[0].id;
    serviceId = business.services[0].id;
    otherBusinessId = otherBusiness.id;
    otherCustomerId = otherBusiness.customers[0].id;
    process.env.API_ADMIN_TOKEN = 'calendar-e2e-admin';
    process.env.API_SERVICE_TOKEN = 'calendar-e2e-operator';
    process.env.API_SERVICE_BUSINESS_ID = businessId;
    process.env.INTEGRATION_JOBS_WORKER_ENABLED = 'false';
    process.env.INTEGRATION_ENCRYPTION_KEY =
      Buffer.alloc(32).toString('base64');

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(GoogleCalendarClientService)
      .useValue({
        getCalendarClient: async () => ({ calendar, calendarId: 'primary' }),
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    jobs = app.get(IntegrationJobsService);
    firstWorker = app.get(IntegrationJobsProcessor);
    secondWorker = new IntegrationJobsProcessor(
      jobs,
      app.get(AppointmentCalendarSyncService),
    );
  }, 20000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function book(time: string) {
    const conversation = await prisma.conversation.create({
      data: { businessId, customerId },
    });
    const session = await prisma.conversationSession.create({
      data: {
        businessId,
        customerId,
        conversationId: conversation.id,
        flowKey: 'APPOINTMENT',
        stepKey: 'CONFIRMATION',
      },
    });
    const { appointment } = await app
      .get(AppointmentBookingService)
      .confirmAppointment({
        businessId,
        customerId,
        serviceId,
        sessionId: session.id,
        date,
        startTime: `${date}T${time}:00Z`,
        customerName: 'Test Customer',
        correlationId: session.id,
      });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    return appointment;
  }

  it('requires authentication and rejects a foreign business or resource ID', async () => {
    const http = request(app.getHttpServer());
    await http.get(`/customers/${customerId}`).expect(401);
    await http
      .get(`/customers/${customerId}`)
      .set('Authorization', operator)
      .expect(200);
    await http
      .get(`/customers/${otherCustomerId}`)
      .set('Authorization', operator)
      .expect(404);
    await http
      .patch(`/customers/${otherCustomerId}`)
      .set('Authorization', operator)
      .send({ displayName: 'Forbidden edit' })
      .expect(404);
    await http
      .get(`/businesses/${otherBusinessId}/appointments`)
      .set('Authorization', operator)
      .expect(403);
    expect(
      (
        await prisma.customer.findUniqueOrThrow({
          where: { id: otherCustomerId },
        })
      ).displayName,
    ).toBeNull();
  });

  it('recovers an expired attempt and runs concurrent workers without repeating the insert', async () => {
    const appointment = await book('09:00');
    const [staleJob] = await jobs.claimNextJobs({
      workerId: 'interrupted-attempt',
      limit: 1,
    });
    expect(staleJob.entityId).toBe(appointment.id);
    await prisma.integrationJob.update({
      where: { id: staleJob.id },
      data: { lockedAt: new Date(0) },
    });

    expect((await jobs.recoverStaleJobs()).recoveredJobs).toBe(1);
    await prisma.integrationJob.update({
      where: { id: staleJob.id },
      data: { nextAttemptAt: new Date(0) },
    });

    const before = insertCalls;
    const batches = await Promise.all([
      firstWorker.processBatch(1),
      secondWorker.processBatch(1),
    ]);
    expect(
      batches.reduce((total, batch) => total + batch.completedJobs, 0),
    ).toBe(1);
    expect(insertCalls - before).toBe(1);
    const job = await prisma.integrationJob.findUniqueOrThrow({
      where: { id: staleJob.id },
    });
    expect(job).toMatchObject({ status: 'COMPLETED', attempts: 2 });
    await expect(
      jobs.markCompleted({ jobId: job.id, workerId: 'interrupted-attempt' }),
    ).rejects.toThrow();
  });

  it('rejects a concurrent reschedule and applies the winning time in Calendar', async () => {
    const appointment = await book('10:00');
    expect((await firstWorker.processBatch(1)).completedJobs).toBe(1);
    const http = request(app.getHttpServer());
    const route = `/businesses/${businessId}/appointments/${appointment.id}`;
    const reschedule = (time: string) =>
      http
        .patch(`${route}/reschedule`)
        .set('Authorization', operator)
        .send({ date, time });
    await reschedule('11:00').expect(200);
    expect((await firstWorker.processBatch(1)).completedJobs).toBe(1);

    const availability = app.get(AppointmentAvailabilityService);
    const original = availability.getAvailableSlots.bind(availability);
    const bothRead = deferred();
    let requests = 0;
    const spy = jest
      .spyOn(availability, 'getAvailableSlots')
      .mockImplementation(async (params) => {
        if (++requests === 2) bothRead.resolve();
        await bothRead.promise;
        return original(params);
      });
    try {
      const responses = await Promise.all([
        reschedule('12:00'),
        reschedule('13:00'),
      ]);
      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      const winner = responses.find(({ status }) => status === 200)!.body;
      expect(
        await prisma.integrationJob.count({
          where: { entityId: appointment.id, status: 'PENDING' },
        }),
      ).toBe(1);
      expect((await firstWorker.processBatch(1)).completedJobs).toBe(1);
      const stored = await prisma.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      });
      expect(stored.startTime.toISOString()).toBe(winner.startTime);
      expect(events.get(stored.googleCalendarEventId!)?.start?.dateTime).toBe(
        winner.startTime,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('recovers an interrupted insert at the latest rescheduled time', async () => {
    const appointment = await book('14:00');
    failAfterInsert = true;
    try {
      expect((await firstWorker.processBatch(1)).retryScheduledJobs).toBe(1);
    } finally {
      failAfterInsert = false;
    }

    const orphan = [...events.values()].find(
      (event) =>
        event.extendedProperties?.private?.appointmentId === appointment.id,
    )!;
    expect(orphan.start?.dateTime).toBe(appointment.startTime.toISOString());

    const rescheduled = await request(app.getHttpServer())
      .patch(
        `/businesses/${businessId}/appointments/${appointment.id}/reschedule`,
      )
      .set('Authorization', operator)
      .send({ date, time: '16:00' })
      .expect(200);
    expect((await secondWorker.processBatch(1)).completedJobs).toBe(1);
    const stored = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
    });
    expect(stored.googleCalendarEventId).toBe(orphan.id);
    expect(events.get(orphan.id!)?.start?.dateTime).toBe(
      rescheduled.body.startTime,
    );
    expect(
      [...events.values()].filter(
        (event) =>
          event.extendedProperties?.private?.appointmentId === appointment.id,
      ),
    ).toHaveLength(1);

    await prisma.integrationJob.updateMany({
      where: { entityId: appointment.id, jobType: 'GOOGLE_CALENDAR_CREATE' },
      data: { nextAttemptAt: new Date(0) },
    });
    expect((await firstWorker.processBatch(1)).completedJobs).toBe(1);
  });

  it('cleans up an event after cancellation overlaps an interrupted insert', async () => {
    const appointment = await book('15:00');
    const inserting = deferred();
    const release = deferred();
    failAfterInsert = true;
    pauseInsert = async () => {
      inserting.resolve();
      await release.promise;
    };
    const create = firstWorker.processBatch(1);

    try {
      await Promise.race([inserting.promise, create]);
      await request(app.getHttpServer())
        .patch(
          `/businesses/${businessId}/appointments/${appointment.id}/cancel`,
        )
        .set('Authorization', operator)
        .send({ reason: 'Concurrent test cancellation' })
        .expect(200);
      const cancellation = await secondWorker.processBatch(1);
      expect(cancellation.retryScheduledJobs).toBe(1);
    } finally {
      release.resolve();
      await create;
      pauseInsert = undefined;
      failAfterInsert = false;
    }

    expect(
      [...events.values()].some(
        (event) =>
          event.extendedProperties?.private?.appointmentId === appointment.id,
      ),
    ).toBe(true);
    await prisma.integrationJob.updateMany({
      where: { entityId: appointment.id, jobType: 'GOOGLE_CALENDAR_DELETE' },
      data: { nextAttemptAt: new Date(0) },
    });
    expect((await secondWorker.processBatch(1)).completedJobs).toBe(1);
    expect(
      [...events.values()].some(
        (event) =>
          event.extendedProperties?.private?.appointmentId === appointment.id,
      ),
    ).toBe(false);
    expect(
      await prisma.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      }),
    ).toMatchObject({ status: 'CANCELLED', googleCalendarEventId: null });
  }, 15000);

  it('processes a WhatsApp confirmation once and replays the HTTP result', async () => {
    const http = request(app.getHttpServer());
    const customer = await http
      .post('/customers/upsert/whatsapp')
      .set('Authorization', operator)
      .send({ businessId, whatsappPhone: '5210000000001' })
      .expect(201);
    expect(customer.body.id).toBe(customerId);
    const { body: conversation } = await http
      .post('/conversations/active')
      .set('Authorization', operator)
      .send({ businessId, customerId })
      .expect(201);
    const input = [
      'Hola',
      '1',
      '1',
      DateTime.fromISO(date).toFormat('dd/MM/yyyy'),
      '17:30',
      'WhatsApp test',
      'Sin notas',
    ];
    for (const [index, text] of input.entries()) {
      const saved = await http
        .post('/messages/inbound')
        .set('Authorization', operator)
        .send({
          businessId,
          customerId,
          conversationId: conversation.id,
          whatsappMessageId: `wamid.e2e-step-${index}`,
          content: text,
        })
        .expect(201);
      await http
        .post('/flow-engine/process')
        .set('Authorization', operator)
        .send({
          businessId,
          customerId,
          conversationId: conversation.id,
          messageId: saved.body.id,
          messageType: 'TEXT',
          text,
        })
        .expect(201);
    }

    await http
      .post('/flow-engine/process')
      .set('Authorization', operator)
      .send({
        businessId,
        customerId,
        conversationId: conversation.id,
        messageType: 'TEXT',
        text: '1',
      })
      .expect(400);
    const inboundRequest = () =>
      http
        .post('/messages/inbound')
        .set('Authorization', operator)
        .send({
          businessId,
          customerId,
          conversationId: conversation.id,
          whatsappMessageId: 'wamid.e2e-confirm',
          content: '1',
        })
        .expect(201);
    const inbound = await inboundRequest();
    expect((await inboundRequest()).body.id).toBe(inbound.body.id);
    const payload = {
      businessId,
      customerId,
      conversationId: conversation.id,
      messageId: inbound.body.id,
      messageType: 'TEXT',
      text: '1',
    };
    const process = () =>
      http
        .post('/flow-engine/process')
        .set('Authorization', operator)
        .send(payload);
    const responses = await Promise.all([process(), process()]);
    expect(
      responses.every((response) => [201, 409].includes(response.status)),
    ).toBe(true);
    const result = responses.find((response) => response.status === 201)!.body;
    expect(result.metadata.reason).toBe('APPOINTMENT_CONFIRMED');
    expect((await process().expect(201)).body).toEqual(result);
    expect(
      await prisma.appointment.count({
        where: { businessId, startTime: new Date(`${date}T17:30:00Z`) },
      }),
    ).toBe(1);
    expect(
      await prisma.integrationJob.count({
        where: {
          entityId: result.metadata.appointmentId,
          jobType: 'GOOGLE_CALENDAR_CREATE',
        },
      }),
    ).toBe(1);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  });

  it('reconciles the same destination and pauses a different account until confirmed', async () => {
    const connection = app.get(GoogleCalendarConnectionService);
    const where = {
      businessId_provider_integrationType: {
        businessId,
        provider: 'GOOGLE',
        integrationType: 'WORKSPACE',
      },
    };
    const oldCalendar = {
      accountCalendarId: 'account-a',
      calendarId: 'account-a',
      selection: 'primary',
    };
    await prisma.integration.update({
      where,
      data: {
        status: 'ERROR',
        credentialsEncrypted: 'old-credentials',
        settings: {
          calendarId: oldCalendar.calendarId,
          calendarDestination: oldCalendar,
        },
      },
    });
    const appointment = await book('17:00');
    const cancelled = await prisma.appointment.findFirstOrThrow({
      where: { businessId, status: 'CANCELLED' },
    });
    await prisma.integrationJob.deleteMany({
      where: { entityId: cancelled.id, jobType: 'GOOGLE_CALENDAR_DELETE' },
    });
    expect((await firstWorker.processBatch(1)).claimedJobs).toBe(0);

    let account = 'account-a';
    const spy = jest.spyOn(google, 'calendar').mockImplementation((() => ({
      calendars: { get: async () => ({ data: { id: account } }) },
      events: { list: async () => ({ data: {} }) },
    })) as unknown as typeof google.calendar);
    try {
      const oauth = {} as GoogleOAuth2Client;
      const same = await connection.connect(
        businessId,
        oauth,
        'refreshed-credentials',
      );
      expect(same).toMatchObject({ connected: true, status: 'ACTIVE' });
      await connection.connect(
        businessId,
        oauth,
        'refreshed-credentials-again',
      );
      expect(
        await prisma.integrationJob.count({
          where: {
            entityId: appointment.id,
            jobType: 'GOOGLE_CALENDAR_UPDATE',
            status: 'PENDING',
          },
        }),
      ).toBe(1);
      expect(
        await prisma.integrationJob.count({
          where: {
            entityId: cancelled.id,
            jobType: 'GOOGLE_CALENDAR_DELETE',
            status: 'PENDING',
          },
        }),
      ).toBe(1);

      events.set('cancelled-while-offline', {
        id: 'cancelled-while-offline',
        extendedProperties: { private: { appointmentId: cancelled.id } },
      });
      await firstWorker.processBatch(50);
      const reconciled = await prisma.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      });
      expect(reconciled.googleCalendarEventId).toBeTruthy();
      expect(
        events.get(reconciled.googleCalendarEventId!)?.start?.dateTime,
      ).toBe(appointment.startTime.toISOString());
      expect(events.has('cancelled-while-offline')).toBe(false);
      expect(
        [...events.values()].filter(
          (event) =>
            event.extendedProperties?.private?.appointmentId === appointment.id,
        ),
      ).toHaveLength(1);

      account = 'account-b';
      expect(
        await connection.connect(businessId, oauth, 'candidate-credentials'),
      ).toMatchObject({
        connected: false,
        requiresConfirmation: true,
        status: 'INACTIVE',
      });
      expect((await firstWorker.processBatch(1)).claimedJobs).toBe(0);
      const http = request(app.getHttpServer());
      const route = `/businesses/${businessId}/integrations/google/connection`;
      await http.get(route).set('Authorization', operator).expect(403);
      const pending = await http
        .get(route)
        .set('Authorization', 'Bearer calendar-e2e-admin')
        .expect(200);
      const confirmationId = pending.body.pendingDestination.confirmationId;
      await http
        .patch(`${route}/wrong-confirmation`)
        .set('Authorization', 'Bearer calendar-e2e-admin')
        .expect(409);
      await http
        .patch(`${route}/${confirmationId}`)
        .set('Authorization', 'Bearer calendar-e2e-admin')
        .expect(200);
      const integration = await prisma.integration.findUniqueOrThrow({ where });
      expect(integration).toMatchObject({
        status: 'ACTIVE',
        credentialsEncrypted: 'candidate-credentials',
        pendingCredentialsEncrypted: null,
        settings: {
          calendarId: 'account-b',
          calendarDestination: { accountCalendarId: 'account-b' },
        },
      });
    } finally {
      spy.mockRestore();
    }
  });
  it('keeps fresh Google credentials and only pauses on a revoked refresh token', async () => {
    const googleClient = app.get(GoogleClientService);
    const crypto = new IntegrationCryptoService();
    const where = {
      businessId_provider_integrationType: {
        businessId,
        provider: 'GOOGLE',
        integrationType: 'WORKSPACE',
      },
    };
    const encrypted = (refreshToken: string) =>
      crypto.encrypt({ refreshToken });
    const initial = encrypted('original-refresh');
    await prisma.integration.update({
      where,
      data: { status: 'ACTIVE', credentialsEncrypted: initial },
    });

    let refreshError: unknown;
    let onTokens: ((tokens: { access_token: string }) => void) | undefined;
    const oauth = {
      setCredentials: () => undefined,
      on: (_event: string, callback: typeof onTokens) => {
        onTokens = callback;
      },
      getAccessToken: async () => {
        if (refreshError) throw refreshError;
        return { token: 'test' };
      },
    };
    const spy = jest
      .spyOn(
        googleClient as unknown as { createOAuthClient(): typeof oauth },
        'createOAuthClient',
      )
      .mockReturnValue(oauth);
    try {
      await googleClient.getAuthenticatedClient(businessId);
      const newCredentials = encrypted('reconnected-refresh');
      await prisma.integration.update({
        where,
        data: { credentialsEncrypted: newCredentials },
      });
      const update = jest.spyOn(prisma.integration, 'updateMany');
      try {
        onTokens?.({ access_token: 'late-access-token' });
        await update.mock.results[0].value;
        expect(
          (await prisma.integration.findUniqueOrThrow({ where }))
            .credentialsEncrypted,
        ).toBe(newCredentials);
      } finally {
        update.mockRestore();
      }

      refreshError = new Error('temporary outage');
      await expect(
        googleClient.getAuthenticatedClient(businessId),
      ).rejects.toThrow('temporary outage');
      expect(
        (await prisma.integration.findUniqueOrThrow({ where })).status,
      ).toBe('ACTIVE');

      refreshError = Object.assign(new Error('revoked'), {
        response: { data: { error: 'invalid_grant' } },
      });
      await expect(
        googleClient.getAuthenticatedClient(businessId),
      ).rejects.toThrow('revoked');
      expect(
        await prisma.integration.findUniqueOrThrow({ where }),
      ).toMatchObject({
        status: 'ERROR',
        credentialsEncrypted: newCredentials,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('stops claiming work during shutdown and releases the application at its deadline', async () => {
    const started = deferred();
    const active = deferred();
    let canClaim: (() => boolean) | undefined;
    const processor = {
      processBatch: async (_limit: number, shouldContinue: () => boolean) => {
        canClaim = shouldContinue;
        started.resolve();
        await active.promise;
        return { results: [], claimedJobs: 0, recoveredStaleJobs: 0 };
      },
    } as unknown as IntegrationJobsProcessor;
    const previousEnabled = process.env.INTEGRATION_JOBS_WORKER_ENABLED;
    const previousTimeout = process.env.INTEGRATION_JOBS_SHUTDOWN_TIMEOUT_MS;
    process.env.INTEGRATION_JOBS_WORKER_ENABLED = 'true';
    process.env.INTEGRATION_JOBS_SHUTDOWN_TIMEOUT_MS = '25';
    const worker = new IntegrationJobsWorker(processor);
    try {
      worker.onApplicationBootstrap();
      await started.promise;
      expect(canClaim?.()).toBe(true);
      const shutdown = worker.onModuleDestroy();
      expect(canClaim?.()).toBe(false);
      await shutdown;
      expect(canClaim?.()).toBe(false);
    } finally {
      active.resolve();
      process.env.INTEGRATION_JOBS_WORKER_ENABLED = previousEnabled;
      if (previousTimeout === undefined)
        delete process.env.INTEGRATION_JOBS_SHUTDOWN_TIMEOUT_MS;
      else process.env.INTEGRATION_JOBS_SHUTDOWN_TIMEOUT_MS = previousTimeout;
    }
  });
});
