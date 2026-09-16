import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { JanmasethuOnlyModule } from './janmasethu-only.module';

async function bootstrap() {
    const logger = new Logger('JanmasethuBootstrap');
    const app = await NestFactory.create(JanmasethuOnlyModule);

    if (process.env.NODE_ENV === 'production') {
        app.enableCors({
            origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : false,
            credentials: true,
        });
    } else {
        app.enableCors();
    }
    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        transform: true,
    }));

    const port = process.env.PORT || 3005;
    await app.listen(port);
    logger.log(`Janmasethu DFO Backend is running on: http://localhost:${port}`);
}

bootstrap().catch(err => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
});
