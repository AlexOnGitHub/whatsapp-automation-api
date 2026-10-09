import { Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

import { UpsertBusinessConfigDto } from './dto/upsert-business-config.dto';

@Injectable()
export class BusinessConfigsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
  ) {}

  async findByBusinessId(businessId: string) {
    await this.businessesService.findById(businessId);

    const config = await this.prisma.businessConfig.findUnique({
      where: {
        businessId,
      },
    });

    if (!config) {
      throw new NotFoundException(
        `No se encontró configuración para el negocio ${businessId}`,
      );
    }

    return config;
  }

  async upsert(businessId: string, dto: UpsertBusinessConfigDto) {
    await this.businessesService.findById(businessId);

    const data: Prisma.BusinessConfigUncheckedUpdateInput = {
      ...dto,
      mainMenuConfig: dto.mainMenuConfig as Prisma.InputJsonValue | undefined,
      businessHoursConfig: dto.businessHoursConfig as
        Prisma.InputJsonValue | undefined,
      paymentMethods: dto.paymentMethods as Prisma.InputJsonValue | undefined,
    };

    return this.prisma.businessConfig.upsert({
      where: {
        businessId,
      },
      update: data,
      create: {
        businessId,
        welcomeMessage:
          dto.welcomeMessage ?? 'Hola, bienvenido. ¿En qué podemos ayudarte?',
        humanHandoffMessage: dto.humanHandoffMessage,
        fallbackMessage: dto.fallbackMessage,
        mainMenuConfig: dto.mainMenuConfig as Prisma.InputJsonValue | undefined,
        businessHoursConfig: dto.businessHoursConfig as
          Prisma.InputJsonValue | undefined,
        paymentMethods: dto.paymentMethods as Prisma.InputJsonValue | undefined,
        locationText: dto.locationText,
        googleMapsUrl: dto.googleMapsUrl,
        cancellationPolicy: dto.cancellationPolicy,
        maxFailedAttempts: dto.maxFailedAttempts ?? 2,
        sessionExpirationMinutes: dto.sessionExpirationMinutes ?? 60,
      },
    });
  }
}
