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
    
    # Run a query to get public tables via Postgres catalog
    # Wait, Supabase client doesn't directly run SQL unless we use RPC or postgrest schema info.
    # We can inspect common clinic tables:
    tables = [
        "sakhi_clinics",
        "sakhi_clinic_users",
        "automation_partner_clinic",
        "sakhi_partner_clinics",
        "clinics"
    ]
    for t in tables:
        try:
            resp = supabase.from_(t).select("count", count="exact").limit(1).execute()
            print(f"Table '{t}' exists! Count: {resp.count}")
        except Exception as e:
            print(f"Table '{t}' does not exist or failed: {e.message if hasattr(e, 'message') else e}")

if __name__ == "__main__":
    asyncio.run(main())
