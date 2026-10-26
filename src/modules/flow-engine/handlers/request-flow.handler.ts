import { Injectable } from '@nestjs/common';

import { FLOW_KEYS, REQUEST_STEPS } from '../../../common/flows/flow-registry';

import type { FlowContext } from '../types/flow-context.types';
import type { FlowHandler } from '../types/flow-handler.types';
import type { FlowEngineResult } from '../types/flow-result.types';

@Injectable()
export class RequestFlowHandler implements FlowHandler {
  readonly flowKey = FLOW_KEYS.REQUEST;

  async start(context: FlowContext): Promise<FlowEngineResult> {
    return {
      handled: true,

      flowKey: FLOW_KEYS.REQUEST,

      stepKey: REQUEST_STEPS.CAPTURE_NAME,

      sessionId: context.session?.id,

      responses: [
        {
          type: 'TEXT',

          text:
            'Vamos a registrar tu solicitud.\n\n' +
            'Para comenzar, ¿a nombre de quién la registramos?',
        },
      ],

      metadata: {
        reason: 'REQUEST_STARTED',
      },
    };
  }

  async handle(context: FlowContext): Promise<FlowEngineResult> {
    return {
      handled: true,

      flowKey: FLOW_KEYS.REQUEST,

      stepKey: context.session?.stepKey ?? REQUEST_STEPS.CAPTURE_NAME,

      sessionId: context.session?.id,

      responses: [
        {
          type: 'TEXT',

          text: 'Indícame la información solicitada para continuar.',
        },
      ],

      metadata: {
        reason: 'REQUEST_WAITING_INPUT',
      },
    };
  }
}
