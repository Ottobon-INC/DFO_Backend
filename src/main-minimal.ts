import { NestFactory } from '@nestjs/core';
import { MinimalModule } from './minimal-app.module';

async function bootstrap() {
    console.log('Minimal Bootstrapping...');
    try {
        const app = await NestFactory.create(MinimalModule);
        console.log('Minimal app instance created.');
        await app.listen(3001);
        console.log('Minimal app is running on: http://localhost:3001');
        await app.close();
        console.log('Minimal app closed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Minimal bootstrap failed:', error);
        process.exit(1);
    }
}
bootstrap();
