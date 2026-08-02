import requests
headers = {
    "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthYXhreWNyaGtlZnlseW5rdXB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMjY4OTEsImV4cCI6MjA5NjgwMjg5MX0.pnSz13BJ09_uADk6Cyoubmhm8TWUbBW18X9yr1VZqz0"
}
resp = requests.get("https://kaaxkycrhkefylynkupy.supabase.co/rest/v1/conversation_threads?select=id,status&limit=1", headers=headers)
print(resp.status_code, resp.text)
