export type AppointmentAvailabilitySlot = {
  date: string;

  localTime: string;

  displayTime: string;

  startTime: Date;

  endTime: Date;
};

export type GetAvailabilityParams = {
  businessId: string;

  serviceId: string;

  date: string;

  excludeAppointmentId?: string;
};
