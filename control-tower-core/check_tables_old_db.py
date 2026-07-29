import psycopg2

def main():
    url = "postgresql://postgres:Narayanaswamy%403152@db.fsidwhqotpclwrlwarml.supabase.co:5432/postgres"
    try:
        conn = psycopg2.connect(url)
        cur = conn.cursor()
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """)
        tables = cur.fetchall()
        print("=== TABLES IN fsidwhqotpclwrlwarml ===")
        for t in tables:
            print(t[0])
        cur.close()
        conn.close()
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    main()
