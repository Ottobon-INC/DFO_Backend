import { Controller, Get } from '@nestjs/common';

@Controller('test')
export class TinyController {
    @Get()
    get() { return 'ok'; }
}
