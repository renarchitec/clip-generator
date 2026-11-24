import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { BriefsService } from './briefs.service';
import { ExpandBriefDto } from './dto/expand-brief.dto';

@Controller('briefs')
export class BriefsController {
  constructor(private readonly briefs: BriefsService) {}

  @Post('expand')
  @HttpCode(200)
  expand(@Body() dto: ExpandBriefDto, @CurrentUser() _user: { id: string }) {
    return this.briefs.expand(dto.brief);
  }
}
