import 'reflect-metadata';
import dns from 'dns';

// Resilient DNS resolution to prevent local ISP DNS hijacking of Supabase Cloudflare Anycast endpoints
if (process.env.NODE_ENV !== 'production') {
  const originalDnsLookup = dns.lookup;
  (dns as any).lookup = (hostname: string, options: any, callback: any) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (hostname && typeof hostname === 'string' && hostname.includes('supabase.co')) {
      if (options && options.all) {
        return callback(null, [{ address: '104.18.38.10', family: 4 }]);
      }
      return callback(null, '104.18.38.10', 4);
    }
    return originalDnsLookup.call(dns, hostname, options, callback);
  };
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HealthcareExceptionFilter } from './infrastructure/filters/healthcare-exception.filter';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Increase payload limits for Base64 file uploads 
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Trust Proxy for Rate Limiting behind load balancers
  app.set('trust proxy', 1);

  // Security Hardening
  app.use(helmet());
  if (process.env.NODE_ENV === 'production') {
    app.enableCors({
      origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : false,
      credentials: true,
    });
  } else {
    app.enableCors();
  }

  // Global Guards & Filters
  app.useGlobalFilters(new HealthcareExceptionFilter());

  // Global Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    errorHttpStatusCode: 422, // Unprocessable Entity
  }));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('DFO Control Tower API')
      .setDescription('API documentation for the Control Tower')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);
  }

  await app.listen(port, '0.0.0.0');
  console.log(`[Janmasethu DFO] Control Tower Core is running on: http://localhost:${port}`);
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});