import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

type EncryptedPayload = {
  iv: string;
  tag: string;
  data: string;
};

@Injectable()
export class IntegrationCryptoService {
  private readonly key: Buffer;

  constructor() {
    const rawKey = process.env.INTEGRATION_ENCRYPTION_KEY;

    if (!rawKey) {
      throw new Error('INTEGRATION_ENCRYPTION_KEY no está configurada');
    }

    this.key = Buffer.from(rawKey, 'base64');

    if (this.key.length !== 32) {
      throw new Error(
        'INTEGRATION_ENCRYPTION_KEY debe contener exactamente 32 bytes',
      );
    }
  }

  encrypt(value: unknown): string {
    const iv = randomBytes(12);

    const cipher = createCipheriv('aes-256-gcm', this.key, iv);

    const plaintext = JSON.stringify(value);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    const payload: EncryptedPayload = {
      iv: iv.toString('base64'),

      tag: authTag.toString('base64'),

      data: encrypted.toString('base64'),
    };

    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  decrypt<T>(encryptedValue: string): T {
    try {
      const payload = JSON.parse(
        Buffer.from(encryptedValue, 'base64').toString('utf8'),
      ) as EncryptedPayload;

      const decipher = createDecipheriv(
        'aes-256-gcm',

        this.key,

        Buffer.from(payload.iv, 'base64'),
      );

      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payload.data, 'base64')),

        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString('utf8')) as T;
    } catch {
      throw new InternalServerErrorException(
        'No fue posible descifrar las credenciales de integración',
      );
    }
  }
}
