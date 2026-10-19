export const FLOW_KEYS = {
  MAIN_MENU: 'MAIN_MENU',
  FAQ: 'FAQ',
  APPOINTMENT: 'APPOINTMENT',
  REQUEST: 'REQUEST',
  HUMAN_HANDOFF: 'HUMAN_HANDOFF',
} as const;

export type FlowKey = (typeof FLOW_KEYS)[keyof typeof FLOW_KEYS];

/* ─────────────────────────────────────────────
   STEPS
───────────────────────────────────────────── */

export const MAIN_MENU_STEPS = {
  WAITING_OPTION: 'WAITING_OPTION',
} as const;

export const FAQ_STEPS = {
  WAITING_QUESTION: 'WAITING_QUESTION',
  ANSWERING: 'ANSWERING',
} as const;

export const APPOINTMENT_STEPS = {
  SELECT_SERVICE: 'SELECT_SERVICE',
  SELECT_DATE: 'SELECT_DATE',
  SELECT_TIME: 'SELECT_TIME',
  CAPTURE_NAME: 'CAPTURE_NAME',
  CAPTURE_NOTES: 'CAPTURE_NOTES',
  CONFIRMATION: 'CONFIRMATION',
  CREATING_APPOINTMENT: 'CREATING_APPOINTMENT',
} as const;

export const REQUEST_STEPS = {
  CAPTURE_NAME: 'CAPTURE_NAME',
  SELECT_REQUEST_TYPE: 'SELECT_REQUEST_TYPE',
  CAPTURE_DESCRIPTION: 'CAPTURE_DESCRIPTION',
  CONFIRMATION: 'CONFIRMATION',
  CREATING_REQUEST: 'CREATING_REQUEST',
} as const;

export const HUMAN_HANDOFF_STEPS = {
  CAPTURE_REASON: 'CAPTURE_REASON',
  CREATING_HANDOFF: 'CREATING_HANDOFF',
  WAITING_HUMAN: 'WAITING_HUMAN',
} as const;

/* ─────────────────────────────────────────────
   DEFINITIONS
───────────────────────────────────────────── */

export const FLOW_REGISTRY = {
  [FLOW_KEYS.MAIN_MENU]: {
    key: FLOW_KEYS.MAIN_MENU,
    version: 1,
    initialStep: MAIN_MENU_STEPS.WAITING_OPTION,
    steps: Object.values(MAIN_MENU_STEPS),
  },

  [FLOW_KEYS.FAQ]: {
    key: FLOW_KEYS.FAQ,
    version: 1,
    initialStep: FAQ_STEPS.WAITING_QUESTION,
    steps: Object.values(FAQ_STEPS),
  },

  [FLOW_KEYS.APPOINTMENT]: {
    key: FLOW_KEYS.APPOINTMENT,
    version: 1,
    initialStep: APPOINTMENT_STEPS.SELECT_SERVICE,
    steps: Object.values(APPOINTMENT_STEPS),
  },

  [FLOW_KEYS.REQUEST]: {
    key: FLOW_KEYS.REQUEST,
    version: 1,
    initialStep: REQUEST_STEPS.CAPTURE_NAME,
    steps: Object.values(REQUEST_STEPS),
  },

  [FLOW_KEYS.HUMAN_HANDOFF]: {
    key: FLOW_KEYS.HUMAN_HANDOFF,
    version: 1,
    initialStep: HUMAN_HANDOFF_STEPS.CAPTURE_REASON,
    steps: Object.values(HUMAN_HANDOFF_STEPS),
  },
} as const;

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */

export function isValidFlowKey(value: string): value is FlowKey {
  return Object.values(FLOW_KEYS).includes(value as FlowKey);
}

export function isValidStepForFlow(flowKey: string, stepKey: string): boolean {
  if (!isValidFlowKey(flowKey)) {
    return false;
  }

  const definition = FLOW_REGISTRY[flowKey];

  return (definition.steps as readonly string[]).includes(stepKey);
}

export function getFlowDefinition(flowKey: FlowKey) {
  return FLOW_REGISTRY[flowKey];
}

export function getInitialStep(flowKey: FlowKey): string {
  return FLOW_REGISTRY[flowKey].initialStep;
}
