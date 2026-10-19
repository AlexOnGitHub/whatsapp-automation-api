import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Post,
} from '@nestjs/common';

import { ErrorSeverity } from '@prisma/client';

import { ErrorLogsService } from './error-logs.service';
import { CreateErrorLogDto } from './dto/create-error-log.dto';

@Controller('error-logs')
export class ErrorLogsController {
  constructor(private readonly errorLogsService: ErrorLogsService) {}

  @Post()
  create(
    @Body()
    dto: CreateErrorLogDto,
  ) {
    return this.errorLogsService.create(dto);
  }

  @Get('business/:businessId')
  findByBusiness(
    @Param('businessId')
    businessId: string,
  ) {
    return this.errorLogsService.findByBusiness(businessId);
  }

  @Get('correlation/:correlationId')
  findByCorrelationId(
    @Param('correlationId')
    correlationId: string,
  ) {
    return this.errorLogsService.findByCorrelationId(correlationId);
  }

  @Get('source/:source')
  findBySource(
    @Param('source')
    source: string,
  ) {
    return this.errorLogsService.findBySource(source);
  }

  @Get('severity/:severity')
  findBySeverity(
    @Param('severity', new ParseEnumPipe(ErrorSeverity))
    severity: ErrorSeverity,
  ) {
    return this.errorLogsService.findBySeverity(severity);
  }

  @Get(':id')
  findById(
    @Param('id')
    id: string,
  ) {
    return this.errorLogsService.findById(id);
  }
}
