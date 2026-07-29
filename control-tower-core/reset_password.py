import asyncio
import os
import bcrypt
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
    
    # Generate bcrypt hash for 'admin123'
    # NestJS uses standard bcrypt, which is fully compatible with python-bcrypt
    hashed = bcrypt.hashpw(b"admin123", bcrypt.gensalt(10)).decode("utf-8")
    
    # Reset password and unlock account
    resp = supabase.from_("sakhi_clinic_users").update({
        "password_hash": hashed,
        "failed_attempts": 0,
        "locked_until": None
    }).eq("email", "admin@medcyivf.com").execute()
    
    if resp.data:
        print("Successfully reset password for admin@medcyivf.com to 'admin123' and unlocked the account!")
    else:
        print("Failed to find or update admin@medcyivf.com user.")

if __name__ == "__main__":
    asyncio.run(main())
