import { BadRequestException, Injectable } from '@nestjs/common';

import { IntegrationStatus } from '@prisma/client';

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { google } from 'googleapis';

import { PrismaService } from '../../database/prisma/prisma.service';

import { IntegrationCryptoService } from '../../common/security/integration-crypto.service';

import { BusinessesService } from '../businesses/businesses.service';

import {
  GOOGLE_CALENDAR_DEFAULT_ID,
  GOOGLE_CALENDAR_INTEGRATION_TYPE,
  GOOGLE_CALENDAR_PROVIDER,
  GOOGLE_CALENDAR_SCOPES,
} from './google-calendar.constants';

type GoogleStoredCredentials = {
  accessToken?: string | null;

  refreshToken: string | null;

  scope?: string | null;

  tokenType?: string | null;

  expiryDate?: number | null;
};

type OAuthStatePayload = {
  businessId: string;

  nonce: string;

  exp: number;
};

@Injectable()
export class GoogleCalendarOAuthService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly businessesService: BusinessesService,

    private readonly cryptoService: IntegrationCryptoService,
  ) {}

  /* ─────────────────────────────────────────────
     AUTH URL
  ───────────────────────────────────────────── */

  async generateAuthorizationUrl(businessId: string) {
    await this.businessesService.ensureBusinessIsActive(businessId);

    const oauth2Client = this.createOAuthClient();

    const state = this.createState(businessId);

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',

      include_granted_scopes: true,

      prompt: 'consent',

      scope: [...GOOGLE_CALENDAR_SCOPES],

      state,
    });

    return {
      authorizationUrl: url,
    };
  }

  /* ─────────────────────────────────────────────
     CALLBACK
  ───────────────────────────────────────────── */

  async handleCallback(code: string, state: string) {
    if (!code || !state) {
      throw new BadRequestException('code y state son obligatorios');
    }

    const statePayload = this.verifyState(state);

    await this.businessesService.ensureBusinessIsActive(
      statePayload.businessId,
    );

    const oauth2Client = this.createOAuthClient();

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google no devolvió refresh_token. Reconecta la integración autorizando acceso offline.',
      );
    }

    const credentials: GoogleStoredCredentials = {
      accessToken: tokens.access_token,

      refreshToken: tokens.refresh_token,

      scope: tokens.scope,

      tokenType: tokens.token_type,

      expiryDate: tokens.expiry_date,
    };

    const credentialsEncrypted = this.cryptoService.encrypt(credentials);

    const integration = await this.prisma.integration.upsert({
      where: {
        businessId_provider_integrationType: {
          businessId: statePayload.businessId,

          provider: GOOGLE_CALENDAR_PROVIDER,

          integrationType: GOOGLE_CALENDAR_INTEGRATION_TYPE,
        },
      },

      create: {
        businessId: statePayload.businessId,

        provider: GOOGLE_CALENDAR_PROVIDER,

        integrationType: GOOGLE_CALENDAR_INTEGRATION_TYPE,

        status: IntegrationStatus.ACTIVE,

        credentialsEncrypted,

        settings: {
          calendarId: GOOGLE_CALENDAR_DEFAULT_ID,
        },

        lastError: null,

        lastErrorAt: null,
      },

      update: {
        status: IntegrationStatus.ACTIVE,

        credentialsEncrypted,

        lastError: null,

        lastErrorAt: null,
      },
    });

    return {
      connected: true,

      businessId: integration.businessId,

      provider: integration.provider,

      integrationType: integration.integrationType,

      status: integration.status,
    };
  }

  /* ─────────────────────────────────────────────
     OAUTH CLIENT
  ───────────────────────────────────────────── */

  private createOAuthClient() {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error(
        'Las variables OAuth de Google no están configuradas correctamente',
      );
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  /* ─────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────── */

  private createState(businessId: string): string {
    const payload: OAuthStatePayload = {
      businessId,

      nonce: randomBytes(24).toString('hex'),

      exp: Date.now() + 10 * 60 * 1000,
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const signature = this.signState(encoded);

    return `${encoded}.${signature}`;
  }

  private verifyState(state: string): OAuthStatePayload {
    const [encoded, suppliedSignature] = state.split('.');

    if (!encoded || !suppliedSignature) {
      throw new BadRequestException('OAuth state inválido');
    }

    const expectedSignature = this.signState(encoded);

    const suppliedBuffer = Buffer.from(suppliedSignature, 'hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new BadRequestException('OAuth state inválido');
    }

    let payload: OAuthStatePayload;

    try {
      payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as OAuthStatePayload;
    } catch {
      throw new BadRequestException('OAuth state inválido');
    }

    if (!payload.businessId || !payload.nonce || !payload.exp) {
      throw new BadRequestException('OAuth state incompleto');
    }

    if (payload.exp < Date.now()) {
      throw new BadRequestException('OAuth state expirado');
    }

    return payload;
  }

  private signState(value: string): string {
    const secret = process.env.GOOGLE_OAUTH_STATE_SECRET;

    if (!secret) {
      throw new Error('GOOGLE_OAUTH_STATE_SECRET no está configurado');
    }

    return createHmac('sha256', secret).update(value).digest('hex');
  }
}
