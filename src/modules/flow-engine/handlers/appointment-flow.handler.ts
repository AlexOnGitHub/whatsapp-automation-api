import { Injectable } from '@nestjs/common';

import {
  APPOINTMENT_STEPS,
  FLOW_KEYS,
} from '../../../common/flows/flow-registry';

import {
  formatBusinessDate,
  getCurrentDateInTimeZone,
  isDateBefore,
  parseBusinessDateInput,
} from '../../../common/datetime/business-date.utils';

import { BusinessesService } from '../../businesses/businesses.service';

import { ConversationSessionsService } from '../../conversation-sessions/conversation-sessions.service';

import { ServicesCatalogService } from '../../services-catalog/services-catalog.service';

import { AppointmentAvailabilityService } from '../../appointment-availability/appointment-availability.service';

import { AppointmentBookingService } from '../../appointment-booking/appointment-booking.service';

import { AppointmentSlotUnavailableException } from '../../appointment-booking/appointment-booking.errors';

import type { FlowContext } from '../types/flow-context.types';

import type { FlowHandler } from '../types/flow-handler.types';

import type { FlowEngineResult } from '../types/flow-result.types';

@Injectable()
export class AppointmentFlowHandler implements FlowHandler {
  readonly flowKey = FLOW_KEYS.APPOINTMENT;

  constructor(
    private readonly servicesCatalogService: ServicesCatalogService,

    private readonly conversationSessionsService: ConversationSessionsService,

    private readonly businessesService: BusinessesService,

    private readonly appointmentAvailabilityService: AppointmentAvailabilityService,

    private readonly appointmentBookingService: AppointmentBookingService,
  ) {}

  /* ─────────────────────────────────────────────
     START
  ───────────────────────────────────────────── */

  async start(context: FlowContext): Promise<FlowEngineResult> {
    const services = await this.servicesCatalogService.findEnabledByBusiness(
      context.businessId,
    );

    if (services.length === 0) {
      return {
        handled: true,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.SELECT_SERVICE,

        sessionId: context.session?.id,

        responses: [
          {
            type: 'TEXT',

            text: 'Por el momento no hay servicios disponibles para agendar.',
          },
        ],

        metadata: {
          reason: 'APPOINTMENT_NO_SERVICES_AVAILABLE',
        },
      };
    }

    const servicesList =
      this.servicesCatalogService.formatServicesList(services);

    return {
      handled: true,

      flowKey: FLOW_KEYS.APPOINTMENT,

      stepKey: APPOINTMENT_STEPS.SELECT_SERVICE,

      sessionId: context.session?.id,

      responses: [
        {
          type: 'TEXT',

          text: [
            'Perfecto. Vamos a agendar tu cita.',
            '',
            'Selecciona el servicio que deseas:',
            '',
            servicesList,
          ].join('\n'),
        },
      ],

      metadata: {
        reason: 'APPOINTMENT_STARTED',

        availableServices: services.length,
      },
    };
  }

  /* ─────────────────────────────────────────────
     HANDLE
  ───────────────────────────────────────────── */

  async handle(context: FlowContext): Promise<FlowEngineResult> {
    if (!context.session) {
      throw new Error('AppointmentFlow requiere una sesión activa');
    }

    switch (context.session.stepKey) {
      case APPOINTMENT_STEPS.SELECT_SERVICE:
        return this.handleSelectService(context);

      case APPOINTMENT_STEPS.SELECT_DATE:
        return this.handleSelectDate(context);

      case APPOINTMENT_STEPS.SELECT_TIME:
        return this.handleSelectTime(context);

      case APPOINTMENT_STEPS.CAPTURE_NAME:
        return this.handleCaptureName(context);

      case APPOINTMENT_STEPS.CAPTURE_NOTES:
        return this.handleCaptureNotes(context);

      case APPOINTMENT_STEPS.CONFIRMATION:
        return this.handleConfirmation(context);

      default:
        return {
          handled: true,

          flowKey: FLOW_KEYS.APPOINTMENT,

          stepKey: context.session.stepKey,

          sessionId: context.session.id,

          responses: [
            {
              type: 'TEXT',

              text: 'Continuemos con el proceso de tu cita.',
            },
          ],

          metadata: {
            reason: 'APPOINTMENT_STEP_PENDING_IMPLEMENTATION',
          },
        };
    }
  }

  /* ─────────────────────────────────────────────
     SELECT SERVICE
  ───────────────────────────────────────────── */

  private async handleSelectService(
    context: FlowContext,
  ): Promise<FlowEngineResult> {
    const session = context.session!;

    const input = context.input.interactiveId ?? context.input.text ?? '';

    const service = await this.servicesCatalogService.resolveSelection(
      context.businessId,
      input,
    );

    if (!service) {
      const attempt =
        await this.conversationSessionsService.incrementFailedAttempts(
          session.id,
        );

      if (attempt.limitReached) {
        return {
          handled: true,

          flowKey: FLOW_KEYS.APPOINTMENT,

          stepKey: APPOINTMENT_STEPS.SELECT_SERVICE,

          sessionId: session.id,

          responses: [
            {
              type: 'TEXT',

              text: 'No pude identificar correctamente el servicio después de varios intentos.',
            },
          ],

          transition: {
            targetFlowKey: FLOW_KEYS.HUMAN_HANDOFF,

            reason: 'APPOINTMENT_SERVICE_MAX_FAILED_ATTEMPTS',

            context: {
              previousFlow: FLOW_KEYS.APPOINTMENT,

              failedStep: APPOINTMENT_STEPS.SELECT_SERVICE,
            },
          },

          metadata: {
            reason: 'APPOINTMENT_INVALID_SERVICE_LIMIT_REACHED',
          },
        };
      }

      const services = await this.servicesCatalogService.findEnabledByBusiness(
        context.businessId,
      );

      const servicesList =
        this.servicesCatalogService.formatServicesList(services);

      return {
        handled: true,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.SELECT_SERVICE,

        sessionId: session.id,

        responses: [
          {
            type: 'TEXT',

            text: [
              'No pude identificar ese servicio.',
              '',
              'Selecciona una de las opciones disponibles:',
              '',
              servicesList,
            ].join('\n'),
          },
        ],

        metadata: {
          reason: 'APPOINTMENT_INVALID_SERVICE',

          input,

          failedAttempts: attempt.session.failedAttempts,

          maxFailedAttempts: attempt.maxFailedAttempts,
        },
      };
    }

    await this.conversationSessionsService.resetFailedAttempts(session.id);

    const previousContext = this.toObject(session.context);

    const nextContext = {
      ...previousContext,

      appointment: {
        ...this.toObject(previousContext.appointment),

        serviceId: service.id,

        serviceName: service.name,

        servicePrice: service.price?.toString() ?? null,

        durationMinutes: service.durationMinutes,
      },
    };

    const updatedSession = await this.conversationSessionsService.updateState(
      session.id,
      {
        stepKey: APPOINTMENT_STEPS.SELECT_DATE,

        context: nextContext,
      },
    );

    return {
      handled: true,

      flowKey: FLOW_KEYS.APPOINTMENT,

      stepKey: APPOINTMENT_STEPS.SELECT_DATE,

      sessionId: updatedSession.id,

      responses: [
        {
          type: 'TEXT',

          text: [
            `Seleccionaste: ${service.name}.`,
            '',
            `Duración aproximada: ${service.durationMinutes} minutos.`,
            '',
            '¿Para qué fecha deseas tu cita?',
            '',
            'Puedes responder, por ejemplo:',
            '• Hoy',
            '• Mañana',
            '• 25/10/2026',
          ].join('\n'),
        },
      ],

      metadata: {
        reason: 'APPOINTMENT_SERVICE_SELECTED',

        serviceId: service.id,

        serviceName: service.name,
      },
    };
  }

  /* ─────────────────────────────────────────────
     SELECT DATE
  ───────────────────────────────────────────── */

  private async handleSelectDate(
    context: FlowContext,
  ): Promise<FlowEngineResult> {
    const session = context.session!;

    const input = context.input.text ?? context.input.interactiveId ?? '';

    const business = await this.businessesService.findById(context.businessId);

    const timeZone = business.timezone;

    const parsed = parseBusinessDateInput(input, timeZone);

    const today = getCurrentDateInTimeZone(timeZone);

    if (!parsed || isDateBefore(parsed.date, today)) {
      const attempt =
        await this.conversationSessionsService.incrementFailedAttempts(
          session.id,
        );

      if (attempt.limitReached) {
        return {
          handled: true,

          flowKey: FLOW_KEYS.APPOINTMENT,

          stepKey: APPOINTMENT_STEPS.SELECT_DATE,

          sessionId: session.id,

          responses: [
            {
              type: 'TEXT',

              text: 'No pude identificar una fecha válida después de varios intentos.',
            },
          ],

          transition: {
            targetFlowKey: FLOW_KEYS.HUMAN_HANDOFF,

            reason: 'APPOINTMENT_DATE_MAX_FAILED_ATTEMPTS',

            context: {
              previousFlow: FLOW_KEYS.APPOINTMENT,

              failedStep: APPOINTMENT_STEPS.SELECT_DATE,

              lastInput: input,
            },
          },

          metadata: {
            reason: 'APPOINTMENT_INVALID_DATE_LIMIT_REACHED',
          },
        };
      }

      return {
        handled: true,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.SELECT_DATE,

        sessionId: session.id,

        responses: [
          {
            type: 'TEXT',

            text: [
              'No pude identificar una fecha válida.',
              '',
              'La fecha no puede estar en el pasado.',
              '',
              'Puedes responder, por ejemplo:',
              '• Hoy',
              '• Mañana',
              '• 25/10/2026',
            ].join('\n'),
          },
        ],

        metadata: {
          reason: 'APPOINTMENT_INVALID_DATE',

          input,

          failedAttempts: attempt.session.failedAttempts,

          maxFailedAttempts: attempt.maxFailedAttempts,
        },
      };
    }

    await this.conversationSessionsService.resetFailedAttempts(session.id);

    const previousContext = this.toObject(session.context);

    const previousAppointment = this.toObject(previousContext.appointment);

    const nextContext = {
      ...previousContext,

      appointment: {
        ...previousAppointment,

        date: parsed.date,

        dateSource: parsed.source,

        timeZone,
      },
    };

    const updatedSession = await this.conversationSessionsService.updateState(
      session.id,
      {
        stepKey: APPOINTMENT_STEPS.SELECT_TIME,

        context: nextContext,
      },
    );

    const formattedDate = formatBusinessDate(parsed.date);

    return {
      handled: true,

      flowKey: FLOW_KEYS.APPOINTMENT,

      stepKey: APPOINTMENT_STEPS.SELECT_TIME,

      sessionId: updatedSession.id,

      responses: [
        {
          type: 'TEXT',

          text: [
            `Perfecto. La fecha seleccionada es ${formattedDate}.`,
            '',
            'Ahora selecciona el horario en el que deseas agendar tu cita.',
          ].join('\n'),
        },
      ],

      metadata: {
        reason: 'APPOINTMENT_DATE_SELECTED',

        date: parsed.date,

        dateSource: parsed.source,

        timeZone,
      },
    };
  }

  /* ─────────────────────────────────────────────
     SELECT TIME
  ───────────────────────────────────────────── */

  private async handleSelectTime(
    context: FlowContext,
  ): Promise<FlowEngineResult> {
    const session = context.session!;

    const sessionContext = this.toObject(session.context);

    const appointmentContext = this.toObject(sessionContext.appointment);

    const serviceId =
      typeof appointmentContext.serviceId === 'string'
        ? appointmentContext.serviceId
        : null;

    const date =
      typeof appointmentContext.date === 'string'
        ? appointmentContext.date
        : null;

    if (!serviceId || !date) {
      throw new Error(
        'La sesión APPOINTMENT no contiene serviceId/date para SELECT_TIME',
      );
    }

    const slots = await this.appointmentAvailabilityService.getAvailableSlots({
      businessId: context.businessId,

      serviceId,

      date,
    });

    if (slots.length === 0) {
      return {
        handled: true,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.SELECT_TIME,

        sessionId: session.id,

        responses: [
          {
            type: 'TEXT',

            text: [
              'No hay horarios disponibles para la fecha seleccionada.',
              '',
              'Podemos elegir otra fecha.',
            ].join('\n'),
          },
        ],

        metadata: {
          reason: 'APPOINTMENT_NO_TIME_SLOTS',

          date,
        },
      };
    }

    const input = context.input.interactiveId ?? context.input.text ?? '';

    const selectedSlot = this.appointmentAvailabilityService.resolveSelection(
      slots,
      input,
    );

    if (!selectedSlot) {
      const attempt =
        await this.conversationSessionsService.incrementFailedAttempts(
          session.id,
        );

      if (attempt.limitReached) {
        return {
          handled: true,

          flowKey: FLOW_KEYS.APPOINTMENT,

          stepKey: APPOINTMENT_STEPS.SELECT_TIME,

          sessionId: session.id,

          responses: [
            {
              type: 'TEXT',

              text: 'No pude identificar un horario válido después de varios intentos.',
            },
          ],

          transition: {
            targetFlowKey: FLOW_KEYS.HUMAN_HANDOFF,

            reason: 'APPOINTMENT_TIME_MAX_FAILED_ATTEMPTS',

            context: {
              previousFlow: FLOW_KEYS.APPOINTMENT,

              failedStep: APPOINTMENT_STEPS.SELECT_TIME,

              date,

              lastInput: input,
            },
          },

          metadata: {
            reason: 'APPOINTMENT_INVALID_TIME_LIMIT_REACHED',
          },
        };
      }

      const slotsList = this.appointmentAvailabilityService.formatSlots(slots);

      return {
        handled: true,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.SELECT_TIME,

        sessionId: session.id,

        responses: [
          {
            type: 'TEXT',

            text: [
              'Selecciona uno de los horarios disponibles:',
              '',
              slotsList,
            ].join('\n'),
          },
        ],

        metadata: {
          reason: 'APPOINTMENT_INVALID_TIME',

          date,

          availableSlots: slots.length,

          failedAttempts: attempt.session.failedAttempts,

          maxFailedAttempts: attempt.maxFailedAttempts,
        },
      };
    }

    await this.conversationSessionsService.resetFailedAttempts(session.id);

    const nextContext = {
      ...sessionContext,

      appointment: {
        ...appointmentContext,

        time: selectedSlot.localTime,

        startTime: selectedSlot.startTime.toISOString(),

        endTime: selectedSlot.endTime.toISOString(),
      },
    };

    const updatedSession = await this.conversationSessionsService.updateState(
      session.id,
      {
        stepKey: APPOINTMENT_STEPS.CAPTURE_NAME,

        context: nextContext,
      },
    );

    return {
      handled: true,

      flowKey: FLOW_KEYS.APPOINTMENT,

      stepKey: APPOINTMENT_STEPS.CAPTURE_NAME,

      sessionId: updatedSession.id,

      responses: [
        {
          type: 'TEXT',

          text: [
            `Horario seleccionado: ${selectedSlot.displayTime}.`,
            '',
            '¿A nombre de quién registramos la cita?',
          ].join('\n'),
        },
      ],

      metadata: {
        reason: 'APPOINTMENT_TIME_SELECTED',

        date,

        time: selectedSlot.localTime,

        startTime: selectedSlot.startTime.toISOString(),

        endTime: selectedSlot.endTime.toISOString(),
      },
    };
  }

  /* ─────────────────────────────────────────────
     CAPTURE NAME
  ───────────────────────────────────────────── */

  private async handleCaptureName(
    context: FlowContext,
  ): Promise<FlowEngineResult> {
    const session = context.session!;

    const input = context.input.text?.trim() ?? '';

    if (input.length < 2) {
      const attempt =
        await this.conversationSessionsService.incrementFailedAttempts(
          session.id,
        );

      if (attempt.limitReached) {
        return {
          handled: true,

          flowKey: FLOW_KEYS.APPOINTMENT,

          stepKey: APPOINTMENT_STEPS.CAPTURE_NAME,

          sessionId: session.id,

          responses: [
            {
              type: 'TEXT',

              text: 'No pude identificar correctamente el nombre después de varios intentos.',
            },
          ],

          transition: {
            targetFlowKey: FLOW_KEYS.HUMAN_HANDOFF,

            reason: 'APPOINTMENT_NAME_MAX_FAILED_ATTEMPTS',

            context: {
              previousFlow: FLOW_KEYS.APPOINTMENT,

              failedStep: APPOINTMENT_STEPS.CAPTURE_NAME,
            },
          },

          metadata: {
            reason: 'APPOINTMENT_INVALID_NAME_LIMIT_REACHED',
          },
        };
      }

      return {
        handled: true,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.CAPTURE_NAME,

        sessionId: session.id,

        responses: [
          {
            type: 'TEXT',

            text: 'Indícame un nombre válido para registrar la cita.',
          },
        ],

        metadata: {
          reason: 'APPOINTMENT_INVALID_NAME',

          failedAttempts: attempt.session.failedAttempts,

          maxFailedAttempts: attempt.maxFailedAttempts,
        },
      };
    }

    await this.conversationSessionsService.resetFailedAttempts(session.id);

    const sessionContext = this.toObject(session.context);

    const appointmentContext = this.toObject(sessionContext.appointment);

    const nextContext = {
      ...sessionContext,

      appointment: {
        ...appointmentContext,

        customerName: input,
      },
    };

    const updatedSession = await this.conversationSessionsService.updateState(
      session.id,
      {
        stepKey: APPOINTMENT_STEPS.CAPTURE_NOTES,

        context: nextContext,
      },
    );

    return {
      handled: true,

      flowKey: FLOW_KEYS.APPOINTMENT,

      stepKey: APPOINTMENT_STEPS.CAPTURE_NOTES,

      sessionId: updatedSession.id,

      responses: [
        {
          type: 'TEXT',

          text: [
            `Perfecto, ${input}.`,
            '',
            '¿Deseas agregar alguna nota para la cita?',
            '',
            'Puedes escribirla o responder "no".',
          ].join('\n'),
        },
      ],

      metadata: {
        reason: 'APPOINTMENT_NAME_CAPTURED',

        customerName: input,
      },
    };
  }

  /* ─────────────────────────────────────────────
     CAPTURE NOTES
  ───────────────────────────────────────────── */

  private async handleCaptureNotes(
    context: FlowContext,
  ): Promise<FlowEngineResult> {
    const session = context.session!;

    const rawInput = context.input.text?.trim() ?? '';

    const normalized = this.normalizeText(rawInput);

    const noNotes = [
      'no',
      'ninguna',
      'ninguno',
      'sin notas',
      'no gracias',
    ].includes(normalized);

    const notes = noNotes || !rawInput ? null : rawInput;

    const sessionContext = this.toObject(session.context);

    const appointmentContext = this.toObject(sessionContext.appointment);

    const nextContext = {
      ...sessionContext,

      appointment: {
        ...appointmentContext,

        notes,
      },
    };

    const updatedSession = await this.conversationSessionsService.updateState(
      session.id,
      {
        stepKey: APPOINTMENT_STEPS.CONFIRMATION,

        context: nextContext,
      },
    );

    return this.buildConfirmationResult(updatedSession.id, nextContext);
  }

  /* ─────────────────────────────────────────────
     CONFIRMATION
  ───────────────────────────────────────────── */

  private async handleConfirmation(
    context: FlowContext,
  ): Promise<FlowEngineResult> {
    const session = context.session!;

    const rawInput = context.input.interactiveId ?? context.input.text ?? '';

    const input = this.normalizeText(rawInput);

    const confirmInputs = ['1', 'si', 'confirmar', 'confirmo', 'confirmada'];

    const cancelInputs = ['2', 'no', 'cancelar', 'cancelo'];

    /* ───────────────────────────────────────────
     CANCELAR
  ─────────────────────────────────────────── */

    if (cancelInputs.includes(input)) {
      const cancelled = await this.conversationSessionsService.cancelSession(
        session.id,
      );

      return {
        handled: true,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.CONFIRMATION,

        sessionId: cancelled.id,

        responses: [
          {
            type: 'TEXT',

            text: [
              'La solicitud de cita fue cancelada.',
              '',
              'Cuando quieras podemos comenzar nuevamente.',
            ].join('\n'),
          },
        ],

        metadata: {
          reason: 'APPOINTMENT_CANCELLED_BY_CUSTOMER',
        },
      };
    }

    /* ───────────────────────────────────────────
     INPUT INVÁLIDO
  ─────────────────────────────────────────── */

    if (!confirmInputs.includes(input)) {
      const attempt =
        await this.conversationSessionsService.incrementFailedAttempts(
          session.id,
        );

      if (attempt.limitReached) {
        return {
          handled: true,

          flowKey: FLOW_KEYS.APPOINTMENT,

          stepKey: APPOINTMENT_STEPS.CONFIRMATION,

          sessionId: session.id,

          responses: [
            {
              type: 'TEXT',

              text: 'No pude identificar si deseas confirmar o cancelar la cita.',
            },
          ],

          transition: {
            targetFlowKey: FLOW_KEYS.HUMAN_HANDOFF,

            reason: 'APPOINTMENT_CONFIRMATION_MAX_FAILED_ATTEMPTS',

            context: {
              previousFlow: FLOW_KEYS.APPOINTMENT,

              failedStep: APPOINTMENT_STEPS.CONFIRMATION,
            },
          },

          metadata: {
            reason: 'APPOINTMENT_INVALID_CONFIRMATION_LIMIT_REACHED',
          },
        };
      }

      return {
        handled: true,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.CONFIRMATION,

        sessionId: session.id,

        responses: [
          {
            type: 'TEXT',

            text: [
              'No pude identificar tu respuesta.',
              '',
              '1. Confirmar',
              '2. Cancelar',
            ].join('\n'),
          },
        ],

        metadata: {
          reason: 'APPOINTMENT_INVALID_CONFIRMATION',

          failedAttempts: attempt.session.failedAttempts,

          maxFailedAttempts: attempt.maxFailedAttempts,
        },
      };
    }

    /* ───────────────────────────────────────────
     CONFIRMAR
  ─────────────────────────────────────────── */

    await this.conversationSessionsService.resetFailedAttempts(session.id);

    const sessionContext = this.toObject(session.context);

    const appointmentContext = this.toObject(sessionContext.appointment);

    const serviceId = this.getRequiredString(
      appointmentContext.serviceId,
      'serviceId',
    );

    const date = this.getRequiredString(appointmentContext.date, 'date');

    const startTime = this.getRequiredString(
      appointmentContext.startTime,
      'startTime',
    );

    const customerName = this.getRequiredString(
      appointmentContext.customerName,
      'customerName',
    );

    const notes =
      typeof appointmentContext.notes === 'string'
        ? appointmentContext.notes
        : null;

    try {
      const booking = await this.appointmentBookingService.confirmAppointment({
        businessId: context.businessId,

        customerId: context.customerId,

        sessionId: session.id,

        serviceId,

        date,

        startTime,

        customerName,

        notes,

        correlationId: context.correlationId,
      });

      return {
        handled: true,

        flowKey: FLOW_KEYS.APPOINTMENT,

        stepKey: APPOINTMENT_STEPS.CONFIRMATION,

        sessionId: booking.session.id,

        responses: [
          {
            type: 'TEXT',

            text: [
              'Tu cita quedó confirmada correctamente. ✅',
              '',
              `Folio: ${booking.appointment.id}`,
              '',
              `Servicio: ${booking.appointment.serviceNameSnapshot}`,
              `Fecha: ${formatBusinessDate(date)}`,
              `Hora: ${this.getString(appointmentContext.time, '')}`,
              `Nombre: ${booking.appointment.customerName}`,
            ].join('\n'),
          },
        ],

        metadata: {
          reason: 'APPOINTMENT_CONFIRMED',

          appointmentId: booking.appointment.id,

          status: booking.appointment.status,
        },
      };
    } catch (error) {
      /*
       * El slot existía cuando se mostró al usuario,
       * pero pudo ser tomado antes de confirmar.
       */
      if (error instanceof AppointmentSlotUnavailableException) {
        const nextAppointmentContext = {
          ...appointmentContext,
        };

        /*
         * Eliminamos únicamente la selección de hora.
         *
         * Conservamos:
         * - servicio
         * - fecha
         * - nombre
         * - notas
         */
        delete nextAppointmentContext.time;
        delete nextAppointmentContext.startTime;
        delete nextAppointmentContext.endTime;

        const nextContext = {
          ...sessionContext,

          appointment: nextAppointmentContext,
        };

        await this.conversationSessionsService.updateState(session.id, {
          stepKey: APPOINTMENT_STEPS.SELECT_TIME,

          context: nextContext,
        });

        await this.conversationSessionsService.resetFailedAttempts(session.id);

        const slots =
          await this.appointmentAvailabilityService.getAvailableSlots({
            businessId: context.businessId,

            serviceId,

            date,
          });

        const slotsList =
          slots.length > 0
            ? this.appointmentAvailabilityService.formatSlots(slots)
            : null;

        return {
          handled: true,

          flowKey: FLOW_KEYS.APPOINTMENT,

          stepKey: APPOINTMENT_STEPS.SELECT_TIME,

          sessionId: session.id,

          responses: [
            {
              type: 'TEXT',

              text: slotsList
                ? [
                    'Ese horario acaba de dejar de estar disponible.',
                    '',
                    'Selecciona otro horario:',
                    '',
                    slotsList,
                  ].join('\n')
                : [
                    'Ese horario acaba de dejar de estar disponible.',
                    '',
                    'Por el momento ya no quedan horarios libres para esa fecha.',
                  ].join('\n'),
            },
          ],

          metadata: {
            reason: 'APPOINTMENT_SLOT_NO_LONGER_AVAILABLE',
          },
        };
      }

      throw error;
    }
  }

  /* ─────────────────────────────────────────────
     CONFIRMATION SUMMARY
  ───────────────────────────────────────────── */

  private buildConfirmationResult(
    sessionId: string,

    sessionContext: Record<string, unknown>,
  ): FlowEngineResult {
    const appointment = this.toObject(sessionContext.appointment);

    const serviceName = this.getString(
      appointment.serviceName,
      'Servicio no disponible',
    );

    const date = this.getString(appointment.date, '');

    const time = this.getString(appointment.time, '');

    const customerName = this.getString(appointment.customerName, '');

    const notes =
      typeof appointment.notes === 'string' ? appointment.notes : null;

    const price =
      typeof appointment.servicePrice === 'string'
        ? appointment.servicePrice
        : null;

    const formattedDate = date ? formatBusinessDate(date) : date;

    return {
      handled: true,

      flowKey: FLOW_KEYS.APPOINTMENT,

      stepKey: APPOINTMENT_STEPS.CONFIRMATION,

      sessionId,

      responses: [
        {
          type: 'TEXT',

          text: [
            'Revisa los datos de tu cita:',
            '',

            `Servicio: ${serviceName}`,

            price ? `Precio: $${price}` : null,

            `Fecha: ${formattedDate}`,

            `Hora: ${time}`,

            `Nombre: ${customerName}`,

            `Notas: ${notes ?? 'Sin notas'}`,

            '',

            '¿Deseas confirmar la cita?',

            '',

            '1. Confirmar',
            '2. Cancelar',
          ]
            .filter((line): line is string => line !== null)
            .join('\n'),
        },
      ],

      metadata: {
        reason: 'APPOINTMENT_CONFIRMATION_REQUESTED',
      },
    };
  }

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */

  private normalizeText(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private getString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
  }

  private getRequiredString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Appointment context no contiene ${fieldName}`);
    }

    return value;
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}
