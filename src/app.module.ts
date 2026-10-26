import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma/prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { BusinessConfigsModule } from './modules/business-configs/business-configs.module';
import { BusinessModulesModule } from './modules/business-modules/business-modules.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { ConversationSessionsModule } from './modules/conversation-sessions/conversation-sessions.module';
import { InteractionLogsModule } from './modules/interaction-logs/interaction-logs.module';
import { ErrorLogsModule } from './modules/error-logs/error-logs.module';
import { FlowEngineModule } from './modules/flow-engine/flow-engine.module';
import { ServicesCatalogModule } from './modules/services-catalog/services-catalog.module';
import { AppointmentAvailabilityModule } from './modules/appointment-availability/appointment-availability.module';
import { AppointmentBookingModule } from './modules/appointment-booking/appointment-booking.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { GoogleCalendarModule } from './modules/google-calendar/google-calendar.module';

@Module({
  imports: [
    PrismaModule,
    BusinessesModule,
    BusinessConfigsModule,
    BusinessModulesModule,
    CustomersModule,
    ConversationsModule,
    MessagesModule,
    ConversationSessionsModule,
    InteractionLogsModule,
    ErrorLogsModule,
    FlowEngineModule,
    ServicesCatalogModule,
    AppointmentAvailabilityModule,
    AppointmentBookingModule,
    AppointmentsModule,
    GoogleCalendarModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
