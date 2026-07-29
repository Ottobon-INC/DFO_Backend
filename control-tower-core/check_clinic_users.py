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
    
    resp = supabase.from_("sakhi_clinic_users").select("*").execute()
    print("=== REGISTERED CLINIC USERS ===")
    for u in resp.data:
        print(f"Name: {u.get('name') or u.get('first_name')} | Email: {u.get('email')} | Role: {u.get('role')} | Clinic ID: {u.get('clinic_id')}")

if __name__ == "__main__":
    asyncio.run(main())
