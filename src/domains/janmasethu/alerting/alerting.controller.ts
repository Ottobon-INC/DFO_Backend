import { Controller, Post, Body, InternalServerErrorException } from '@nestjs/common';
import { AlertingService } from './alerting.service';
import { AlertTriggerRequest, AlertTriggerRequestSchema } from './alerting.schema';

@Controller('trigger-alert')
export class AlertingController {
  constructor(private readonly alertingService: AlertingService) {}

  @Post()
  async triggerAlert(@Body() body: any): Promise<{ triggered: boolean, trace_id?: string }> {
    try {
      // Validate incoming data
      const request: AlertTriggerRequest = AlertTriggerRequestSchema.parse(body);

      // Process and dispatch
      return await this.alertingService.processClinicalData(request);
      
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to process alert trigger',
        error instanceof Error ? error.message : undefined
      );
    }
  }
}
