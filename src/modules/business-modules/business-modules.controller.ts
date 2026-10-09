import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';

import { BusinessModulesService } from './business-modules.service';
import { UpdateBusinessModuleDto } from './dto/update-business-module.dto';

@Controller('businesses/:businessId/modules')
export class BusinessModulesController {
  constructor(
    private readonly businessModulesService: BusinessModulesService,
  ) {}

  @Get()
  findAll(@Param('businessId') businessId: string) {
    return this.businessModulesService.findAllByBusiness(businessId);
  }

  @Get(':moduleKey')
  findByKey(
    @Param('businessId') businessId: string,
    @Param('moduleKey') moduleKey: string,
  ) {
    return this.businessModulesService.findByKey(businessId, moduleKey);
  }

  @Patch(':moduleKey')
  update(
    @Param('businessId') businessId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() dto: UpdateBusinessModuleDto,
  ) {
    return this.businessModulesService.update(businessId, moduleKey, dto);
  }

  @Put(':moduleKey')
  upsert(
    @Param('businessId') businessId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() dto: UpdateBusinessModuleDto,
  ) {
    return this.businessModulesService.upsert(businessId, moduleKey, dto);
  }
}
