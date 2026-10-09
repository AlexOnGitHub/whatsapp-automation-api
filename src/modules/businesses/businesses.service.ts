import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';

import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.business.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findById(id: string) {
    const business = await this.prisma.business.findUnique({
      where: {
        id,
      },
    });

    if (!business) {
      throw new NotFoundException(`No se encontró el negocio con ID ${id}`);
    }

    return business;
  }

  async findBySlug(slug: string) {
    const business = await this.prisma.business.findUnique({
      where: {
        slug,
      },
    });

    if (!business) {
      throw new NotFoundException(`No se encontró el negocio con slug ${slug}`);
    }

    return business;
  }

  async findByWhatsappPhone(phone: string) {
    const business = await this.prisma.business.findUnique({
      where: {
        whatsappPhoneNumber: phone,
      },
    });

    if (!business) {
      throw new NotFoundException(
        `No existe un negocio asociado al número ${phone}`,
      );
    }

    return business;
  }

  async create(dto: CreateBusinessDto) {
    try {
      return await this.prisma.business.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          businessType: dto.businessType,
          whatsappPhoneNumber: dto.whatsappPhoneNumber,
          timezone: dto.timezone ?? 'America/Mexico_City',
          status: dto.status ?? 'ACTIVE',
          plan: dto.plan ?? 'BASIC',
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un negocio con alguno de los valores únicos proporcionados',
        );
      }

      throw error;
    }
  }

  async update(id: string, dto: UpdateBusinessDto) {
    await this.findById(id);

    try {
      return await this.prisma.business.update({
        where: {
          id,
        },
        data: dto,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un negocio con alguno de los valores únicos proporcionados',
        );
      }

      throw error;
    }
  }

  async ensureBusinessIsActive(id: string) {
    const business = await this.findById(id);

    if (business.status !== 'ACTIVE') {
      throw new BadRequestException(
        `El negocio ${business.name} no se encuentra activo`,
      );
    }

    return business;
  }
}
