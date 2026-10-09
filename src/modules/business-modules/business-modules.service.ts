import { Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

import { UpdateBusinessModuleDto } from './dto/update-business-module.dto';

@Injectable()
export class BusinessModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
  ) {}

  async findAllByBusiness(businessId: string) {
    await this.businessesService.findById(businessId);

    return this.prisma.businessModule.findMany({
      where: {
        businessId,
      },
      orderBy: {
        moduleKey: 'asc',
      },
    });
  }

  async findByKey(businessId: string, moduleKey: string) {
    await this.businessesService.findById(businessId);

    const businessModule = await this.prisma.businessModule.findUnique({
      where: {
        businessId_moduleKey: {
          businessId,
          moduleKey,
        },
      },
    });

    if (!businessModule) {
      throw new NotFoundException(
        `El módulo ${moduleKey} no está configurado para el negocio ${businessId}`,
      );
    }

    return businessModule;
  }

  async isModuleEnabled(businessId: string, moduleKey: string) {
    const businessModule = await this.prisma.businessModule.findUnique({
      where: {
        businessId_moduleKey: {
          businessId,
          moduleKey,
        },
      },
    });

    return businessModule?.enabled ?? false;
  }

  async getModuleConfig(businessId: string, moduleKey: string) {
    const businessModule = await this.findByKey(businessId, moduleKey);

    return businessModule.config;
  }

  async update(
    businessId: string,
    moduleKey: string,
    dto: UpdateBusinessModuleDto,
  ) {
    await this.businessesService.findById(businessId);

    const existing = await this.prisma.businessModule.findUnique({
      where: {
        businessId_moduleKey: {
          businessId,
          moduleKey,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(
        `El módulo ${moduleKey} no está configurado para este negocio`,
      );
    }

    return this.prisma.businessModule.update({
      where: {
        businessId_moduleKey: {
          businessId,
          moduleKey,
        },
      },
      data: {
        enabled: dto.enabled,
        config: dto.config as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async upsert(
    businessId: string,
    moduleKey: string,
    dto: UpdateBusinessModuleDto,
  ) {
    await this.businessesService.findById(businessId);

    return this.prisma.businessModule.upsert({
      where: {
        businessId_moduleKey: {
          businessId,
          moduleKey,
        },
      },
      update: {
        enabled: dto.enabled,
        config: dto.config as Prisma.InputJsonValue | undefined,
      },
      create: {
        businessId,
        moduleKey,
        enabled: dto.enabled ?? true,
        config: dto.config as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
