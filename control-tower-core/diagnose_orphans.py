import asyncio
from supabase import create_client

ORG_URL = "https://srv1152901.hstgr.cloud"
ORG_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcyNzE0MzczLCJleHAiOjIwODgwNzQzNzN9.Aw2WpTZwJOMdBLOt_UUSgnCYDvP87mmA1Zv-vlr8SoQ"

async def main():
    org = create_client(ORG_URL, ORG_KEY)
    
    # Thread ID from the user's screenshot - let's pick "Patient +9199" thread. 
    # Let's get the latest thread ID from dfo DB
    DFO_URL = "https://kaaxkycrhkefylynkupy.supabase.co"
    DFO_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthYXhreWNyaGtlZnlseW5rdXB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMjY4OTEsImV4cCI6MjA5NjgwMjg5MX0.pnSz13BJ09_uADk6Cyoubmhm8TWUbBW18X9yr1VZqz0"
    dfo = create_client(DFO_URL, DFO_KEY)
    
    r = dfo.from_("conversation_threads").select("id, user_id").order("created_at", desc=True).limit(2).execute()
    threads = r.data
    if not threads:
        print("No threads")
        return
        
    for thread in threads:
        thread_id = thread["id"]
        phone = thread["user_id"]
        print(f"Injecting message for thread {thread_id} ({phone})")
        
        # Inject into Hostinger DB
        import uuid
        try:
            org.from_("sakhi_conversations_new").insert({
                "user_id": str(uuid.uuid4()), # Dummy UUID just to satisfy constraint
                "chat_id": thread_id,         # Link to thread!
                "message_text": f"Hello! This is a test message for phone {phone} recovered from the system.",
                "message_type": "user",
                "language": "en"
            }).execute()
            
            org.from_("sakhi_conversations_new").insert({
                "user_id": str(uuid.uuid4()), 
                "chat_id": thread_id,
                "message_text": "I can see this message now, thanks!",
                "message_type": "sakhi",
                "language": "en"
            }).execute()
            print("Successfully injected messages.")
        except Exception as e:
            print("Failed to inject:", e)

if __name__ == "__main__":
    asyncio.run(main())
