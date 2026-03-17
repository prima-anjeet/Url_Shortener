import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisService } from '../redis/redis.service.js';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  async check() {
    const db = this.dataSource.isInitialized ? 'connected' : 'disconnected';
    const redis = await this.redisService
      .ping()
      .then(() => 'connected')
      .catch(() => 'disconnected');

    return { status: 'ok', db, redis };
  }
}
