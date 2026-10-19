import type { FlowKey } from '../flows/flow-registry';

import { FLOW_KEYS, isValidFlowKey } from '../flows/flow-registry';

export const MAIN_MENU_OPTION_IDS = {
  APPOINTMENT: 'APPOINTMENT',
  FAQ: 'FAQ',
  REQUEST: 'REQUEST',
  HUMAN_HANDOFF: 'HUMAN_HANDOFF',
} as const;

export type MainMenuOptionId =
  (typeof MAIN_MENU_OPTION_IDS)[keyof typeof MAIN_MENU_OPTION_IDS];

export type MainMenuOption = {
  id: MainMenuOptionId;

  /**
   * Texto visible para el usuario.
   */
  label: string;

  /**
   * Flow al que navegará.
   */
  targetFlowKey: FlowKey;

  /**
   * También permitimos entradas como:
   * "1", "agendar", "cita", etc.
   */
  aliases: string[];
};

export type MainMenuConfig = {
  prompt: string;
  options: MainMenuOption[];
};

/* ─────────────────────────────────────────────
   DEFAULT
───────────────────────────────────────────── */

export const DEFAULT_MAIN_MENU_CONFIG: MainMenuConfig = {
  prompt: '¿Cómo podemos ayudarte?',

  options: [
    {
      id: MAIN_MENU_OPTION_IDS.APPOINTMENT,

      label: 'Agendar una cita',

      targetFlowKey: FLOW_KEYS.APPOINTMENT,

      aliases: ['1', 'agendar', 'agenda', 'cita', 'agendar cita'],
    },

    {
      id: MAIN_MENU_OPTION_IDS.FAQ,

      label: 'Preguntas frecuentes',

      targetFlowKey: FLOW_KEYS.FAQ,

      aliases: ['2', 'faq', 'preguntas', 'preguntas frecuentes'],
    },

    {
      id: MAIN_MENU_OPTION_IDS.REQUEST,

      label: 'Enviar una solicitud',

      targetFlowKey: FLOW_KEYS.REQUEST,

      aliases: ['3', 'solicitud', 'solicitudes'],
    },

    {
      id: MAIN_MENU_OPTION_IDS.HUMAN_HANDOFF,

      label: 'Hablar con una persona',

      targetFlowKey: FLOW_KEYS.HUMAN_HANDOFF,

      aliases: ['4', 'humano', 'persona', 'asesor', 'hablar con alguien'],
    },
  ],
};

/* ─────────────────────────────────────────────
   PARSER
───────────────────────────────────────────── */

export function parseMainMenuConfig(value: unknown): MainMenuConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_MAIN_MENU_CONFIG;
  }

  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.prompt !== 'string' ||
    !Array.isArray(candidate.options)
  ) {
    return DEFAULT_MAIN_MENU_CONFIG;
  }

  const options: MainMenuOption[] = [];

  for (const rawOption of candidate.options) {
    if (
      !rawOption ||
      typeof rawOption !== 'object' ||
      Array.isArray(rawOption)
    ) {
      continue;
    }

    const option = rawOption as Record<string, unknown>;

    if (
      typeof option.id !== 'string' ||
      typeof option.label !== 'string' ||
      typeof option.targetFlowKey !== 'string' ||
      !isValidFlowKey(option.targetFlowKey)
    ) {
      continue;
    }

    if (
      !Object.values(MAIN_MENU_OPTION_IDS).includes(
        option.id as MainMenuOptionId,
      )
    ) {
      continue;
    }

    const aliases = Array.isArray(option.aliases)
      ? option.aliases.filter(
          (alias): alias is string => typeof alias === 'string',
        )
      : [];

    options.push({
      id: option.id as MainMenuOptionId,

      label: option.label,

      targetFlowKey: option.targetFlowKey,

      aliases,
    });
  }

  if (options.length === 0) {
    return DEFAULT_MAIN_MENU_CONFIG;
  }

  return {
    prompt: candidate.prompt,

    options,
  };
}
