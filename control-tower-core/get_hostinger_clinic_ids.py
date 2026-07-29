import asyncio
from supabase import create_client

async def main():
    url = "https://srv1152901.hstgr.cloud"
    key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcyNzE0MzczLCJleHAiOjIwODgwNzQzNzN9.Aw2WpTZwJOMdBLOt_UUSgnCYDvP87mmA1Zv-vlr8SoQ"
    
    try:
        supabase = create_client(url, key)
        resp = supabase.from_("sakhi_clinic_users").select("*").eq("email", "cro@medcyivf.com").execute()
        print("=== cro@medcyivf.com on Hostinger ===")
        print(resp.data)
        
        resp2 = supabase.from_("sakhi_clinic_users").select("*").eq("email", "admin@medcyivf.com").execute()
        print("\n=== admin@medcyivf.com on Hostinger ===")
        print(resp2.data)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
