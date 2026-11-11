import { ApiAccess } from '../../common/security/api-access.guard';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CustomersService } from './customers.service';

import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpsertCustomerDto } from './dto/upsert-customer.dto';

@ApiAccess('customer')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get('business/:businessId')
  findAllByBusiness(@Param('businessId') businessId: string) {
    return this.customersService.findAllByBusiness(businessId);
  }

  @Get('business/:businessId/whatsapp/:phone')
  findByWhatsappPhone(
    @Param('businessId') businessId: string,
    @Param('phone') phone: string,
  ) {
    return this.customersService.findByWhatsappPhone(businessId, phone);
  }

  @Post('upsert/whatsapp')
  upsertFromWhatsapp(@Body() dto: UpsertCustomerDto) {
    return this.customersService.upsertFromWhatsapp(dto);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.customersService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }
}
