import asyncio
import httpx
import sys

# Set standard output to UTF-8 to support emoji printing on Windows
sys.stdout.reconfigure(encoding='utf-8')

async def main():
    login_url = "http://localhost:3005/api/auth/login"
    login_payload = {
        "email": "cro@medcyivf.com",
        "password": "password123"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            login_resp = await client.post(login_url, json=login_payload)
            token = login_resp.json()["data"]["token"]
            
            threads_url = "http://localhost:3005/api/janmasethu/threads"
            headers = {"Authorization": f"Bearer {token}"}
            threads_resp = await client.get(threads_url, headers=headers)
            
            print("Get Threads Status:", threads_resp.status_code)
            threads = threads_resp.json()
            # If the response is wrapped in a NestJS response interceptor:
            if isinstance(threads, dict) and "data" in threads:
                threads = threads["data"]
            elif isinstance(threads, dict) and "success" in threads and "data" in threads.get("data", {}):
                threads = threads["data"]["data"]
                
            print(f"Total threads returned: {len(threads)}")
            for t in threads[:10]:
                print(f"ID: {t.get('id')} | User/Phone: {t.get('user_id')} | Name: {t.get('patient_name')} | Status: {t.get('status')} | Msg: {t.get('latest_message')}")
                
        except Exception as e:
            print("Request failed:", e)

if __name__ == "__main__":
    asyncio.run(main())
