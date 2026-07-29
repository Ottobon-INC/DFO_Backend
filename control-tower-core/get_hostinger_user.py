import asyncio
from supabase import create_client

async def main():
    # Hostinger Credentials from your .env
    url = "https://srv1152901.hstgr.cloud"
    key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcyNzE0MzczLCJleHAiOjIwODgwNzQzNzN9.Aw2WpTZwJOMdBLOt_UUSgnCYDvP87mmA1Zv-vlr8SoQ"
    
    try:
        supabase = create_client(url, key)
        resp = supabase.from_("sakhi_clinic_users").select("email, password_hash, role").eq("email", "cro@medcyivf.com").execute()
        if resp.data:
            print("=== HOSTINGER USER RECORD ===")
            print(resp.data[0])
        else:
            print("cro@medcyivf.com not found on Hostinger.")
    except Exception as e:
        print("Error connecting to Hostinger:", e)

if __name__ == "__main__":
    asyncio.run(main())
