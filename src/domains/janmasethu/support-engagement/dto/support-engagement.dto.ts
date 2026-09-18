import { IsUUID, IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export class CreateSupportTicketDto {
    @IsUUID()
    @IsOptional()
    thread_id?: string;

    @IsUUID()
    @IsOptional()
    patient_id?: string;

    @IsString()
    @IsOptional()
    patient_phone?: string;

    @IsString()
    @IsOptional()
    patient_name?: string;

    @IsString()
    @IsNotEmpty()
    category: string;

    @IsString()
    @IsOptional()
    priority?: string;

    @IsString()
    @IsOptional()
    source?: string;
}

export class AssignSupportOwnerDto {
    @IsUUID()
    @IsNotEmpty()
    userId: string;
}

export class EscalateSupportDto {
    @IsString()
    @IsNotEmpty()
    reason: string;
}

export class UpdateTicketStatusDto {
    @IsString()
    @IsOptional()
    status?: string;

    @IsString()
    @IsOptional()
    priority?: string;
}

export class SendSupportMessageDto {
    @IsString()
    @IsNotEmpty()
    content: string;

    @IsString()
    @IsOptional()
    senderType?: 'USER' | 'HUMAN' | 'AI';
}
