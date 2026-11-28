import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole as PrismaUserRole } from '@prisma/client';
import type {
  AdminOverviewResponse,
  AdminUserRow,
  AdminUsersResponse,
  UserRole,
} from '@clipper/shared';
import { DemoService } from '../demo/demo.service';
import { PrismaService } from '../prisma/prisma.service';
import { escapeCsvCell } from './admin-helpers';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly demo: DemoService,
  ) {}

  async getOverview(): Promise<AdminOverviewResponse> {
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      users,
      totalJobs,
      totalClips,
      totalPreviews,
      totalDownloads,
      dailyDemoCap,
      demoEvents,
      lockedEvents,
    ] = await Promise.all([
      this.prisma.user.findMany({
        select: {
          id: true,
          role: true,
          authProvider: true,
          signupSource: true,
          utmSource: true,
          contentType: true,
          lastSeenAt: true,
          createdAt: true,
        },
      }),
      this.prisma.job.count(),
      this.prisma.clip.count(),
      this.prisma.userEvent.count({ where: { event: 'preview_created' } }),
      this.prisma.userEvent.count({ where: { event: 'clip_downloaded' } }),
      this.demo.getDailyDemoJobsUsage(),
      this.prisma.userEvent.findMany({
        where: {
          user: { role: 'demo' },
          event: {
            in: [
              'preview_created',
              'job_created',
              'clip_downloaded',
              'locked_feature_clicked',
            ],
          },
        },
        select: { userId: true, event: true },
      }),
      this.prisma.userEvent.findMany({
        where: { event: 'locked_feature_clicked' },
        select: { meta: true },
      }),
    ]);

    let demoUsers = 0;
    let memberUsers = 0;
    let adminUsers = 0;
    let signupsToday = 0;
    let signupsLast7d = 0;
    let googleSignups = 0;
    let emailSignups = 0;
    let activeDemoUsers7d = 0;

    const sourceCounts = new Map<string, number>();
    const contentTypeCounts = new Map<string, number>();

    for (const u of users) {
      if (u.role === 'demo') demoUsers += 1;
      else if (u.role === 'member') memberUsers += 1;
      else if (u.role === 'admin') adminUsers += 1;

      if (u.createdAt >= startOfToday) signupsToday += 1;
      if (u.createdAt >= sevenDaysAgo) signupsLast7d += 1;
      if (u.authProvider === 'google') googleSignups += 1;
      else emailSignups += 1;

      if (
        u.role === 'demo' &&
        ((u.lastSeenAt && u.lastSeenAt >= sevenDaysAgo) ||
          u.createdAt >= sevenDaysAgo)
      ) {
        activeDemoUsers7d += 1;
      }

      if (u.role === 'demo') {
        const src = u.signupSource || u.utmSource || 'direct';
        sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
        const ct = u.contentType || 'unspecified';
        contentTypeCounts.set(ct, (contentTypeCounts.get(ct) ?? 0) + 1);
      }
    }

    const previewedSet = new Set<string>();
    const jobSet = new Set<string>();
    const downloadSet = new Set<string>();
    const lockedSet = new Set<string>();

    for (const ev of demoEvents) {
      if (ev.event === 'preview_created') previewedSet.add(ev.userId);
      else if (ev.event === 'job_created') jobSet.add(ev.userId);
      else if (ev.event === 'clip_downloaded') downloadSet.add(ev.userId);
      else if (ev.event === 'locked_feature_clicked') lockedSet.add(ev.userId);
    }

    const lockedFeatureCounts = new Map<string, number>();
    for (const ev of lockedEvents) {
      const feature =
        ev.meta &&
        typeof ev.meta === 'object' &&
        !Array.isArray(ev.meta) &&
        typeof (ev.meta as Record<string, unknown>).feature === 'string'
          ? String((ev.meta as Record<string, unknown>).feature)
          : 'unknown';
      lockedFeatureCounts.set(
        feature,
        (lockedFeatureCounts.get(feature) ?? 0) + 1,
      );
    }

    return {
      kpis: {
        totalUsers: users.length,
        demoUsers,
        memberUsers,
        adminUsers,
        signupsToday,
        signupsLast7d,
        googleSignups,
        emailSignups,
        activeDemoUsers7d,
        totalPreviews,
        totalJobs,
        totalClips,
        totalDownloads,
      },
      dailyDemoCap,
      funnel: {
        registered: demoUsers,
        previewed: previewedSet.size,
        generatedJob: jobSet.size,
        downloadedClip: downloadSet.size,
        clickedLockedFeature: lockedSet.size,
      },
      sources: [...sourceCounts.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
      contentTypes: [...contentTypeCounts.entries()]
        .map(([contentType, count]) => ({ contentType, count }))
        .sort((a, b) => b.count - a.count),
      lockedFeatures: [...lockedFeatureCounts.entries()]
        .map(([feature, count]) => ({ feature, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async listUsers(params: {
    search?: string;
    role?: string;
    page?: number;
    limit?: number;
  }): Promise<AdminUsersResponse> {
    const page = Math.max(1, Math.trunc(params.page || 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(params.limit || 25)));
    const where: Prisma.UserWhereInput = {};

    const search = params.search?.trim();
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (
      params.role === 'admin' ||
      params.role === 'member' ||
      params.role === 'demo'
    ) {
      where.role = params.role as PrismaUserRole;
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          authProvider: true,
          avatarUrl: true,
          signupSource: true,
          utmSource: true,
          utmCampaign: true,
          contentType: true,
          lastSeenAt: true,
          createdAt: true,
          _count: { select: { jobs: true } },
        },
      }),
    ]);

    const items = await this.hydrateUserRows(users);
    return { items, total, page, limit };
  }

  async updateUserRole(
    targetUserId: string,
    role: UserRole,
    actorUserId: string,
  ): Promise<{ id: string; role: UserRole }> {
    if (targetUserId === actorUserId && role !== 'admin') {
      throw new BadRequestException(
        'Admin tidak dapat menurunkan role akunnya sendiri.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Pengguna tidak ditemukan.');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: role as PrismaUserRole },
      select: { id: true, role: true },
    });
    return { id: updated.id, role: updated.role };
  }

  async exportUsersCsv(): Promise<string> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        authProvider: true,
        avatarUrl: true,
        signupSource: true,
        utmSource: true,
        utmCampaign: true,
        contentType: true,
        lastSeenAt: true,
        createdAt: true,
        _count: { select: { jobs: true } },
      },
    });

    const rows = await this.hydrateUserRows(users);
    const header = [
      'id',
      'email',
      'name',
      'role',
      'authProvider',
      'signupSource',
      'utmSource',
      'utmCampaign',
      'contentType',
      'jobs',
      'clips',
      'previews',
      'downloads',
      'lockedClicks',
      'lastSeenAt',
      'createdAt',
    ].join(',');

    const lines = rows.map((row) =>
      [
        row.id,
        row.email,
        row.name,
        row.role,
        row.authProvider,
        row.signupSource,
        row.utmSource,
        row.utmCampaign,
        row.contentType,
        row.usage.jobs,
        row.usage.clips,
        row.usage.previews,
        row.usage.downloads,
        row.usage.lockedClicks,
        row.lastSeenAt,
        row.createdAt,
      ]
        .map(escapeCsvCell)
        .join(','),
    );

    return `${header}\n${lines.join('\n')}\n`;
  }

  private async hydrateUserRows(
    users: {
      id: string;
      email: string;
      name: string | null;
      role: PrismaUserRole;
      authProvider: string;
      avatarUrl: string | null;
      signupSource: string | null;
      utmSource: string | null;
      utmCampaign: string | null;
      contentType: string | null;
      lastSeenAt: Date | null;
      createdAt: Date;
      _count: { jobs: number };
    }[],
  ): Promise<AdminUserRow[]> {
    if (users.length === 0) return [];
    const userIds = users.map((u) => u.id);

    const [clips, eventGroups] = await Promise.all([
      this.prisma.clip.findMany({
        where: { job: { userId: { in: userIds } } },
        select: { job: { select: { userId: true } } },
      }),
      this.prisma.userEvent.groupBy({
        by: ['userId', 'event'],
        where: {
          userId: { in: userIds },
          event: {
            in: [
              'preview_created',
              'clip_downloaded',
              'locked_feature_clicked',
            ],
          },
        },
        _count: { _all: true },
      }),
    ]);

    const clipsByUser = new Map<string, number>();
    for (const c of clips) {
      const uid = c.job.userId;
      if (!uid) continue;
      clipsByUser.set(uid, (clipsByUser.get(uid) ?? 0) + 1);
    }

    const eventsByUser = new Map<
      string,
      { previews: number; downloads: number; lockedClicks: number }
    >();
    for (const group of eventGroups) {
      const entry = eventsByUser.get(group.userId) ?? {
        previews: 0,
        downloads: 0,
        lockedClicks: 0,
      };
      if (group.event === 'preview_created') entry.previews = group._count._all;
      else if (group.event === 'clip_downloaded')
        entry.downloads = group._count._all;
      else if (group.event === 'locked_feature_clicked')
        entry.lockedClicks = group._count._all;
      eventsByUser.set(group.userId, entry);
    }

    return users.map((u) => {
      const ev = eventsByUser.get(u.id);
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        authProvider: u.authProvider,
        avatarUrl: u.avatarUrl,
        signupSource: u.signupSource,
        utmSource: u.utmSource,
        utmCampaign: u.utmCampaign,
        contentType: u.contentType,
        lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
        usage: {
          jobs: u._count.jobs,
          clips: clipsByUser.get(u.id) ?? 0,
          previews: ev?.previews ?? 0,
          downloads: ev?.downloads ?? 0,
          lockedClicks: ev?.lockedClicks ?? 0,
        },
      };
    });
  }
}
