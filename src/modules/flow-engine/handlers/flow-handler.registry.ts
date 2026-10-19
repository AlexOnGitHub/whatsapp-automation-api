import { Injectable, NotFoundException } from '@nestjs/common';

import type { FlowHandler } from '../types/flow-handler.types';

import type { FlowKey } from '../../../common/flows/flow-registry';

import { MainMenuFlowHandler } from './main-menu-flow.handler';

@Injectable()
export class FlowHandlerRegistry {
  private readonly handlers: Map<FlowKey, FlowHandler>;

  constructor(private readonly mainMenuFlowHandler: MainMenuFlowHandler) {
    this.handlers = new Map<FlowKey, FlowHandler>([
      [mainMenuFlowHandler.flowKey, mainMenuFlowHandler],
    ]);
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
}
