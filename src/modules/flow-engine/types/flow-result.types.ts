import type { FlowKey } from '../../../common/flows/flow-registry';

export type FlowResponseMessage = {
  type: 'TEXT';

  text: string;
};

export type FlowTransitionRequest = {
  targetFlowKey: FlowKey;

  context?: Record<string, unknown>;

  reason?: string;
};

export type FlowEngineResult = {
  handled: boolean;

  flowKey: FlowKey;

  stepKey: string;

  sessionId?: string;

  responses: FlowResponseMessage[];

  transition?: FlowTransitionRequest;

  metadata?: Record<string, unknown>;
};
