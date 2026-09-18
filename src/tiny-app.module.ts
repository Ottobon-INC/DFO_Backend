import { Module } from '@nestjs/common';
import { TinyController } from './tiny-controller';

@Module({
    controllers: [TinyController],
})
export class TinyModule { }
