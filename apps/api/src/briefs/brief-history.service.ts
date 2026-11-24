import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const HISTORY_LIMIT = 30;

@Injectable()
export class BriefHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const item = await this.prisma.briefHistory.upsert({
      where: { userId_text: { userId, text: trimmed } },
      create: { userId, text: trimmed },
      update: {
        useCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
      select: historySelect,
    });

    const excess = await this.prisma.briefHistory.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
      skip: HISTORY_LIMIT,
      select: { id: true },
    });
    if (excess.length) {
      await this.prisma.briefHistory.deleteMany({
        where: { id: { in: excess.map(({ id }) => id) } },
      });
    }

    return item;
  }

  list(userId: string) {
    return this.prisma.briefHistory.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
      take: HISTORY_LIMIT,
      select: historySelect,
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const result = await this.prisma.briefHistory.deleteMany({
      where: { id, userId },
    });
    if (!result.count) throw new NotFoundException(`Brief history ${id} tidak ditemukan.`);
  }
}

const historySelect = {
  id: true,
  text: true,
  useCount: true,
  lastUsedAt: true,
};
