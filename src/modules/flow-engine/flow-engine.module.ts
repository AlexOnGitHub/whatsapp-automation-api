import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';
import { BusinessConfigsModule } from '../business-configs/business-configs.module';
import { CustomersModule } from '../customers/customers.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationSessionsModule } from '../conversation-sessions/conversation-sessions.module';
import { MessagesModule } from '../messages/messages.module';
import { InteractionLogsModule } from '../interaction-logs/interaction-logs.module';
import { ErrorLogsModule } from '../error-logs/error-logs.module';

import { FlowEngineController } from './flow-engine.controller';
import { FlowEngineService } from './flow-engine.service';

import { FlowHandlerRegistry } from './handlers/flow-handler.registry';
import { MainMenuFlowHandler } from './handlers/main-menu-flow.handler';

import { FlowTransitionService } from './services/flow-transition.service';

@Module({
  imports: [
    BusinessesModule,
    BusinessConfigsModule,
    CustomersModule,
    ConversationsModule,
    ConversationSessionsModule,
    MessagesModule,
    InteractionLogsModule,
    ErrorLogsModule,
  ],

  controllers: [FlowEngineController],

  providers: [
    FlowEngineService,

    FlowTransitionService,

    FlowHandlerRegistry,
    MainMenuFlowHandler,
  ],

  exports: [FlowEngineService, FlowTransitionService],
})
export class FlowEngineModule {}
