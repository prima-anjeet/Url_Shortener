import { IsUrl, IsOptional, IsString, IsDateString, registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

function IsFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isFutureDate',
      target: (object as { constructor: new (...args: unknown[]) => unknown }).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          return new Date(value) > new Date();
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a future date`;
        },
      },
    });
  };
}

export class CreateUrlDto {
  @IsUrl({}, { message: 'original_url must be a valid URL' })
  original_url: string;

  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsDateString({}, { message: 'expires_at must be a valid ISO 8601 date string' })
  @IsFutureDate()
  expires_at?: string;
}
