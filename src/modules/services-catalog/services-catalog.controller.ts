import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { ServicesCatalogService } from './services-catalog.service';

import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Controller('businesses/:businessId/services')
export class ServicesCatalogController {
  constructor(
    private readonly servicesCatalogService: ServicesCatalogService,
  ) {}

  @Get()
  findAll(
    @Param('businessId')
    businessId: string,
  ) {
    return this.servicesCatalogService.findAllByBusiness(businessId);
  }

  @Get('enabled')
  findEnabled(
    @Param('businessId')
    businessId: string,
  ) {
    return this.servicesCatalogService.findEnabledByBusiness(businessId);
  }

  @Get(':serviceId')
  findById(
    @Param('businessId')
    businessId: string,

    @Param('serviceId')
    serviceId: string,
  ) {
    return this.servicesCatalogService.findById(businessId, serviceId);
  }

  @Post()
  create(
    @Param('businessId')
    businessId: string,

    @Body()
    dto: CreateServiceDto,
  ) {
    return this.servicesCatalogService.create(businessId, dto);
  }

  @Patch(':serviceId')
  update(
    @Param('businessId')
    businessId: string,

    @Param('serviceId')
    serviceId: string,

    @Body()
    dto: UpdateServiceDto,
  ) {
    return this.servicesCatalogService.update(businessId, serviceId, dto);
  }

  @Delete(':serviceId')
  disable(
    @Param('businessId')
    businessId: string,

    @Param('serviceId')
    serviceId: string,
  ) {
    return this.servicesCatalogService.disable(businessId, serviceId);
  }
}
