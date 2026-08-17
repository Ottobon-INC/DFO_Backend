import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HealthcareExceptionFilter } from './infrastructure/filters/healthcare-exception.filter';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Trust Proxy for Rate Limiting behind load balancers
  app.set('trust proxy', 1);

  // Security Hardening
  app.use(helmet());
  app.enableCors();

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
  
  const config = new DocumentBuilder()
    .setTitle('DFO Control Tower API')
    .setDescription('API documentation for the Control Tower')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(port, '0.0.0.0');
  console.log(`[Janmasethu DFO] Control Tower Core is running on: http://localhost:${port}`);
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});