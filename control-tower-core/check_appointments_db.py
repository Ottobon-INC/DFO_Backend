import asyncio
import os
from supabase import create_client

with open(".env") as f:
    for line in f:
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.strip().split("=", 1)
            os.environ[k] = v

async def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    supabase = create_client(url, key)
    
    resp = supabase.from_("sakhi_clinic_appointments").select("*").execute()
    print("=== APPOINTMENTS IN ACTIVE SUPABASE ===")
    if not resp.data:
        print("No appointments found in sakhi_clinic_appointments table.")
    else:
        for appt in resp.data:
            print(f"ID: {appt.get('id')} | Patient Name: {appt.get('patient_name_snapshot')} | Date: {appt.get('appointment_date')} | Clinic ID: {appt.get('clinic_id')} | Status: {appt.get('status')}")

if __name__ == "__main__":
    asyncio.run(main())
