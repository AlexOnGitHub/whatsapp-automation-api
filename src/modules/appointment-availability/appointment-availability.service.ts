import { BadRequestException, Injectable } from '@nestjs/common';

import { AppointmentStatus } from '@prisma/client';

import { DateTime } from 'luxon';

import { PrismaService } from '../../database/prisma/prisma.service';

import {
  BUSINESS_WEEKDAYS,
  parseBusinessHoursConfig,
  type BusinessWeekday,
} from '../../common/config/business-hours.config';

import {
  getCurrentDateInTimeZone,
  isDateBefore,
} from '../../common/datetime/business-date.utils';

import { BusinessesService } from '../businesses/businesses.service';

import { BusinessConfigsService } from '../business-configs/business-configs.service';

import { ServicesCatalogService } from '../services-catalog/services-catalog.service';

import type {
  AppointmentAvailabilitySlot,
  GetAvailabilityParams,
} from './appointment-availability.types';

@Injectable()
export class AppointmentAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly businessesService: BusinessesService,

    private readonly businessConfigsService: BusinessConfigsService,

    private readonly servicesCatalogService: ServicesCatalogService,
  ) {}

  /* ─────────────────────────────────────────────
     DISPONIBILIDAD
  ───────────────────────────────────────────── */

  async getAvailableSlots(
    params: GetAvailabilityParams,
  ): Promise<AppointmentAvailabilitySlot[]> {
    const business = await this.businessesService.ensureBusinessIsActive(
      params.businessId,
    );

    const service = await this.servicesCatalogService.findEnabledById(
      params.businessId,
      params.serviceId,
    );

    const config = await this.businessConfigsService.findByBusinessId(
      params.businessId,
    );

    const timeZone = business.timezone;

    const today = getCurrentDateInTimeZone(timeZone);

    if (isDateBefore(params.date, today)) {
      throw new BadRequestException(
        'No es posible consultar disponibilidad para una fecha pasada',
      );
    }

    const requestedDate = DateTime.fromISO(params.date, {
      zone: timeZone,
    });

    if (!requestedDate.isValid) {
      throw new BadRequestException('La fecha indicada no es válida');
    }

    const weekday = this.getWeekday(requestedDate);

    const businessHours = parseBusinessHoursConfig(config.businessHoursConfig);

    const schedule = businessHours[weekday];

    /*
     * Negocio cerrado ese día.
     */
    if (!schedule.enabled || !schedule.open || !schedule.close) {
      return [];
    }

    const opening = DateTime.fromISO(`${params.date}T${schedule.open}`, {
      zone: timeZone,
    });

    const closing = DateTime.fromISO(`${params.date}T${schedule.close}`, {
      zone: timeZone,
    });

    if (!opening.isValid || !closing.isValid || closing <= opening) {
      throw new BadRequestException(
        `La configuración de horario para ${weekday} no es válida`,
      );
    }

    /*
     * Consultamos solamente las citas que podrían
     * traslaparse con la jornada.
     */
    const existingAppointments = await this.prisma.appointment.findMany({
      where: {
        businessId: params.businessId,

        ...(params.excludeAppointmentId
          ? {
              id: {
                not: params.excludeAppointmentId,
              },
            }
          : {}),

        status: {
          in: [
            AppointmentStatus.PENDING,
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.RESCHEDULED,
          ],
        },

        startTime: {
          lt: closing.toUTC().toJSDate(),
        },

        endTime: {
          gt: opening.toUTC().toJSDate(),
        },
      },

      select: {
        id: true,
        startTime: true,
        endTime: true,
      },

      orderBy: {
        startTime: 'asc',
      },
    });

    const now = DateTime.now().setZone(timeZone);

    const slots: AppointmentAvailabilitySlot[] = [];

    let cursor = opening;

    while (
      cursor.plus({
        minutes: service.durationMinutes,
      }) <= closing
    ) {
      const slotEnd = cursor.plus({
        minutes: service.durationMinutes,
      });

      /*
       * En la fecha de hoy no mostramos horarios
       * cuyo inicio ya ocurrió.
       */
      const isPast = cursor <= now;

      const hasOverlap = existingAppointments.some((appointment) => {
        const existingStart = DateTime.fromJSDate(appointment.startTime, {
          zone: 'utc',
        });

        const existingEnd = DateTime.fromJSDate(appointment.endTime, {
          zone: 'utc',
        });

        const candidateStart = cursor.toUTC();

        const candidateEnd = slotEnd.toUTC();

        return candidateStart < existingEnd && candidateEnd > existingStart;
      });

      if (!isPast && !hasOverlap) {
        slots.push({
          date: params.date,

          localTime: cursor.toFormat('HH:mm'),

          displayTime: cursor.setLocale('es-MX').toFormat('hh:mm a'),

          startTime: cursor.toUTC().toJSDate(),

          endTime: slotEnd.toUTC().toJSDate(),
        });
      }

      cursor = cursor.plus({
        minutes: schedule.slotIntervalMinutes,
      });
    }

    return slots;
  }

  /* ─────────────────────────────────────────────
     RESOLVER SELECCIÓN
  ───────────────────────────────────────────── */

  resolveSelection(
    slots: AppointmentAvailabilitySlot[],

    input: string,
  ): AppointmentAvailabilitySlot | null {
    const normalized = this.normalizeTimeInput(input);

    if (!normalized) {
      return null;
    }

    /*
     * Selección numérica:
     * 1, 2, 3...
     */
    const numeric = Number(normalized);

    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= slots.length) {
      return slots[numeric - 1];
    }

    /*
     * Permitir:
     *
     * 09:00
     * 9:00
     */
    const normalizedTime = this.normalizeClockTime(normalized);

    if (normalizedTime) {
      return slots.find((slot) => slot.localTime === normalizedTime) ?? null;
    }

    return null;
  }

  formatSlots(slots: AppointmentAvailabilitySlot[]): string {
    return slots
      .map((slot, index) => `${index + 1}. ${slot.displayTime}`)
      .join('\n');
  }

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */

  private getWeekday(date: DateTime): BusinessWeekday {
    const index = date.weekday - 1;

    return BUSINESS_WEEKDAYS[index];
  }

  private normalizeTimeInput(input: string): string {
    return input.trim().toLowerCase();
  }

  private normalizeClockTime(input: string): string | null {
    const match = input.match(/^(\d{1,2}):(\d{2})$/);

    if (!match) {
      return null;
    }

    const hour = Number(match[1]);

    const minute = Number(match[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return `${hour.toString().padStart(2, '0')}:${minute
      .toString()
      .padStart(2, '0')}`;
  }
}
