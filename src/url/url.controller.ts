import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { UrlService } from './url.service.js';
import { CreateUrlDto } from './dto/create-url.dto.js';

@Controller()
export class UrlController {
  constructor(
    private readonly urlService: UrlService,
    private readonly configService: ConfigService,
  ) {}

  @Post('shorten')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  async createShortUrl(
    @Body() createUrlDto: CreateUrlDto,
    @Req() req: Request,
  ) {
    const baseUrl = this.configService.get<string>('BASE_URL') || `${req.protocol}://${req.get('host')}`;
    return this.urlService.createShortUrl(createUrlDto, baseUrl);
  }

  @Get('analytics/:short_code')
  async getAnalytics(@Param('short_code') shortCode: string) {
    return this.urlService.getAnalytics(shortCode);
  }

  @Get('urls/:user_id')
  async getUserUrls(@Param('user_id') userId: string) {
    return this.urlService.getUserUrls(userId);
  }

  @Get(':short_code')
  async redirect(
    @Param('short_code') shortCode: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      '0.0.0.0';
    const userAgent = req.headers['user-agent'] || '';

    const originalUrl = await this.urlService.resolveAndRedirect(
      shortCode,
      ip,
      userAgent,
    );

    return res.redirect(HttpStatus.FOUND, originalUrl);
  }
}
