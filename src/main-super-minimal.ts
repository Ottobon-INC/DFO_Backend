import { NestFactory } from '@nestjs/core';
import { SuperMinimalModule } from './super-minimal-app.module';

async function bootstrap() {
    console.log('Super Minimal Bootstrapping...');
    try {
        const app = await NestFactory.create(SuperMinimalModule);
        console.log('Super Minimal app instance created.');
        await app.listen(3002);
        console.log('Super Minimal app is running on: http://localhost:3002');
        await app.close();
        process.exit(0);
    } catch (error) {
        console.error('Super Minimal bootstrap failed:', error);
        process.exit(1);
    }
}
bootstrap();
