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
    
    resp = supabase.from_("sakhi_partner_clinics").select("id, name, location, city").execute()
    print("=== PARTNER CLINICS IN ACTIVE SUPABASE ===")
    for c in resp.data:
        print(f"ID: {c.get('id')} | Name: {c.get('name')} | Location/City: {c.get('location') or c.get('city')}")

if __name__ == "__main__":
    asyncio.run(main())
