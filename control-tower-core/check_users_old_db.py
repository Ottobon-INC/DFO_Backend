import psycopg2

def main():
    url = "postgresql://postgres:Narayanaswamy%403152@db.fsidwhqotpclwrlwarml.supabase.co:5432/postgres"
    try:
        conn = psycopg2.connect(url)
        
        # Check User columns and rows
        print("=== User TABLE ===")
        cur = conn.cursor()
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='User'")
        cols = [c[0] for c in cur.fetchall()]
        print("User Columns:", cols)
        cur.execute("SELECT * FROM \"User\" LIMIT 1")
        print("User Sample Row:", cur.fetchone())
        conn.rollback()

        # Check automation_user columns and rows
        print("\n=== automation_user TABLE ===")
        cur = conn.cursor()
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='automation_user'")
        cols = [c[0] for c in cur.fetchall()]
        print("automation_user Columns:", cols)
        # Select email, password_hash if exists
        select_cols = ", ".join([c for c in ['email', 'password_hash', 'password', 'role'] if c in cols])
        if select_cols:
            cur.execute(f"SELECT {select_cols} FROM automation_user LIMIT 5")
            for r in cur.fetchall():
                print(r)
        conn.rollback()
        
        conn.close()
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    main()
