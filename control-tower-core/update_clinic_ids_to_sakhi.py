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
    
    clinic_id = "1c5b8ed4-0fbf-4131-be3c-f1c4e18ef34d"
    emails_to_update = [
        "admin@medcyivf.com",
        "cro@medcyivf.com",
        "doctor@medcyivf.com",
        "nurse@medcyivf.com",
        "frontdesk@medcyivf.com",
        "divya@medcyivf.com"
    ]
    
    print(f"=== UPDATING CLINIC ID TO {clinic_id} ===")
    for email in emails_to_update:
        resp = supabase.from_("sakhi_clinic_users").update({
            "clinic_id": clinic_id
        }).eq("email", email).execute()
        if resp.data:
            print(f"SUCCESS: Set clinic ID to {clinic_id} for {email}")
        else:
            print(f"FAILED: Could not update {email}")
            
    # Also align any appointments with the wrong clinic ID
    resp_appt = supabase.from_("sakhi_clinic_appointments").update({
        "clinic_id": clinic_id
    }).eq("clinic_id", "11111111-1111-1111-1111-111111111111").execute()
    if resp_appt.data:
        print("SUCCESS: Aligned all clinic appointment records to Sakhi clinic ID.")

if __name__ == "__main__":
    asyncio.run(main())
