import { Global, Injectable, Module } from '@nestjs/common';
import { StoreSetting } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class SettingsService {
  private cache: { value: StoreSetting; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<StoreSetting> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.value;
    const value = await this.prisma.storeSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate() {
    this.cache = null;
  }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
