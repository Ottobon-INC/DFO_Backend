import asyncio
import httpx

async def main():
    # 1. Login to get JWT Token
    login_url = "http://localhost:3005/api/auth/login"
    login_payload = {
        "email": "cro@medcyivf.com",
        "password": "password123"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            login_resp = await client.post(login_url, json=login_payload)
            print("Login Status:", login_resp.status_code)
            if login_resp.status_code != 201 and login_resp.status_code != 200:
                print("Login Failed:", login_resp.text)
                return
                
            token = login_resp.json()["data"]["token"]
            print("Successfully authenticated!")
            
            # 2. Query threads list
            threads_url = "http://localhost:3005/api/janmasethu/threads"
            headers = {"Authorization": f"Bearer {token}"}
            threads_resp = await client.get(threads_url, headers=headers)
            print("Get Threads Status:", threads_resp.status_code)
            print("Threads Response:", threads_resp.text)
            
        except Exception as e:
            print("Request failed:", e)

if __name__ == "__main__":
    asyncio.run(main())
