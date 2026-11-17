import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableShutdownHooks();

  const config = app.get(AppConfig);
  await app.listen(config.port, '0.0.0.0');

  new Logger('Bootstrap').log(`API jalan di port ${config.port}`);
}

void bootstrap();
