with open(r"c:\Users\adrad\OneDrive\Desktop\Janmasethu\Whatsapp_backend\modules\context_router.py", "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if "ctx ==" in line or "elif ctx" in line or "state:" in line.lower():
            print(f"Line {i+1}: {line.strip()}")
