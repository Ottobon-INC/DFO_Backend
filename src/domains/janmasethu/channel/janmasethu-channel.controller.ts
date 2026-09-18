import { Controller, Post, Body } from '@nestjs/common';
import { JanmasethuChannelService } from './janmasethu-channel.service';

@Controller('janmasethu/channel')
export class JanmasethuChannelController {
    constructor(private readonly channelService: JanmasethuChannelService) { }

    @Post('whatsapp')
    async handleWhatsApp(@Body() body: { user_id: string; message: string }) {
        return this.channelService.handleIncomingMessage('whatsapp', body.user_id, body.message);
    }

    @Post('web')
    async handleWeb(@Body() body: { user_id: string; message: string }) {
        return this.channelService.handleIncomingMessage('web', body.user_id, body.message);
    }
}
