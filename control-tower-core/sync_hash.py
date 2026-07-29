import asyncio
import os
from supabase import create_client

with open(".env") as f:
    for line in f:
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.strip().split("=", 1)
            os.environ[k] = v

async def main():
    hostinger_url = "https://srv1152901.hstgr.cloud"
    hostinger_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcyNzE0MzczLCJleHAiOjIwODgwNzQzNzN9.Aw2WpTZwJOMdBLOt_UUSgnCYDvP87mmA1Zv-vlr8SoQ"
    
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    hostinger = create_client(hostinger_url, hostinger_key)
    supabase = create_client(supabase_url, supabase_key)
    
    users_to_sync = ["cro@medcyivf.com", "admin@medcyivf.com"]
    
    print("=== SYNCING PASSWORD HASHES FROM HOSTINGER TO SUPABASE ===")
    for email in users_to_sync:
        resp = hostinger.from_("sakhi_clinic_users").select("password_hash").eq("email", email).execute()
        if resp.data:
            h = resp.data[0]["password_hash"]
            print(f"User: {email} -> Hostinger Hash: {h}")
            
            # Update in active Supabase
            update_resp = supabase.from_("sakhi_clinic_users").update({
                "password_hash": h,
                "failed_attempts": 0,
                "locked_until": None
            }).eq("email", email).execute()
            
            if update_resp.data:
                print(f"Successfully updated {email} in active Supabase!")
            else:
                print(f"Failed to update {email} in active Supabase.")
        else:
            print(f"User {email} not found on Hostinger.")

if __name__ == "__main__":
    asyncio.run(main())
