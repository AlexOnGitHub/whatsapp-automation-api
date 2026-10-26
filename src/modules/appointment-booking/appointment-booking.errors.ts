import { ConflictException } from '@nestjs/common';

export class AppointmentSlotUnavailableException extends ConflictException {
  constructor(message = 'El horario seleccionado ya no está disponible') {
    super(message);
  }
}
