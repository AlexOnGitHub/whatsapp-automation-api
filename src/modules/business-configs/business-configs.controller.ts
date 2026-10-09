import { Body, Controller, Get, Param, Put } from '@nestjs/common';

import { BusinessConfigsService } from './business-configs.service';
import { UpsertBusinessConfigDto } from './dto/upsert-business-config.dto';

@Controller('businesses/:businessId/config')
export class BusinessConfigsController {
  constructor(
    private readonly businessConfigsService: BusinessConfigsService,
  ) {}

  @Get()
  findByBusinessId(@Param('businessId') businessId: string) {
    return this.businessConfigsService.findByBusinessId(businessId);
  }

  @Put()
  upsert(
    @Param('businessId') businessId: string,
    @Body() dto: UpsertBusinessConfigDto,
  ) {
    return this.businessConfigsService.upsert(businessId, dto);
  }
}
