import {
  Injectable,
  NotFoundException,
  GoneException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { nanoid } from 'nanoid';
import { Url } from '../entities/url.entity.js';
import { Click } from '../entities/click.entity.js';
import { RedisService } from '../redis/redis.service.js';
import { CreateUrlDto } from './dto/create-url.dto.js';

const SHORT_CODE_LENGTH = 7;
const MAX_COLLISION_RETRIES = 5;
const REDIS_CACHE_TTL = 3600; // 1 hour
const REDIS_KEY_PREFIX = 'short_url:';

interface CachedUrlEntry {
  original_url: string;
  expires_at: string | null; // ISO string or null
}

@Injectable()
export class UrlService {
  private readonly logger = new Logger(UrlService.name);

  constructor(
    @InjectRepository(Url)
    private readonly urlRepository: Repository<Url>,
    @InjectRepository(Click)
    private readonly clickRepository: Repository<Click>,
    private readonly redisService: RedisService,
  ) {}

  async createShortUrl(
    dto: CreateUrlDto,
    baseUrl: string,
  ): Promise<{ short_url: string; original_url: string }> {
    let shortCode: string | null = null;

    for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
      const candidate = nanoid(SHORT_CODE_LENGTH);

      const url = this.urlRepository.create({
        short_code: candidate,
        original_url: dto.original_url,
        user_id: dto.user_id || null,
        expires_at: dto.expires_at ? new Date(dto.expires_at) : null,
      });

      try {
        await this.urlRepository.save(url);
        shortCode = candidate;
        break;
      } catch (err: unknown) {
        // PostgreSQL unique_violation = error code 23505
        const isUniqueViolation =
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === '23505';

        if (!isUniqueViolation) throw err;

        this.logger.warn(
          `Short code collision on INSERT: ${candidate}, retrying (${attempt + 1}/${MAX_COLLISION_RETRIES})`,
        );
      }
    }

    if (!shortCode) {
      throw new InternalServerErrorException(
        'Failed to generate unique short code after maximum retries',
      );
    }

    // Cache full entry so redirect path never needs a DB fallback for expiry
    const entry: CachedUrlEntry = {
      original_url: dto.original_url,
      expires_at: dto.expires_at ?? null,
    };
    await this.redisService.set(
      `${REDIS_KEY_PREFIX}${shortCode}`,
      JSON.stringify(entry),
      REDIS_CACHE_TTL,
    );

    return {
      short_url: `${baseUrl}/${shortCode}`,
      original_url: dto.original_url,
    };
  }

  async resolveAndRedirect(
    shortCode: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<string> {
    const cacheKey = `${REDIS_KEY_PREFIX}${shortCode}`;

    // 1. Check Redis cache — entry holds both url and expiry so no DB query needed
    const cached = await this.redisService.get(cacheKey);

    if (cached) {
      const entry: CachedUrlEntry = JSON.parse(cached);

      if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
        await this.redisService.del(cacheKey);
        throw new GoneException('This short URL has expired');
      }

      this.recordClick(shortCode, ipAddress, userAgent).catch((err) =>
        this.logger.error('Failed to record click', err),
      );

      return entry.original_url;
    }

    // 2. Cache miss — fetch from database
    const urlRecord = await this.urlRepository.findOne({
      where: { short_code: shortCode },
    });

    if (!urlRecord) {
      throw new NotFoundException(
        `Short URL with code '${shortCode}' not found`,
      );
    }

    if (urlRecord.expires_at && new Date(urlRecord.expires_at) < new Date()) {
      throw new GoneException('This short URL has expired');
    }

    // 3. Populate cache for subsequent requests
    const entry: CachedUrlEntry = {
      original_url: urlRecord.original_url,
      expires_at: urlRecord.expires_at ? urlRecord.expires_at.toISOString() : null,
    };
    await this.redisService.set(cacheKey, JSON.stringify(entry), REDIS_CACHE_TTL);

    // 4. Record click event asynchronously
    this.recordClick(shortCode, ipAddress, userAgent).catch((err) =>
      this.logger.error('Failed to record click', err),
    );

    return urlRecord.original_url;
  }

  async getAnalytics(shortCode: string): Promise<{
    short_code: string;
    original_url: string;
    total_clicks: number;
    unique_visitors: number;
  }> {
    const urlRecord = await this.urlRepository.findOne({
      where: { short_code: shortCode },
    });

    if (!urlRecord) {
      throw new NotFoundException(
        `Short URL with code '${shortCode}' not found`,
      );
    }

    const totalClicks = await this.clickRepository.count({
      where: { short_code: shortCode },
    });

    const uniqueVisitors = await this.clickRepository
      .createQueryBuilder('click')
      .select('COUNT(DISTINCT click.ip_address)', 'count')
      .where('click.short_code = :shortCode', { shortCode })
      .getRawOne();

    return {
      short_code: shortCode,
      original_url: urlRecord.original_url,
      total_clicks: totalClicks,
      unique_visitors: parseInt(uniqueVisitors?.count || '0', 10),
    };
  }

  async getUserUrls(
    userId: string,
  ): Promise<{
    user_id: string;
    urls: Array<{
      short_code: string;
      original_url: string;
      clicks: number;
      created_at: Date;
    }>;
  }> {
    const urls = await this.urlRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });

    if (urls.length === 0) {
      return { user_id: userId, urls: [] };
    }

    // Single GROUP BY query instead of N+1 count queries
    const shortCodes = urls.map((u) => u.short_code);
    const clickCounts: Array<{ short_code: string; count: string }> =
      await this.clickRepository
        .createQueryBuilder('click')
        .select('click.short_code', 'short_code')
        .addSelect('COUNT(*)', 'count')
        .where('click.short_code IN (:...shortCodes)', { shortCodes })
        .groupBy('click.short_code')
        .getRawMany();

    const clickMap = new Map(
      clickCounts.map((r) => [r.short_code, parseInt(r.count, 10)]),
    );

    return {
      user_id: userId,
      urls: urls.map((url) => ({
        short_code: url.short_code,
        original_url: url.original_url,
        clicks: clickMap.get(url.short_code) ?? 0,
        created_at: url.created_at,
      })),
    };
  }

  private async recordClick(
    shortCode: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    const click = this.clickRepository.create({
      short_code: shortCode,
      ip_address: ipAddress || '0.0.0.0',
      user_agent: userAgent || null,
    });
    await this.clickRepository.save(click);
  }
}
