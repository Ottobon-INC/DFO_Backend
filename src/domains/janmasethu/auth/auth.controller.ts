import { Controller, Post, Body, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
    private readonly logger = new Logger(AuthController.name);

    constructor(private readonly authService: AuthService) { }

    @Post('login')
    async login(@Body() body: { email: string; password: string; domain?: string }) {
        if (!body.email || !body.password) {
            throw new UnauthorizedException('Email and password are required.');
        }
        const result = await this.authService.login(body.email, body.password, body.domain || 'janmasethu');
        this.logger.log(`Login successful for: ${body.email}`);
        return result;
    }

    @Post('refresh')
    async refresh(@Body() body: { refresh_token: string }) {
        if (!body.refresh_token) {
            throw new UnauthorizedException('Refresh token is required.');
        }
        return this.authService.refreshToken(body.refresh_token);
    }
}
