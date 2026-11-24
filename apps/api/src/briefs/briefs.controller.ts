import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { BriefHistoryService } from './brief-history.service';
import { BriefsService } from './briefs.service';
import { CreateBriefHistoryDto } from './dto/create-brief-history.dto';
import { ExpandBriefDto } from './dto/expand-brief.dto';

@Controller('briefs')
export class BriefsController {
  constructor(
    private readonly briefs: BriefsService,
    private readonly history: BriefHistoryService,
  ) {}

  @Post('expand')
  @HttpCode(200)
  expand(@Body() dto: ExpandBriefDto, @CurrentUser() _user: { id: string }) {
    return this.briefs.expand(dto.brief);
  }

  @Get('history')
  historyList(@CurrentUser() user: { id: string }) {
    return this.history.list(user.id);
  }

  @Post('history')
  @HttpCode(201)
  historyRecord(
    @Body() dto: CreateBriefHistoryDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.history.record(user.id, dto.text);
  }

  @Delete('history/:id')
  @HttpCode(204)
  async historyRemove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.history.remove(id, user.id);
  }
}
