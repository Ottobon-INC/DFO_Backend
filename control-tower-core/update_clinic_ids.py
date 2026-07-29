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
    
    clinic_id = "11111111-1111-1111-1111-111111111111"
    emails_to_update = ["cro@medcyivf.com", "doctor@medcyivf.com", "nurse@medcyivf.com"]
    
    print(f"=== ASSIGNING CLINIC ID {clinic_id} IN SUPABASE ===")
    for email in emails_to_update:
        resp = supabase.from_("sakhi_clinic_users").update({
            "clinic_id": clinic_id
        }).eq("email", email).execute()
        
        if resp.data:
            print(f"SUCCESS: Assigned clinic ID to {email}")
        else:
            print(f"FAILED: Update for {email}")

if __name__ == "__main__":
    asyncio.run(main())
