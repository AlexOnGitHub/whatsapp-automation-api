import { Injectable } from '@nestjs/common';

import { FAQ_STEPS, FLOW_KEYS } from '../../../common/flows/flow-registry';

import type { FlowContext } from '../types/flow-context.types';
import type { FlowHandler } from '../types/flow-handler.types';
import type { FlowEngineResult } from '../types/flow-result.types';

@Injectable()
export class FaqFlowHandler implements FlowHandler {
  readonly flowKey = FLOW_KEYS.FAQ;

  async start(context: FlowContext): Promise<FlowEngineResult> {
    return {
      handled: true,

      flowKey: FLOW_KEYS.FAQ,

      stepKey: FAQ_STEPS.WAITING_QUESTION,

      sessionId: context.session?.id,

      responses: [
        {
          type: 'TEXT',

          text: 'Claro. ¿Qué te gustaría saber?',
        },
      ],

      metadata: {
        reason: 'FAQ_STARTED',
      },
    };
  }

  async handle(context: FlowContext): Promise<FlowEngineResult> {
    return {
      handled: true,

      flowKey: FLOW_KEYS.FAQ,

      stepKey: context.session?.stepKey ?? FAQ_STEPS.WAITING_QUESTION,

      sessionId: context.session?.id,

      responses: [
        {
          type: 'TEXT',

          text: 'Estoy listo para buscar una respuesta a tu pregunta.',
        },
      ],

      metadata: {
        reason: 'FAQ_WAITING_INPUT',
      },
    };
  }
}
