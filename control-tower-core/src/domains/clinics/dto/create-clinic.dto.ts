import { IsString, IsEmail, IsNotEmpty, IsIn } from 'class-validator';

export class CreateClinicDto {
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
}
