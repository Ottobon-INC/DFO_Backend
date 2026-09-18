import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ClinicalIntelligenceService } from './clinical-intelligence.service';
import { ClinicalInsight } from './clinical-intelligence.schema';

@Controller('analyze-conversation')
export class ClinicalIntelligenceController {
  constructor(private readonly clinicalIntelligenceService: ClinicalIntelligenceService) {}

  @Post()
  async analyzeConversation(
    @Body('conversation') conversation: string,
    @Request() req: any
  ): Promise<ClinicalInsight> {
    const userId = req.user?.id || 'anonymous';
    return await this.clinicalIntelligenceService.analyzeConversation(conversation, userId);
  }
}
