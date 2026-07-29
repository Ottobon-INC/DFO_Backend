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
    
    resp = supabase.from_("sakhi_conversations_new").select("*").limit(1).execute()
    print("=== MESSAGE COLUMNS ===")
    if resp.data:
        for k, v in resp.data[0].items():
            print(f"{k}: {type(v).__name__} = {v}")
    else:
        print("No messages found in sakhi_conversations_new.")

if __name__ == "__main__":
    asyncio.run(main())
