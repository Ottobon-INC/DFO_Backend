import { Injectable, Logger } from '@nestjs/common';
import { VitalsRepository } from './vitals.repository';
import { AddVitalRequest, VitalRecord, VitalAnalysisResult, BulkAddVitalRequest } from './vitals.schema';
import { AlertingService } from '../alerting/alerting.service';
import { AuditService } from '../../../infrastructure/audit/audit.service';

@Injectable()
export class VitalsService {
  private readonly logger = new Logger(VitalsService.name);

  constructor(
    private readonly repository: VitalsRepository,
    private readonly alertingService: AlertingService,
    private readonly audit: AuditService
  ) { }

  async processAndSaveVital(request: AddVitalRequest): Promise<VitalAnalysisResult> {
    // 1. Save vital directly
    const savedRecord = await this.repository.saveVital(request);

    // 2. Fetch recent history for trend analysis
    // We fetch up to 3 for trend, plus the one we just saved
    const history = await this.repository.getVitalsHistory(request.patient_id, request.vital_type, 3);

    // 3. Analyze against rules engine
    const analysis = this.analyzeThresholdsAndTrends(request, history);

    // 4. Trigger alert if necessary
    if (analysis.status === 'high_risk') {
      this.logger.warn(`High Risk Vital Detected for ${request.patient_id}: ${analysis.reason}`);

      // Dispatch immediately to the Alerting system
      await this.alertingService.processClinicalData({
        patient_id: request.patient_id,
        urgency_level: 'critical',
        risk_flags: [analysis.reason, `Abnormal ${request.vital_type}`],
        symptoms: [],
        timestamp: new Date().toISOString()
      });
    }

    // 5. Audit log
    this.audit.log(
      'system',
      'CREATE',
      'PATIENT',
      request.patient_id,
      `Vital ${request.vital_type} recorded: ${analysis.status} (${analysis.reason})`
    );

    return analysis;
  }

  async processAndSaveVitalsBulk(request: BulkAddVitalRequest): Promise<VitalAnalysisResult[]> {
    const savedRecords = await this.repository.saveVitalsBulk(request.vitals);
    
    const results: VitalAnalysisResult[] = [];
    for (const data of request.vitals) {
        const history = await this.repository.getVitalsHistory(data.patient_id, data.vital_type, 3);
        const analysis = this.analyzeThresholdsAndTrends(data, history);
        
        if (analysis.status === 'high_risk') {
          this.logger.warn(`High Risk Vital Detected for ${data.patient_id}: ${analysis.reason}`);
          await this.alertingService.processClinicalData({
            patient_id: data.patient_id,
            urgency_level: 'critical',
            risk_flags: [analysis.reason, `Abnormal ${data.vital_type}`],
            symptoms: [],
            timestamp: new Date().toISOString()
          });
        }
        
        this.audit.log('system', 'CREATE', 'PATIENT', data.patient_id, `Vital ${data.vital_type} recorded: ${analysis.status} (${analysis.reason})`);
        results.push(analysis);
    }
    
    return results;
  }

  async getPatientVitals(patientId: string): Promise<VitalRecord[]> {
    return this.repository.getVitalsHistory(patientId);
  }

  private analyzeThresholdsAndTrends(record: AddVitalRequest, history: VitalRecord[]): VitalAnalysisResult {
    const type = record.vital_type;
    const valueStr = String(record.value);

    // -- Threshold Logic --
    if (type === 'blood_pressure') {
      const [systolic, diastolic] = valueStr.split('/').map(Number);
      if (systolic > 140 || diastolic > 90) return { status: 'high_risk', reason: `High Blood Pressure: ${valueStr}` };
      if (systolic < 90 || diastolic < 60) return { status: 'warning', reason: `Low Blood Pressure: ${valueStr}` };
    }
    else if (type === 'temperature') {
      const temp = Number(valueStr);
      if (temp > 38.0) return { status: 'high_risk', reason: `Fever Detected: ${temp}°C` };
      if (temp < 36.0) return { status: 'warning', reason: `Low Temperature: ${temp}°C` };
    }
    else if (type === 'heart_rate') {
      const hr = Number(valueStr);
      if (hr > 120) return { status: 'high_risk', reason: `Tachycardia: ${hr} bpm` };
      if (hr < 50) return { status: 'warning', reason: `Bradycardia: ${hr} bpm` };
    }

    // -- Trend Logic (Increasing over last 3 records) --
    // History includes the newly saved record at history[0] (because of DESC order)
    if (history.length >= 3 && ['blood_pressure', 'weight', 'heart_rate'].includes(type)) {
      if (type === 'blood_pressure') {
        const sys = history.map(h => Number(h.value.split('/')[0]));
        // sys[0] is newest, sys[2] is oldest
        if (sys[0] > sys[1] && sys[1] > sys[2]) {
          return { status: 'warning', reason: `Consecutive increase in Systolic Blood Pressure detected over last 3 readings.` };
        }
      } else {
        const vals = history.map(h => Number(h.value));
        if (vals[0] > vals[1] && vals[1] > vals[2]) {
          return { status: 'warning', reason: `Consecutive increase in ${type} detected over last 3 readings.` };
        }
      }
    }

    return { status: 'normal', reason: `Vital within safe ranges.` };
  }
}
