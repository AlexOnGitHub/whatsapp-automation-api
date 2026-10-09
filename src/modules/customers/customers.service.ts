import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpsertCustomerDto } from './dto/upsert-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
  ) {}

  async findAllByBusiness(businessId: string) {
    await this.businessesService.findById(businessId);

    return this.prisma.customer.findMany({
      where: {
        businessId,
      },
      orderBy: {
        lastSeenAt: 'desc',
      },
    });
  }

  async findById(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: {
        id,
      },
    });

    if (!customer) {
      throw new NotFoundException(`No se encontró el cliente con ID ${id}`);
    }

    return customer;
  }

  async findByWhatsappPhone(businessId: string, whatsappPhone: string) {
    await this.businessesService.findById(businessId);

    const customer = await this.prisma.customer.findUnique({
      where: {
        businessId_whatsappPhone: {
          businessId,
          whatsappPhone,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(
        `No se encontró un cliente con el número ${whatsappPhone}`,
      );
    }

    return customer;
  }

  async create(dto: CreateCustomerDto) {
    await this.businessesService.findById(dto.businessId);

    try {
      return await this.prisma.customer.create({
        data: {
          businessId: dto.businessId,
          whatsappPhone: dto.whatsappPhone,
          whatsappName: dto.whatsappName,
          displayName: dto.displayName,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un cliente con ese número de WhatsApp para este negocio',
        );
      }

      throw error;
    }
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findById(id);

    return this.prisma.customer.update({
      where: {
        id,
      },
      data: dto,
    });
  }

  async upsertFromWhatsapp(dto: UpsertCustomerDto) {
    await this.businessesService.ensureBusinessIsActive(dto.businessId);

    const now = new Date();

    return this.prisma.customer.upsert({
      where: {
        businessId_whatsappPhone: {
          businessId: dto.businessId,
          whatsappPhone: dto.whatsappPhone,
        },
      },
      update: {
        whatsappName: dto.whatsappName,
        displayName: dto.displayName,
        lastSeenAt: now,
      },
      create: {
        businessId: dto.businessId,
        whatsappPhone: dto.whatsappPhone,
        whatsappName: dto.whatsappName,
        displayName: dto.displayName,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
  }

  async touchLastSeen(id: string) {
    await this.findById(id);

    return this.prisma.customer.update({
      where: {
        id,
      },
      data: {
        lastSeenAt: new Date(),
      },
    });
  }

  async updateDisplayName(id: string, displayName: string) {
    await this.findById(id);

    return this.prisma.customer.update({
      where: {
        id,
      },
      data: {
        displayName,
      },
    });
  }
}
