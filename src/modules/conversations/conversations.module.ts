import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';
import { CustomersModule } from '../customers/customers.module';

import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [BusinessesModule, CustomersModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
