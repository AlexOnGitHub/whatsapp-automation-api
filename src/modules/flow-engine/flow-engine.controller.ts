import { ApiAccess } from '../../common/security/api-access.guard';
import { Body, Controller, Post } from '@nestjs/common';

import { FlowEngineService } from './flow-engine.service';
import { ProcessFlowMessageDto } from './dto/process-flow-message.dto';

@ApiAccess('flow')
@Controller('flow-engine')
export class FlowEngineController {
  constructor(private readonly flowEngineService: FlowEngineService) {}

  @Post('process')
  process(
    @Body()
    dto: ProcessFlowMessageDto,
  ) {
    return this.flowEngineService.process(dto);
  }
}
