import { IsString, IsNumber, IsOptional, IsBoolean, IsIn, IsUUID } from 'class-validator';

export class CreateRoomCategoryDto {
    @IsString()
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsNumber()
    daily_rate: number;
}

export class UpdateRoomCategoryDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsNumber()
    @IsOptional()
    daily_rate?: number;

    @IsBoolean()
    @IsOptional()
    is_active?: boolean;
}

export class CreateRoomDto {
    @IsUUID()
    category_id: string;

    @IsString()
    room_number: string;

    @IsString()
    @IsOptional()
    floor?: string;

    @IsNumber()
    capacity: number;
}

export class UpdateRoomDto {
    @IsUUID()
    @IsOptional()
    category_id?: string;

    @IsString()
    @IsOptional()
    room_number?: string;

    @IsString()
    @IsOptional()
    floor?: string;

    @IsNumber()
    @IsOptional()
    capacity?: number;

    @IsBoolean()
    @IsOptional()
    is_active?: boolean;
}

export class CreateBedDto {
    @IsString()
    bed_identifier: string;
}

export class UpdateBedStatusDto {
    @IsString()
    @IsIn(['available', 'occupied', 'maintenance', 'reserved'])
    status: string;
}

export class CreateAdmissionDto {
    @IsUUID()
    patient_id: string;

    @IsUUID()
    bed_id: string;

    @IsUUID()
    @IsOptional()
    admitting_doctor_id?: string;

    @IsString()
    @IsOptional()
    diagnosis?: string;

    @IsString()
    @IsOptional()
    notes?: string;
}

export class TransferBedDto {
    @IsUUID()
    new_bed_id: string;

    @IsString()
    @IsOptional()
    reason?: string;
}
