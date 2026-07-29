import asyncio
import psycopg2

def inspect_db(name, url):
    print(f"\n=== INSPECTING {name} ===")
    try:
        conn = psycopg2.connect(url)
        cur = conn.cursor()
        cur.execute("SELECT email, password_hash, failed_attempts, locked_until FROM sakhi_clinic_users WHERE email='admin@medcyivf.com'")
        row = cur.fetchone()
        if row:
            print(f"Email: {row[0]}")
            print(f"Password Hash: {row[1]}")
            print(f"Failed Attempts: {row[2]}")
            print(f"Locked Until: {row[3]}")
        else:
            print("admin@medcyivf.com not found in this database.")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error connecting to {name}: {e}")

if __name__ == "__main__":
    db_old = "postgresql://postgres:Narayanaswamy%403152@db.fsidwhqotpclwrlwarml.supabase.co:5432/postgres"
    db_new = "postgresql://postgres:Narayanaswamy%403152@db.kaaxkycrhkefylynkupy.supabase.co:5432/postgres"
    
    inspect_db("OLD DATABASE (fsidwhqotpclwrlwarml)", db_old)
    inspect_db("NEW DATABASE (kaaxkycrhkefylynkupy)", db_new)
