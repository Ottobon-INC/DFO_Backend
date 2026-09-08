import { IsString, IsEmail, IsNotEmpty, IsIn, IsUUID, IsOptional } from 'class-validator';

export class CreateClinicDto {
  @IsUUID()
  @IsOptional()
  request_id?: string;

  @IsString()
  @IsNotEmpty()
  clinic_name: string;

  @IsString()
  @IsNotEmpty()
  owner_name: string;

  @IsEmail()
  @IsNotEmpty()
  owner_email: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['Doctor', 'CRO', 'Receptionist', 'Nurse'])
  owner_role: string;

  @IsString()
  @IsOptional()
  specialty?: string;
}
