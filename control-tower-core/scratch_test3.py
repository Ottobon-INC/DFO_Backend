import asyncio
import httpx
import json
import base64

async def main():
    resp = await httpx.AsyncClient().post(
        "http://localhost:4000/api/auth/login",
        json={"email": "cro.divya@medcyivf.com", "password": "Temporary123!"}
    )
    if resp.status_code != 200 and resp.status_code != 201:
        print("Login Failed", resp.text)
        return
        
    token = resp.json()["data"]["token"]
    
    # decode JWT payload
    payload = token.split(".")[1] + "==="
    print("JWT Payload:", json.loads(base64.urlsafe_b64decode(payload.encode())))
    
    threads_resp = await httpx.AsyncClient().get(
        "http://localhost:4000/api/janmasethu/context/a68ab4ff-ca36-47a8-8cc7-a54057bdf7a2",
        headers={"Authorization": f"Bearer {token}"}
    )
    print(threads_resp.status_code)
    print(threads_resp.text)

asyncio.run(main())
