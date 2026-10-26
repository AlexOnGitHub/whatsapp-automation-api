import { Injectable, NotFoundException } from '@nestjs/common';

import type { FlowKey } from '../../../common/flows/flow-registry';

import type { FlowHandler } from '../types/flow-handler.types';

import { AppointmentFlowHandler } from './appointment-flow.handler';
import { FaqFlowHandler } from './faq-flow.handler';
import { HumanHandoffFlowHandler } from './human-handoff-flow.handler';
import { MainMenuFlowHandler } from './main-menu-flow.handler';
import { RequestFlowHandler } from './request-flow.handler';

@Injectable()
export class FlowHandlerRegistry {
  private readonly handlers: Map<FlowKey, FlowHandler>;

  constructor(
    private readonly mainMenuFlowHandler: MainMenuFlowHandler,

    private readonly faqFlowHandler: FaqFlowHandler,

    private readonly appointmentFlowHandler: AppointmentFlowHandler,

    private readonly requestFlowHandler: RequestFlowHandler,

    private readonly humanHandoffFlowHandler: HumanHandoffFlowHandler,
  ) {
    this.handlers = new Map<FlowKey, FlowHandler>();

    this.register(mainMenuFlowHandler);

    this.register(faqFlowHandler);

    this.register(appointmentFlowHandler);

    this.register(requestFlowHandler);

    this.register(humanHandoffFlowHandler);
  }

  get(flowKey: FlowKey): FlowHandler {
    const handler = this.handlers.get(flowKey);

    if (!handler) {
      throw new NotFoundException(
        `No existe un handler registrado para el flujo ${flowKey}`,
      );
    }

    return handler;
  }

  has(flowKey: FlowKey): boolean {
    return this.handlers.has(flowKey);
  }

  private register(handler: FlowHandler) {
    if (this.handlers.has(handler.flowKey)) {
      throw new Error(
        `Ya existe un handler registrado para ${handler.flowKey}`,
      );
    }

    this.handlers.set(handler.flowKey, handler);
  }
}
