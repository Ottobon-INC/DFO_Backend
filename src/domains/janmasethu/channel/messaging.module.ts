import { Module, Global } from '@nestjs/common';
import { JanmasethuDispatchService } from './janmasethu-dispatch.service';

@Global()
@Module({
    providers: [JanmasethuDispatchService],
    exports: [JanmasethuDispatchService],
})
export class MessagingModule { }
