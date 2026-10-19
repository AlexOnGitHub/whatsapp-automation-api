import { Injectable } from '@nestjs/common';

import {
  FLOW_KEYS,
  MAIN_MENU_STEPS,
} from '../../../common/flows/flow-registry';

import {
  parseMainMenuConfig,
  type MainMenuConfig,
  type MainMenuOption,
} from '../../../common/config/main-menu.config';

import { BusinessConfigsService } from '../../business-configs/business-configs.service';

import type { FlowHandler } from '../types/flow-handler.types';

import type { FlowContext } from '../types/flow-context.types';

import type { FlowEngineResult } from '../types/flow-result.types';

@Injectable()
export class MainMenuFlowHandler implements FlowHandler {
  readonly flowKey = FLOW_KEYS.MAIN_MENU;

  constructor(
    private readonly businessConfigsService: BusinessConfigsService,
  ) {}

  async start(context: FlowContext): Promise<FlowEngineResult> {
    const config = await this.businessConfigsService.findByBusinessId(
      context.businessId,
    );

    const menuConfig = parseMainMenuConfig(config.mainMenuConfig);

    return {
      handled: true,

      flowKey: FLOW_KEYS.MAIN_MENU,

      stepKey: MAIN_MENU_STEPS.WAITING_OPTION,

      sessionId: context.session?.id,

      responses: [
        {
          type: 'TEXT',

          text: this.buildMenuMessage(config.welcomeMessage, menuConfig),
        },
      ],

      metadata: {
        reason: 'MAIN_MENU_STARTED',
      },
    };
  }

  async handle(context: FlowContext): Promise<FlowEngineResult> {
    const config = await this.businessConfigsService.findByBusinessId(
      context.businessId,
    );

    const menuConfig = parseMainMenuConfig(config.mainMenuConfig);

    const normalizedInput = this.normalizeInput(
      context.input.interactiveId ?? context.input.text ?? '',
    );

    const selectedOption = this.findSelectedOption(menuConfig, normalizedInput);

    /*
     * Entrada inválida.
     */
    if (!selectedOption) {
      return {
        handled: true,

        flowKey: FLOW_KEYS.MAIN_MENU,

        stepKey: MAIN_MENU_STEPS.WAITING_OPTION,

        sessionId: context.session?.id,

        responses: [
          {
            type: 'TEXT',

            text: this.buildInvalidOptionMessage(
              config.fallbackMessage,
              menuConfig,
            ),
          },
        ],

        metadata: {
          reason: 'MAIN_MENU_INVALID_OPTION',

          input: normalizedInput,
        },
      };
    }

    /*
     * Entrada válida.
     *
     * El handler NO toca persistence.
     * Solo expresa la transición deseada.
     */
    return {
      handled: true,

      flowKey: FLOW_KEYS.MAIN_MENU,

      stepKey: MAIN_MENU_STEPS.WAITING_OPTION,

      sessionId: context.session?.id,

      responses: [],

      transition: {
        targetFlowKey: selectedOption.targetFlowKey,

        context: {
          selectedFrom: FLOW_KEYS.MAIN_MENU,

          menuOptionId: selectedOption.id,
        },

        reason: `MAIN_MENU_OPTION_${selectedOption.id}`,
      },

      metadata: {
        reason: 'MAIN_MENU_OPTION_SELECTED',

        optionId: selectedOption.id,

        targetFlowKey: selectedOption.targetFlowKey,
      },
    };
  }

  /* ─────────────────────────────────────────────
     MENU RENDERING
  ───────────────────────────────────────────── */

  private buildMenuMessage(
    welcomeMessage: string,
    config: MainMenuConfig,
  ): string {
    const options = config.options
      .map((option, index) => `${index + 1}. ${option.label}`)
      .join('\n');

    return [welcomeMessage, '', config.prompt, '', options]
      .filter(Boolean)
      .join('\n');
  }

  private buildInvalidOptionMessage(
    fallbackMessage: string | null | undefined,

    config: MainMenuConfig,
  ): string {
    const options = config.options
      .map((option, index) => `${index + 1}. ${option.label}`)
      .join('\n');

    return [
      fallbackMessage ?? 'No pude identificar esa opción.',

      '',
      config.prompt,
      '',
      options,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /* ─────────────────────────────────────────────
     OPTION RESOLUTION
  ───────────────────────────────────────────── */

  private findSelectedOption(
    config: MainMenuConfig,
    input: string,
  ): MainMenuOption | undefined {
    if (!input) {
      return undefined;
    }

    /*
     * Permite seleccionar por posición:
     *
     * 1, 2, 3, 4...
     */
    const numericOption = Number(input);

    if (
      Number.isInteger(numericOption) &&
      numericOption >= 1 &&
      numericOption <= config.options.length
    ) {
      return config.options[numericOption - 1];
    }

    return config.options.find((option) => {
      if (this.normalizeInput(option.id) === input) {
        return true;
      }

      if (this.normalizeInput(option.label) === input) {
        return true;
      }

      return option.aliases.some(
        (alias) => this.normalizeInput(alias) === input,
      );
    });
  }

  private normalizeInput(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
