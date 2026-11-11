import { BadRequestException, Injectable } from '@nestjs/common';

import { GoogleCalendarConnectionService } from './google-calendar-connection.service';

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { google } from 'googleapis';

import { PrismaService } from '../../database/prisma/prisma.service';

import { IntegrationCryptoService } from '../../common/security/integration-crypto.service';

import { BusinessesService } from '../businesses/businesses.service';

import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_WORKSPACE_SCOPES,
} from './google.constants';

/*
 * Evitamos importar OAuth2Client directamente
 * desde google-auth-library.
 *
 * googleapis ya expone el constructor que usamos
 * en runtime, así que obtenemos el tipo desde ahí.
 */
export type GoogleOAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export type GoogleStoredCredentials = {
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
  calendarId?: string;
};

@Injectable()
export class GoogleOAuthService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly businessesService: BusinessesService,

    private readonly cryptoService: IntegrationCryptoService,
    private readonly calendarConnection: GoogleCalendarConnectionService,
  ) {}

  /* ─────────────────────────────────────────────
     AUTH URL
  ───────────────────────────────────────────── */

  async generateAuthorizationUrl(businessId: string, calendarId?: string): Promise<{
    authorizationUrl: string;
  }> {
    await this.businessesService.ensureBusinessIsActive(businessId);

    const oauth2Client = this.createOAuthClient();

    if (calendarId !== undefined && (typeof calendarId !== 'string' || !calendarId.trim() || calendarId.length > 1024)) {
      throw new BadRequestException('calendarId inválido');
    }
    const state = await this.createState(businessId, calendarId?.trim());

    const authorizationUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',

      include_granted_scopes: true,

      prompt: 'consent',

      scope: [...GOOGLE_WORKSPACE_SCOPES],

      state,
    });

    return {
      authorizationUrl,
    };
  }

  /* ─────────────────────────────────────────────
     CALLBACK
  ───────────────────────────────────────────── */

  async handleCallback(code: string, state: string) {
    if (typeof code !== 'string' || !code || typeof state !== 'string' || !state) {
      throw new BadRequestException('code y state son obligatorios');
    }

    const statePayload = this.verifyState(state);

    await this.businessesService.ensureBusinessIsActive(
      statePayload.businessId,
    );

    const oauth2Client = this.createOAuthClient();

    const consumed = await this.prisma.googleOAuthAttempt.deleteMany({
      where: {
        nonce: statePayload.nonce,
        businessId: statePayload.businessId,
        expiresAt: { gt: new Date() },
      },
    });

    if (consumed.count !== 1) {
      throw new BadRequestException(
        'El intento de conexión de Google expiró o ya fue utilizado. Inicia una nueva conexión.',
      );
    }

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google no devolvió refresh_token. Reconecta la integración autorizando acceso offline.',
      );
    }

    if (!tokens.scope?.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)) {
      throw new BadRequestException('Concede el permiso para ver y editar eventos de Google Calendar');
    }

    const credentials: GoogleStoredCredentials = {
      accessToken: tokens.access_token,

      refreshToken: tokens.refresh_token,

      scope: tokens.scope,

      tokenType: tokens.token_type,

      expiryDate: tokens.expiry_date,
    };

    const credentialsEncrypted = this.cryptoService.encrypt(credentials);

    oauth2Client.setCredentials(tokens);
    return this.calendarConnection.connect(
      statePayload.businessId,
      oauth2Client,
      credentialsEncrypted,
      statePayload.calendarId,
    );
  }

  /* ─────────────────────────────────────────────
     OAUTH CLIENT
  ───────────────────────────────────────────── */

  private createOAuthClient(): GoogleOAuth2Client {
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

  private async createState(businessId: string, calendarId?: string): Promise<string> {
    const payload: OAuthStatePayload = {
      businessId,

      calendarId,
      nonce: randomBytes(24).toString('hex'),

      exp: Date.now() + 10 * 60 * 1000,
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const signature = this.signState(encoded);

    await this.prisma.googleOAuthAttempt.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });

    await this.prisma.googleOAuthAttempt.create({
      data: {
        nonce: payload.nonce,
        businessId: payload.businessId,
        expiresAt: new Date(payload.exp),
      },
    });

    return `${encoded}.${signature}`;
  }

  private verifyState(state: string): OAuthStatePayload {
    const [encoded, suppliedSignature, extra] = state.split('.');

    if (!encoded || !suppliedSignature || extra !== undefined || !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
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

    if (payload.exp <= Date.now()) {
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
