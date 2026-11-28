import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { Response } from 'express';
import { USER_ROLES, type UserRole } from '@clipper/shared';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AdminService } from './admin.service';

class UpdateUserRoleDto {
  @IsIn(USER_ROLES)
  role: UserRole;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.getOverview();
  }

  @Get('users')
  users(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listUsers({
      search,
      role,
      page: page ? Number.parseInt(page, 10) : 1,
      limit: limit ? Number.parseInt(limit, 10) : 25,
    });
  }

  @Get('users/export.csv')
  async exportCsv(@Res() res: Response): Promise<void> {
    const csv = await this.admin.exportUsersCsv();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dartclip-users-${date}.csv"`,
    );
    res.send(csv);
  }

  @Patch('users/:id/role')
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.admin.updateUserRole(id, dto.role, actor.id);
  }
}
