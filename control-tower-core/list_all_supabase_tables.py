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
    
    # Query database schema
    try:
        resp = supabase.rpc("get_all_tables", {}).execute()
        print("RPC Tables:", resp.data)
    except Exception:
        # Fallback query using public Postgres catalog info via postgrest if possible,
        # or try checking common table names.
        common_tables = [
            "dfo_feedback", "dfo_reviews", "patient_feedback", "patient_reviews", 
            "google_business_profiles", "clinic_gbp", "clinics", "sakhi_clinic_appointments"
        ]
        print("Checking common tables:")
        for t in common_tables:
            try:
                supabase.from_(t).select("count", count="exact").limit(1).execute()
                print(f"  - '{t}' exists!")
            except Exception:
                print(f"  - '{t}' does NOT exist.")

if __name__ == "__main__":
    asyncio.run(main())
