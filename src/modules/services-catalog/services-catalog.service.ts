import { Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';

import { BusinessesService } from '../businesses/businesses.service';

import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesCatalogService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly businessesService: BusinessesService,
  ) {}

  /* ─────────────────────────────────────────────
     CONSULTAS
  ───────────────────────────────────────────── */

  async findAllByBusiness(businessId: string) {
    await this.businessesService.findById(businessId);

    return this.prisma.service.findMany({
      where: {
        businessId,
      },

      orderBy: [
        {
          sortOrder: 'asc',
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  async findEnabledByBusiness(businessId: string) {
    await this.businessesService.ensureBusinessIsActive(businessId);

    return this.prisma.service.findMany({
      where: {
        businessId,
        enabled: true,
      },

      orderBy: [
        {
          sortOrder: 'asc',
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  async findById(businessId: string, serviceId: string) {
    await this.businessesService.findById(businessId);

    const service = await this.prisma.service.findFirst({
      where: {
        id: serviceId,
        businessId,
      },
    });

    if (!service) {
      throw new NotFoundException(
        `No se encontró el servicio ${serviceId} para el negocio indicado`,
      );
    }

    return service;
  }

  async findEnabledById(businessId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: {
        id: serviceId,
        businessId,
        enabled: true,
      },
    });

    if (!service) {
      throw new NotFoundException('El servicio no existe o no está habilitado');
    }

    return service;
  }

  /* ─────────────────────────────────────────────
     RESOLUCIÓN DE OPCIONES
  ───────────────────────────────────────────── */

  async resolveSelection(businessId: string, input: string) {
    const services = await this.findEnabledByBusiness(businessId);

    const normalizedInput = this.normalize(input);

    if (!normalizedInput) {
      return null;
    }

    /*
     * 1, 2, 3...
     */
    const numericSelection = Number(normalizedInput);

    if (
      Number.isInteger(numericSelection) &&
      numericSelection >= 1 &&
      numericSelection <= services.length
    ) {
      return services[numericSelection - 1];
    }

    /*
     * UUID / serviceId.
     */
    const byId = services.find((service) => service.id === input.trim());

    if (byId) {
      return byId;
    }

    /*
     * Nombre exacto normalizado.
     */
    const byName = services.find(
      (service) => this.normalize(service.name) === normalizedInput,
    );

    if (byName) {
      return byName;
    }

    return null;
  }

  formatServicesList(
    services: Array<{
      name: string;

      price: Prisma.Decimal | null;

      durationMinutes: number;
    }>,
  ): string {
    return services
      .map((service, index) => {
        const price =
          service.price !== null ? ` - $${service.price.toFixed(2)}` : '';

        return (
          `${index + 1}. ${service.name}` +
          `${price}` +
          ` (${service.durationMinutes} min)`
        );
      })
      .join('\n');
  }

  /* ─────────────────────────────────────────────
     CRUD
  ───────────────────────────────────────────── */

  async create(businessId: string, dto: CreateServiceDto) {
    await this.businessesService.ensureBusinessIsActive(businessId);

    return this.prisma.service.create({
      data: {
        businessId,

        name: dto.name.trim(),

        description: dto.description?.trim(),

        price:
          dto.price !== undefined ? new Prisma.Decimal(dto.price) : undefined,

        durationMinutes: dto.durationMinutes,

        enabled: dto.enabled ?? true,

        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(businessId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.findById(businessId, serviceId);

    return this.prisma.service.update({
      where: {
        id: serviceId,
      },

      data: {
        ...(dto.name !== undefined
          ? {
              name: dto.name.trim(),
            }
          : {}),

        ...(dto.description !== undefined
          ? {
              description: dto.description.trim(),
            }
          : {}),

        ...(dto.price !== undefined
          ? {
              price: new Prisma.Decimal(dto.price),
            }
          : {}),

        ...(dto.durationMinutes !== undefined
          ? {
              durationMinutes: dto.durationMinutes,
            }
          : {}),

        ...(dto.enabled !== undefined
          ? {
              enabled: dto.enabled,
            }
          : {}),

        ...(dto.sortOrder !== undefined
          ? {
              sortOrder: dto.sortOrder,
            }
          : {}),
      },
    });
  }

  async disable(businessId: string, serviceId: string) {
    await this.findById(businessId, serviceId);

    return this.prisma.service.update({
      where: {
        id: serviceId,
      },

      data: {
        enabled: false,
      },
    });
  }

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */

  private normalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
