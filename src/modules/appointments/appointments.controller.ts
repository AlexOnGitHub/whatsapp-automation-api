import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Query,
} from '@nestjs/common';

import { AppointmentStatus } from '@prisma/client';

import { AppointmentsService } from './appointments.service';

import { AppointmentActionDto } from './dto/appointment-action.dto';

import { AppointmentRescheduleService } from './appointment-reschedule.service';

import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';

import { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto';

@Controller('businesses/:businessId/appointments')
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,

    private readonly appointmentRescheduleService: AppointmentRescheduleService,
  ) {}

  /* ─────────────────────────────────────────────
     LIST
  ───────────────────────────────────────────── */

  @Get()
  findAll(
    @Param('businessId')
    businessId: string,

    @Query()
    query: ListAppointmentsQueryDto,
  ) {
    return this.appointmentsService.findAllByBusiness(businessId, query);
  }

  @Get('upcoming')
  findUpcoming(
    @Param('businessId')
    businessId: string,

    @Query('limit')
    rawLimit?: string,
  ) {
    const limit = rawLimit ? Number(rawLimit) : 50;

    return this.appointmentsService.findUpcomingByBusiness(
      businessId,
      Number.isFinite(limit) ? limit : 50,
    );
  }

  @Get('customer/:customerId')
  findByCustomer(
    @Param('businessId')
    businessId: string,

    @Param('customerId')
    customerId: string,
  ) {
    return this.appointmentsService.findByCustomer(businessId, customerId);
  }

  @Get('customer/:customerId/upcoming')
  findUpcomingByCustomer(
    @Param('businessId')
    businessId: string,

    @Param('customerId')
    customerId: string,
  ) {
    return this.appointmentsService.findUpcomingByCustomer(
      businessId,
      customerId,
    );
  }

  /* ─────────────────────────────────────────────
     STATUS FILTER
  ───────────────────────────────────────────── */

  @Get('status/:status')
  findByStatus(
    @Param('businessId')
    businessId: string,

    @Param('status', new ParseEnumPipe(AppointmentStatus))
    status: AppointmentStatus,
  ) {
    return this.appointmentsService.findAllByBusiness(businessId, {
      status,
    });
  }

  /* ─────────────────────────────────────────────
     DETAIL
  ───────────────────────────────────────────── */

  @Get(':appointmentId')
  findById(
    @Param('businessId')
    businessId: string,

    @Param('appointmentId')
    appointmentId: string,
  ) {
    return this.appointmentsService.findById(businessId, appointmentId);
  }

  /* ─────────────────────────────────────────────
     LIFECYCLE
  ───────────────────────────────────────────── */

  @Patch(':appointmentId/cancel')
  cancel(
    @Param('businessId')
    businessId: string,

    @Param('appointmentId')
    appointmentId: string,

    @Body()
    dto: AppointmentActionDto,
  ) {
    return this.appointmentsService.cancel(businessId, appointmentId, dto);
  }

  @Patch(':appointmentId/complete')
  complete(
    @Param('businessId')
    businessId: string,

    @Param('appointmentId')
    appointmentId: string,

    @Body()
    dto: AppointmentActionDto,
  ) {
    return this.appointmentsService.complete(businessId, appointmentId, dto);
  }

  @Patch(':appointmentId/no-show')
  markNoShow(
    @Param('businessId')
    businessId: string,

    @Param('appointmentId')
    appointmentId: string,

    @Body()
    dto: AppointmentActionDto,
  ) {
    return this.appointmentsService.markNoShow(businessId, appointmentId, dto);
  }

  @Patch(':appointmentId/reschedule')
  reschedule(
    @Param('businessId')
    businessId: string,

    @Param('appointmentId')
    appointmentId: string,

    @Body()
    dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentRescheduleService.reschedule(
      businessId,
      appointmentId,
      dto,
    );
  }
}
