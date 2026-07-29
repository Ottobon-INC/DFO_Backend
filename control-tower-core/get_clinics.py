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
    
    resp = supabase.from_("clinics").select("*").execute()
    print("=== CLINICS ===")
    for c in resp.data:
        print(c)

if __name__ == "__main__":
    asyncio.run(main())
