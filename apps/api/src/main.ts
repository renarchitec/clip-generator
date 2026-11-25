import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AddressInfo } from 'node:net';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const config = app.get(AppConfig);

  if (config.isDesktop) {
    // Renderer desktop bisa memuat dari file:// atau http://127.0.0.1:<port>.
    app.enableCors({
      origin: true,
      credentials: true,
    });
  } else {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Clipper API')
      .setDescription('Clipper video processing and job API')
      .setVersion('1.0')
      .addCookieAuth('clipper_session')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
  const server = app.getHttpServer();
  const address = server.address() as AddressInfo | string | null;
  const boundPort = typeof address === 'object' && address ? address.port : config.port;

  // Sinyal terstruktur untuk host desktop (Electron) saat PORT=0 (port acak).
  if (config.isDesktop) {
    process.stdout.write(
      `${JSON.stringify({ event: 'ready', host: config.host, port: boundPort })}\n`,
    );
  }

  new Logger('Bootstrap').log(`API jalan di ${config.host}:${boundPort} (mode=${config.mode})`);
}

void bootstrap();
