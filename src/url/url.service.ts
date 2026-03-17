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
    const shortCode = await this.generateUniqueShortCode();

    const url = this.urlRepository.create({
      short_code: shortCode,
      original_url: dto.original_url,
      user_id: dto.user_id || null,
      expires_at: dto.expires_at ? new Date(dto.expires_at) : null,
    });

    await this.urlRepository.save(url);

    // Cache in Redis
    await this.redisService.set(
      `${REDIS_KEY_PREFIX}${shortCode}`,
      dto.original_url,
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
    // 1. Check Redis cache
    let originalUrl = await this.redisService.get(
      `${REDIS_KEY_PREFIX}${shortCode}`,
    );

    let urlRecord: Url | null = null;

    if (!originalUrl) {
      // 2. Fallback to database
      urlRecord = await this.urlRepository.findOne({
        where: { short_code: shortCode },
      });

      if (!urlRecord) {
        throw new NotFoundException(
          `Short URL with code '${shortCode}' not found`,
        );
      }

      originalUrl = urlRecord.original_url;

      // 3. Cache in Redis
      await this.redisService.set(
        `${REDIS_KEY_PREFIX}${shortCode}`,
        originalUrl,
        REDIS_CACHE_TTL,
      );
    }

    // Check expiration
    if (!urlRecord) {
      urlRecord = await this.urlRepository.findOne({
        where: { short_code: shortCode },
      });
    }

    if (urlRecord?.expires_at && new Date(urlRecord.expires_at) < new Date()) {
      // Remove expired cache
      await this.redisService.del(`${REDIS_KEY_PREFIX}${shortCode}`);
      throw new GoneException('This short URL has expired');
    }

    // 4. Record click event asynchronously
    this.recordClick(shortCode, ipAddress, userAgent).catch((err) =>
      this.logger.error('Failed to record click', err),
    );

    return originalUrl;
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

    const urlsWithClicks = await Promise.all(
      urls.map(async (url) => {
        const clicks = await this.clickRepository.count({
          where: { short_code: url.short_code },
        });
        return {
          short_code: url.short_code,
          original_url: url.original_url,
          clicks,
          created_at: url.created_at,
        };
      }),
    );

    return {
      user_id: userId,
      urls: urlsWithClicks,
    };
  }

  private async generateUniqueShortCode(): Promise<string> {
    for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
      const code = nanoid(SHORT_CODE_LENGTH);
      const existing = await this.urlRepository.findOne({
        where: { short_code: code },
      });
      if (!existing) {
        return code;
      }
      this.logger.warn(
        `Short code collision detected: ${code}, retrying (${attempt + 1}/${MAX_COLLISION_RETRIES})`,
      );
    }
    throw new InternalServerErrorException(
      'Failed to generate unique short code after maximum retries',
    );
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
