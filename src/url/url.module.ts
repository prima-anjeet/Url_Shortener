import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Url } from '../entities/url.entity.js';
import { Click } from '../entities/click.entity.js';
import { UrlController } from './url.controller.js';
import { UrlService } from './url.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Url, Click])],
  controllers: [UrlController],
  providers: [UrlService],
})
export class UrlModule {}
