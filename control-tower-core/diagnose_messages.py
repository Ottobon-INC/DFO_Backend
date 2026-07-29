import asyncio
from supabase import create_client

ORG_URL = "https://srv1152901.hstgr.cloud"
ORG_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcyNzE0MzczLCJleHAiOjIwODgwNzQzNzN9.Aw2WpTZwJOMdBLOt_UUSgnCYDvP87mmA1Zv-vlr8SoQ"
DFO_URL = "https://kaaxkycrhkefylynkupy.supabase.co"
DFO_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthYXhreWNyaGtlZnlseW5rdXB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMjY4OTEsImV4cCI6MjA5NjgwMjg5MX0.pnSz13BJ09_uADk6Cyoubmhm8TWUbBW18X9yr1VZqz0"

async def main():
    org = create_client(ORG_URL, ORG_KEY)
    dfo = create_client(DFO_URL, DFO_KEY)

    # Key discovery:
    # sakhi_users has: user_id (UUID), phone_number
    # conversation_threads.user_id = phone "+917392123669"
    # sakhi_conversations_new.user_id = UUID from sakhi_users.user_id

    # So the bridge is: conversation_threads.user_id (phone) -> sakhi_users.phone_number -> sakhi_users.user_id
    
    phone = "+917392123669"

    print("=== sakhi_users lookup by phone_number ===")
    for phone_val in [phone, "917392123669", "7392123669"]:
        r = org.from_("sakhi_users").select("user_id, name, phone_number").eq("phone_number", phone_val).limit(2).execute()
        print(f"  phone_number='{phone_val}': {r.data}")

    # Also check users table
    print("\n=== users table lookup by phone ===")
    for phone_val in [phone, "917392123669", "7392123669"]:
        try:
            r = org.from_("users").select("user_id, phone, full_name").eq("phone", phone_val).limit(2).execute()
            print(f"  phone='{phone_val}': {r.data}")
        except Exception as e:
            print(f"  phone='{phone_val}': Error - {e}")

    # Now check conversation_threads columns
    print("\n=== conversation_threads: all columns ===")
    ct_res = dfo.from_("conversation_threads").select("*").order("created_at", desc=True).limit(2).execute()
    if ct_res.data:
        print(f"  Columns: {list(ct_res.data[0].keys())}")
        for t in ct_res.data:
            print(f"  Thread: {t}")
    
    # Check the whatsapp_backend Whatsapp_backend/modules/conversation.py to understand how it saves
    # Look at the test_ui to understand how chat_id flows
    # Most importantly: does chat_id in sakhi_conversations_new match conversation_threads.id?
    
    # Get the thread IDs and check if any match sakhi_conversations_new.chat_id
    print("\n=== Does any thread_id appear in sakhi_conversations_new.chat_id? ===")
    ct_ids = [t['id'] for t in (ct_res.data or [])]
    for tid in ct_ids:
        r = org.from_("sakhi_conversations_new").select("id, user_id, chat_id, message_type").eq("chat_id", tid).limit(2).execute()
        print(f"  chat_id='{tid}': {len(r.data or [])} messages")
        if r.data:
            print(f"    Sample: {r.data[0]}")

    # Check how sakhi_users UUID maps to sakhi_conversations_new
    print("\n=== sakhi_users UUID '0368e1c5...' check ===")
    test_uuid = "0368e1c5-fa17-49e9-b067-5e2f3463ce75"
    r = org.from_("sakhi_users").select("user_id, name, phone_number, email").eq("user_id", test_uuid).execute()
    print(f"  sakhi_users by user_id: {r.data}")

if __name__ == "__main__":
    asyncio.run(main())
