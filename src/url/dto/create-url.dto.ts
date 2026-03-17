import { IsUrl, IsOptional, IsString, IsDateString } from 'class-validator';

export class CreateUrlDto {
  @IsUrl({}, { message: 'original_url must be a valid URL' })
  original_url: string;

  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsDateString({}, { message: 'expires_at must be a valid ISO 8601 date string' })
  expires_at?: string;
}
