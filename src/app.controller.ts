import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller()
export class AppController {
  @Get()
  getHello(): any {
    return {
      service: 'Control Tower Core',
      status: 'running',
      timestamp: new Date().toISOString()
    };
  }

  @Get('favicon.ico')
  getFavicon(@Res() res: Response) {
    res.status(204).send(); // No content for favicon to avoid 404 errors in browser
  }

  @Get('docs')
  getDocs(): any {
    return {
      message: 'API Documentation is not yet configured for this service.',
      status: 'unavailable'
    };
  }
}
