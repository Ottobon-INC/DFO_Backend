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
    
    resp = supabase.from_("conversation_threads").select("*").execute()
    print("=== THREADS WITH INVALID USER_ID ===")
    for t in resp.data:
        uid = t.get("user_id")
        # Check if uid contains non-hex characters or does not look like a UUID
        # standard uuid is 8-4-4-4-12 hex chars.
        if len(uid) < 36 or "-" not in uid:
            print(f"Thread ID: {t.get('id')} | User ID: {uid} | Phone: {t.get('phone')} (Wrong UUID format!)")

if __name__ == "__main__":
    asyncio.run(main())
