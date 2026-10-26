import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { IntegrationStatus } from '@prisma/client';

import { calendar_v3, google } from 'googleapis';

import { PrismaService } from '../../database/prisma/prisma.service';

import { IntegrationCryptoService } from '../../common/security/integration-crypto.service';

import {
  GOOGLE_CALENDAR_DEFAULT_ID,
  GOOGLE_CALENDAR_INTEGRATION_TYPE,
  GOOGLE_CALENDAR_PROVIDER,
} from './google-calendar.constants';

type GoogleStoredCredentials = {
  accessToken?: string | null;

  refreshToken: string | null;

  scope?: string | null;

  tokenType?: string | null;

  expiryDate?: number | null;
};

type GoogleCalendarSettings = {
  calendarId?: string;
};

@Injectable()
export class GoogleCalendarClientService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly cryptoService: IntegrationCryptoService,
  ) {}

  /* ─────────────────────────────────────────────
     CLIENT
  ───────────────────────────────────────────── */

  async getCalendarClient(businessId: string) {
    const integration = await this.prisma.integration.findUnique({
      where: {
        businessId_provider_integrationType: {
          businessId,

          provider: GOOGLE_CALENDAR_PROVIDER,

          integrationType: GOOGLE_CALENDAR_INTEGRATION_TYPE,
        },
      },
    });

    if (!integration) {
      throw new NotFoundException(
        'El negocio no tiene Google Calendar conectado',
      );
    }

    if (integration.status !== IntegrationStatus.ACTIVE) {
      throw new ConflictException(
        `La integración Google Calendar no está activa. Estado actual: ${integration.status}`,
      );
    }

    if (!integration.credentialsEncrypted) {
      throw new ConflictException('La integración no contiene credenciales');
    }

    const credentials = this.cryptoService.decrypt<GoogleStoredCredentials>(
      integration.credentialsEncrypted,
    );

    if (!credentials.refreshToken) {
      throw new ConflictException('La integración no contiene refresh token');
    }

    const oauthClient = this.createOAuthClient();

    oauthClient.setCredentials({
      access_token: credentials.accessToken ?? undefined,

      refresh_token: credentials.refreshToken,

      scope: credentials.scope ?? undefined,

      token_type: credentials.tokenType ?? undefined,

      expiry_date: credentials.expiryDate ?? undefined,
    });

    oauthClient.on('tokens', async (tokens) => {
      try {
        await this.persistRefreshedTokens(businessId, credentials, tokens);
      } catch {
        /*
         * No interrumpimos una llamada a Google
         * porque falle únicamente la persistencia
         * del nuevo access token.
         */
      }
    });

    const settings = this.toObject(
      integration.settings,
    ) as GoogleCalendarSettings;

    const calendarId =
      typeof settings.calendarId === 'string' && settings.calendarId.trim()
        ? settings.calendarId
        : GOOGLE_CALENDAR_DEFAULT_ID;

    return {
      calendar: google.calendar({
        version: 'v3',
        auth: oauthClient,
      }),

      calendarId,

      integration,
    };
  }

  /* ─────────────────────────────────────────────
     OAUTH
  ───────────────────────────────────────────── */

  private createOAuthClient() {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Las variables OAuth de Google no están configuradas');
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  /* ─────────────────────────────────────────────
     TOKEN REFRESH
  ───────────────────────────────────────────── */

  private async persistRefreshedTokens(
    businessId: string,
    current: GoogleStoredCredentials,
    tokens: {
      access_token?: string | null;

      refresh_token?: string | null;

      scope?: string;

      token_type?: string | null;

      expiry_date?: number | null;
    },
  ) {
    const next: GoogleStoredCredentials = {
      accessToken: tokens.access_token ?? current.accessToken,

      refreshToken: tokens.refresh_token ?? current.refreshToken,

      scope: tokens.scope ?? current.scope,

      tokenType: tokens.token_type ?? current.tokenType,

      expiryDate: tokens.expiry_date ?? current.expiryDate,
    };

    await this.prisma.integration.update({
      where: {
        businessId_provider_integrationType: {
          businessId,

          provider: GOOGLE_CALENDAR_PROVIDER,

          integrationType: GOOGLE_CALENDAR_INTEGRATION_TYPE,
        },
      },

      data: {
        credentialsEncrypted: this.cryptoService.encrypt(next),
      },
    });
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}
