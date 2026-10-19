import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';
import { BusinessConfigsModule } from '../business-configs/business-configs.module';
import { CustomersModule } from '../customers/customers.module';
import { ConversationsModule } from '../conversations/conversations.module';

import { ConversationSessionsController } from './conversation-sessions.controller';
import { ConversationSessionsService } from './conversation-sessions.service';

@Module({
  imports: [
    BusinessesModule,
    BusinessConfigsModule,
    CustomersModule,
    ConversationsModule,
  ],
  controllers: [ConversationSessionsController],
  providers: [ConversationSessionsService],
  exports: [ConversationSessionsService],
})
export class ConversationSessionsModule {}
