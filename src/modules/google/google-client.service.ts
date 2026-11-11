import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Integration, IntegrationStatus } from '@prisma/client';

import { google } from 'googleapis';

import { PrismaService } from '../../database/prisma/prisma.service';

import { IntegrationCryptoService } from '../../common/security/integration-crypto.service';

import {
  GOOGLE_PROVIDER,
  GOOGLE_WORKSPACE_INTEGRATION_TYPE,
} from './google.constants';

import type {
  GoogleOAuth2Client,
  GoogleStoredCredentials,
} from './google-oauth.service';

/*
 * Tipo mínimo necesario para los tokens
 * que emite OAuth2Client.
 *
 * Evitamos depender directamente de
 * google-auth-library.
 */
type GoogleRefreshedTokens = {
  access_token?: string | null;

  refresh_token?: string | null;

  scope?: string;

  token_type?: string | null;

  expiry_date?: number | null;
};

type GoogleAuthenticatedClient = {
  oauthClient: GoogleOAuth2Client;

  integration: Integration;
};

@Injectable()
export class GoogleClientService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly cryptoService: IntegrationCryptoService,
  ) {}

  /* ─────────────────────────────────────────────
     AUTHENTICATED CLIENT
  ───────────────────────────────────────────── */

  async getAuthenticatedClient(
    businessId: string,
  ): Promise<GoogleAuthenticatedClient> {
    const integration = await this.prisma.integration.findUnique({
      where: {
        businessId_provider_integrationType: {
          businessId,

          provider: GOOGLE_PROVIDER,

          integrationType: GOOGLE_WORKSPACE_INTEGRATION_TYPE,
        },
      },
    });

    if (!integration) {
      throw new NotFoundException(
        'El negocio no tiene Google Workspace conectado',
      );
    }

    if (integration.status !== IntegrationStatus.ACTIVE) {
      throw new ConflictException(
        `La integración Google Workspace no está activa. Estado actual: ${integration.status}`,
      );
    }

    if (!integration.credentialsEncrypted) {
      throw new ConflictException(
        'La integración Google Workspace no contiene credenciales',
      );
    }

    const credentials = this.cryptoService.decrypt<GoogleStoredCredentials>(
      integration.credentialsEncrypted,
    );

    if (!credentials.refreshToken) {
      throw new ConflictException(
        'La integración Google Workspace no contiene refresh token',
      );
    }

    const oauthClient = this.createOAuthClient();

    oauthClient.setCredentials({
      access_token: credentials.accessToken ?? undefined,

      refresh_token: credentials.refreshToken,

      scope: credentials.scope ?? undefined,

      token_type: credentials.tokenType ?? undefined,

      expiry_date: credentials.expiryDate ?? undefined,
    });

    /*
     * googleapis emite nuevos tokens cuando
     * refresca el access token.
     */
    oauthClient.on('tokens', (tokens) => {
      void this.persistRefreshedTokens(integration, credentials, tokens).catch(
        () => {
          /*
           * No interrumpimos una operación contra
           * Google únicamente porque falle la
           * persistencia del token refrescado.
           */
        },
      );
    });

    try {
      await oauthClient.getAccessToken();
    } catch (error) {
      const response = (error as { response?: { data?: { error?: string } } } | null)?.response;
      if (response?.data?.error === 'invalid_grant') {
        await this.prisma.integration.updateMany({
          where: { id: integration.id, credentialsEncrypted: integration.credentialsEncrypted, status: IntegrationStatus.ACTIVE },
          data: { status: IntegrationStatus.ERROR, lastError: 'Google rechazó el refresh token. Reconecta la integración.', lastErrorAt: new Date() },
        });
      }
      throw error;
    }

    return {
      oauthClient,

      integration,
    };
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
     TOKEN REFRESH
  ───────────────────────────────────────────── */

  private async persistRefreshedTokens(
    integration: Integration,
    current: GoogleStoredCredentials,
    tokens: GoogleRefreshedTokens,
  ): Promise<void> {
    const next: GoogleStoredCredentials = {
      accessToken: tokens.access_token ?? current.accessToken,

      refreshToken: tokens.refresh_token ?? current.refreshToken,

      scope: tokens.scope ?? current.scope,

      tokenType: tokens.token_type ?? current.tokenType,

      expiryDate: tokens.expiry_date ?? current.expiryDate,
    };

    await this.prisma.integration.updateMany({
      where: {
        id: integration.id,
        status: IntegrationStatus.ACTIVE,
        credentialsEncrypted: integration.credentialsEncrypted,
      },

      data: {
        credentialsEncrypted: this.cryptoService.encrypt(next),
      },
    });
  }
}
