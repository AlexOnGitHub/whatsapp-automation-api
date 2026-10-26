import { Injectable } from '@nestjs/common';

import {
  FLOW_KEYS,
  HUMAN_HANDOFF_STEPS,
} from '../../../common/flows/flow-registry';

import type { FlowContext } from '../types/flow-context.types';
import type { FlowHandler } from '../types/flow-handler.types';
import type { FlowEngineResult } from '../types/flow-result.types';

@Injectable()
export class HumanHandoffFlowHandler implements FlowHandler {
  readonly flowKey = FLOW_KEYS.HUMAN_HANDOFF;

  async start(context: FlowContext): Promise<FlowEngineResult> {
    return {
      handled: true,

      flowKey: FLOW_KEYS.HUMAN_HANDOFF,

      stepKey: HUMAN_HANDOFF_STEPS.CAPTURE_REASON,

      sessionId: context.session?.id,

      responses: [
        {
          type: 'TEXT',

          text: 'Claro. Antes de comunicarte con una persona, indícame brevemente el motivo de tu solicitud.',
        },
      ],

      metadata: {
        reason: 'HUMAN_HANDOFF_STARTED',
      },
    };
  }

  async handle(context: FlowContext): Promise<FlowEngineResult> {
    return {
      handled: true,

      flowKey: FLOW_KEYS.HUMAN_HANDOFF,

      stepKey: context.session?.stepKey ?? HUMAN_HANDOFF_STEPS.CAPTURE_REASON,

      sessionId: context.session?.id,

      responses: [
        {
          type: 'TEXT',

          text: 'Indícame brevemente el motivo para solicitar atención humana.',
        },
      ],

      metadata: {
        reason: 'HUMAN_HANDOFF_WAITING_INPUT',
      },
    };
  }
}
