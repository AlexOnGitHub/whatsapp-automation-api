import {
  BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable,
  NotFoundException, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma/prisma.service';

type Resource = 'customer' | 'conversation' | 'conversationSession' | 'message' | 'appointment';
const ACCESS = Symbol('api-access');
type Access = Resource | 'flow' | 'delivery' | 'public';
export const ApiAccess = (access: Access) => SetMetadata(ACCESS, access);

function matches(token: string, expected?: string): boolean {
  if (!expected) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(token), digest(expected));
}

@Injectable()
export class ApiAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS, [
      context.getHandler(), context.getClass(),
    ]);
    if (access === 'public') return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    if (matches(token, process.env.API_ADMIN_TOKEN)) return true;

    const businessId = process.env.API_SERVICE_BUSINESS_ID;
    if (!businessId || !matches(token, process.env.API_SERVICE_TOKEN)) {
      throw new UnauthorizedException();
    }
    if (!access) throw new ForbiddenException();

    const { params, body } = request;
    if (access === 'flow' && (typeof body?.messageId !== 'string' || !body.messageId.trim())) {
      throw new BadRequestException('messageId es obligatorio para procesar mensajes con una credencial de servicio');
    }
    const requestedBusiness = params.businessId ?? body?.businessId;
    if (requestedBusiness !== undefined && requestedBusiness !== businessId) {
      throw new ForbiddenException();
    }

    const id = params.id;
    const conversationId = params.conversationId;
    const whatsappMessageId = params.whatsappMessageId ?? (
      access === 'delivery'
        ? body?.whatsappMessageId : undefined
    );
    if (typeof id === 'string' && access !== 'flow' && access !== 'delivery') {
      await this.checkResource(access, id, businessId);
    } else if (typeof params.customerId === 'string') {
      await this.checkResource('customer', params.customerId, businessId);
    } else if (typeof conversationId === 'string') {
      await this.checkResource('conversation', conversationId, businessId);
    } else if (typeof whatsappMessageId === 'string' && whatsappMessageId) {
      const message = await this.prisma.message.findFirst({
        where: { whatsappMessageId, businessId }, select: { id: true },
      });
      if (!message) throw new NotFoundException();
    } else if (requestedBusiness !== businessId) {
      throw new ForbiddenException();
    }

    return true;
  }

  private async checkResource(resource: Resource, id: string, businessId: string) {
    const query = { where: { id, businessId }, select: { id: true } } as const;
    const lookups = {
      customer: () => this.prisma.customer.findFirst(query),
      conversation: () => this.prisma.conversation.findFirst(query),
      conversationSession: () => this.prisma.conversationSession.findFirst(query),
      message: () => this.prisma.message.findFirst(query),
      appointment: () => this.prisma.appointment.findFirst(query),
    };
    if (!(await lookups[resource]())) throw new NotFoundException();
  }
}

