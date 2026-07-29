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
    
    resp = supabase.from_("sakhi_clinic_users").select("email, password_hash, role").execute()
    
    passwords = [
        "admin",
        "admin123",
        "password",
        "password123",
        "MedcyLaunch2026",
        "Narayanaswamy@3152",
        "Narayanaswamy",
        "3152",
        "Medcy123",
        "medcy",
        "medcyivf",
        "janmasethu",
        "frontdesk",
        "doctor",
        "nurse",
        "cro"
    ]
    
    print("=== INSPECTING HASHES ===")
    for u in resp.data:
        email = u.get("email")
        h = u.get("password_hash")
        role = u.get("role")
        print(f"\nUser: {email} ({role})")
        print(f"Hash: {h}")
        if not h:
            print("No hash set.")
            continue
        
        found = False
        for p in passwords:
            try:
                # support both bcrypt and SHA1/other legacy hashes
                if h.startswith("sha1$") or not (h.startswith("$2b$") or h.startswith("$2a$")):
                    # legacy hash format checking
                    import hashlib
                    # if it's sha1 format e.g. "sha1$salt$hash" or similar
                    parts = h.split("$")
                    if len(parts) == 3:
                        salt, ver = parts[1], parts[2]
                        if hashlib.sha1((salt + p).encode('utf-8')).hexdigest() == ver:
                            print(f"MATCH FOUND! Password is: '{p}'")
                            found = True
                            break
                elif bcrypt.checkpw(p.encode('utf-8'), h.encode('utf-8')):
                    print(f"MATCH FOUND! Password is: '{p}'")
                    found = True
                    break
            except Exception as e:
                pass
        if not found:
            print("Could not match password from common list.")

if __name__ == "__main__":
    asyncio.run(main())
