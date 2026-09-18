import { NestFactory } from '@nestjs/core';
import { TinyModule } from './tiny-app.module';

async function bootstrap() {
    console.log('Tiny Bootstrapping...');
    try {
        const app = await NestFactory.create(TinyModule);
        console.log('Tiny app instance created.');
        await app.listen(3003);
        console.log('Tiny app is running on: http://localhost:3003');
        await app.close();
        process.exit(0);
    } catch (error) {
        console.error('Tiny bootstrap failed:', error);
        process.exit(1);
    }
}
bootstrap();
