import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, UseGuards, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RoomAllocationService } from '../services/room-allocation.service';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../../../infrastructure/security/roles.decorator';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { DFO_EVENTS } from '../../../infrastructure/events/event-constants';
import { AdmissionEvent } from '../../../infrastructure/events/event-payloads';
import { 
    CreateRoomCategoryDto, UpdateRoomCategoryDto, 
    CreateRoomDto, UpdateRoomDto, 
    CreateBedDto, UpdateBedStatusDto, 
    CreateAdmissionDto, TransferBedDto 
} from '../dto/room-allocation.dto';
import { ClinicsUtilsService } from '../services/clinics-utils.service';

@Controller('api/v1/clinics')
@UseGuards(ClinicsAuthGuard, RolesGuard)
export class RoomAllocationController {
    private readonly logger = new Logger(RoomAllocationController.name);

    constructor(
        private readonly roomAllocationService: RoomAllocationService,
        private readonly utils: ClinicsUtilsService,
        @InjectQueue('dfo_events_queue') private readonly eventsQueue: Queue,
    ) {}

    // --- Room Categories ---
    @Get('room-categories')
    async getCategories() {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.getCategories(clinic_id);
        return { success: true, data };
    }

    @Post('room-categories')
    @Roles('Admin', 'Superadmin')
    async createCategory(@Body() body: CreateRoomCategoryDto) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.createCategory(clinic_id, body);
        return { success: true, data };
    }

    @Patch('room-categories/:id')
    @Roles('Admin', 'Superadmin')
    async updateCategory(@Param('id') id: string, @Body() body: UpdateRoomCategoryDto) {
        if (!this.utils.isUuid(id)) throw new HttpException('Invalid ID', HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.updateCategory(clinic_id, id, body);
        return { success: true, data };
    }

    @Delete('room-categories/:id')
    @Roles('Admin', 'Superadmin')
    async deleteCategory(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) throw new HttpException('Invalid ID', HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.deleteCategory(clinic_id, id);
        return data;
    }

    // --- Rooms ---
    @Get('rooms')
    async getRooms() {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.getRooms(clinic_id);
        return { success: true, data };
    }

    @Get('rooms/available')
    async getAvailableRooms(@Query('tier') tier?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.getAvailableRooms(clinic_id, tier);
        return { success: true, data };
    }

    @Post('rooms')
    @Roles('Admin', 'Superadmin')
    async createRoom(@Body() body: CreateRoomDto) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.createRoom(clinic_id, body);
        return { success: true, data };
    }

    @Patch('rooms/:id')
    @Roles('Admin', 'Superadmin')
    async updateRoom(@Param('id') id: string, @Body() body: UpdateRoomDto) {
        if (!this.utils.isUuid(id)) throw new HttpException('Invalid ID', HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.updateRoom(clinic_id, id, body);
        return { success: true, data };
    }

    @Delete('rooms/:id')
    @Roles('Admin', 'Superadmin')
    async deleteRoom(@Param('id') id: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.deleteRoom(clinic_id, id);
        return data;
    }

    // --- Beds ---
    @Get('beds')
    async getBeds(@Query('status') status?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.getBeds(clinic_id, status);
        return { success: true, data };
    }

    @Post('rooms/:roomId/beds')
    @Roles('Admin', 'Superadmin')
    async createBed(@Param('roomId') roomId: string, @Body() body: CreateBedDto) {
        if (!this.utils.isUuid(roomId)) throw new HttpException('Invalid ID', HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.createBed(clinic_id, roomId, body);
        return { success: true, data };
    }

    @Put('beds/:id')
    @Roles('Admin', 'Superadmin')
    async updateBed(@Param('id') id: string, @Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.updateBed(clinic_id, id, body);
        return { success: true, data };
    }

    @Patch('beds/:id/status')
    @Roles('Admin', 'Superadmin', 'Nurse', 'Doctor')
    async updateBedStatus(@Param('id') id: string, @Body() body: UpdateBedStatusDto) {
        if (!this.utils.isUuid(id)) throw new HttpException('Invalid ID', HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.updateBedStatus(clinic_id, id, body.status);
        return { success: true, data };
    }

    @Delete('beds/:id')
    @Roles('Admin', 'Superadmin')
    async deleteBed(@Param('id') id: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.deleteBed(clinic_id, id);
        return data;
    }

    // --- Admissions ---
    @Get('admissions')
    async getAdmissions(@Query('status') status?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.getAdmissions(clinic_id, status);
        return { success: true, data };
    }

    @Post('admissions')
    @Roles('Admin', 'Doctor', 'Nurse', 'Receptionist')
    async createAdmission(@Body() body: CreateAdmissionDto) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.createAdmission(clinic_id, body);
        
        const actor_id = TenantContext.getUserId();
        await this.eventsQueue.add(DFO_EVENTS.ADMISSION_CREATED, new AdmissionEvent(
            clinic_id, actor_id, data.admission.id, { action: 'create_admission', bed_id: body.bed_id }
        ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

        // TODO: INTERNAL EVENT HOOK - Dispatch automated check-in/welcome message to the patient's registered phone number via WhatsApp/SMS
        this.logger.log(`[SMS Dispatch Simulation] Sent check-in message for Admission ID ${data.admission.id}`);

        return { success: true, data };
    }

    @Post('admissions/:id/discharge')
    @Patch('admissions/:id/discharge')
    @Roles('Admin', 'Doctor', 'Nurse', 'Receptionist')
    async dischargeAdmission(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) throw new HttpException('Invalid ID', HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.dischargeAdmission(clinic_id, id);
        
        const actor_id = TenantContext.getUserId();
        await this.eventsQueue.add(DFO_EVENTS.ADMISSION_DISCHARGED, new AdmissionEvent(
            clinic_id, actor_id, id, { action: 'discharge_admission' }
        ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

        // TODO: INTERNAL EVENT HOOK - Dispatch automated checkout message to the patient's registered phone number via WhatsApp/SMS
        this.logger.log(`[SMS Dispatch Simulation] Sent checkout message for Admission ID ${id}`);

        return data;
    }

    @Post('admissions/:id/cancel')
    @Roles('Admin', 'Superadmin', 'Receptionist')
    async cancelAdmission(@Param('id') id: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.cancelAdmission(clinic_id, id);

        const actor_id = TenantContext.getUserId();
        await this.eventsQueue.add(DFO_EVENTS.ADMISSION_CANCELLED, new AdmissionEvent(
            clinic_id, actor_id, id, { action: 'cancel_admission' }
        ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

        this.logger.log(`[Audit Simulation] Admission ${id} cancelled by actor ${actor_id}`);

        return data;
    }

    @Post('admissions/:id/transfer')
    @Roles('Admin', 'Doctor', 'Nurse', 'Receptionist')
    async transferBed(@Param('id') id: string, @Body() body: TransferBedDto) {
        if (!this.utils.isUuid(id)) throw new HttpException('Invalid ID', HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.transferBed(clinic_id, id, body);
        
        const actor_id = TenantContext.getUserId();
        await this.eventsQueue.add(DFO_EVENTS.BED_TRANSFERRED, new AdmissionEvent(
            clinic_id, actor_id, id, { action: 'transfer_bed', new_bed_id: body.new_bed_id }
        ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

        return data;
    }

    // --- Dashboard ---
    @Get('room-dashboard/summary')
    async getRoomDashboardSummary() {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        const data = await this.roomAllocationService.getDashboardSummary(clinic_id);
        return { success: true, data };
    }
}
