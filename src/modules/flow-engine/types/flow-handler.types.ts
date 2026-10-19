import type { FlowKey } from '../../../common/flows/flow-registry';

import type { FlowContext } from './flow-context.types';
import type { FlowEngineResult } from './flow-result.types';

export interface FlowHandler {
  readonly flowKey: FlowKey;

  start(context: FlowContext): Promise<FlowEngineResult>;

  handle(context: FlowContext): Promise<FlowEngineResult>;
}
