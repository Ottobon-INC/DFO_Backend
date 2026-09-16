import { IsEnum, IsUUID, IsString, IsNotEmpty, IsOptional, IsDateString, IsInt, Min, Max, IsEmail, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { JourneyStage, AppointmentStatus } from '../dfo.types';

export class SyncPatientDto {
    @IsUUID()
    @IsOptional()
    id?: string;

    @IsString()
    @IsNotEmpty()
    full_name: string;

    @IsString()
    @IsNotEmpty()
    phone_number: string;

    @IsEmail()
    @IsOptional()
    email?: string;

    @IsEnum(JourneyStage)
    journey_stage: JourneyStage;

    @IsInt()
    @Min(0)
    @Max(40)
    @IsOptional()
    pregnancy_stage?: number;
}

export class UpdateJourneyDto {
    @IsEnum(JourneyStage)
    stage: JourneyStage;

    @IsInt()
    @Min(0)
    @Max(42)
    @IsOptional()
    pregnancy_stage?: number;
}

export class BookAppointmentDto {
    @IsUUID()
    patient_id: string;

    @IsUUID()
    doctor_id: string;

    @IsDateString()
    appointment_date: string;

    @IsString()
    @IsOptional()
    notes?: string;
}

export class StartConsultationDto {
    @IsUUID()
    threadId: string;
}

export class CloseConsultationDto {
    @IsUUID()
    id: string;

    @IsString()
    @IsNotEmpty()
    notes: string;
}

export class MedicationItemDto {
    @IsString()
    @IsNotEmpty()
    medication_name: string;

    @IsString()
    dosage: string;

    @IsInt()
    frequency: number;

    @IsString()
    quantity: string;

    @IsInt()
    duration_days: number;

    @IsString()
    @IsOptional()
    special_instructions?: string;
}

export class AddPrescriptionDto {
    @IsUUID()
    @IsOptional()
    consultation_id?: string;

    @IsUUID()
    patient_id: string;

    @IsString()
    @IsOptional()
    clinical_notes?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MedicationItemDto)
    medications: MedicationItemDto[];
}

export class UploadReportDto {
    @IsUUID()
    patient_id: string;

    @IsString()
    @IsNotEmpty()
    report_type: string; // e.g. Ultrasound, Blood Test, MRI

    @IsString()
    @IsOptional()
    clinical_notes?: string;

    @IsString()
    @IsOptional()
    ordered_by_doctor?: string;
}
