const fs = require('fs');
const path = 'e:/Medcy Health tech/DFO_Frontend/components/Dashboard.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace imports
content = content.replace(
  import { RescheduleModal, Toast, CheckInModal, AddLeadModal } from './Modals';\nimport { BookAppointmentModal } from './AppointmentModals';,
  import { RescheduleModal, Toast, CheckInModal, AddLeadModal } from './Modals';\nimport { BookAppointmentModal } from './AppointmentModals';\nimport { ClinicRegistrationForm } from './ClinicRegistrationForm';
);

// Replace Walk-in Express Modal rendering
const oldBlock = {isWalkInExpressOpen && (
        <BookAppointmentModal
          isOpen={isWalkInExpressOpen}
          onClose={() => {
            setIsWalkInExpressOpen(false);
            setWalkInInitialData(undefined);
          }}
          initialData={walkInInitialData}
          initialTab={walkInInitialData ? 'existing' : 'new'}
          onConfirm={async (formData) => {
            try {
              const now = new Date();
              const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
              
              const qmsPayload = {
                doctor_id: formData.consultant,
                date: now.toISOString().split('T')[0],
                time: currentTime,
                mobile: formData.phone,
                name: formData.name,
                patient_id: formData.patientId || null,
                type: formData.speciality || 'Consultation',
                visit_reason: formData.visitReason || 'Walk-In Consultation',
                patient_email_snapshot: formData.email,
                patient_age_snapshot: formData.age,
                sex_snapshot: formData.sex,
                patient_marital_status_snapshot: formData.maritalStatus,
                patient_address_snapshot: formData.address,
                source: 'Walk-In'
              };

              const qmsRes = await api.qmsWalkIn(qmsPayload);
              setIsWalkInExpressOpen(false);
              setWalkInInitialData(undefined);
              setRefreshTrigger(prev => prev + 1);
              
              const pin = qmsRes?.data?.patient?.pin || qmsRes?.patient?.pin || null;
              if (pin) {
                 toast.success(\Walk-In Checked-in successfully. Patient PIN: \\, { duration: 8000 });
              } else {
                 toast.success("Walk-In Registered & Checked-in successfully");
              }
            } catch (err: any) {
              console.error("Registration failed:", err);
              // Global error toast from api.ts will handle displaying the error
            }
          }}
        />
      )};

const newBlock = {isWalkInExpressOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <ClinicRegistrationForm 
            initialData={walkInInitialData}
            onCancel={() => {
              setIsWalkInExpressOpen(false);
              setWalkInInitialData(undefined);
            }}
            onSuccess={(patientId, appointmentId) => {
              setIsWalkInExpressOpen(false);
              setWalkInInitialData(undefined);
              setRefreshTrigger(prev => prev + 1);
              toast.success("Walk-In Registered & Checked-in successfully");
            }}
          />
        </div>
      )};

content = content.replace(oldBlock, newBlock);

fs.writeFileSync(path, content, 'utf8');
console.log('Reverted successfully');
