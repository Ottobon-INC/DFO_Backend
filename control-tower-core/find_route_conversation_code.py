with open(r"c:\Users\adrad\OneDrive\Desktop\Janmasethu\Whatsapp_backend\modules\context_router.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "def route_conversation" in line:
        print(f"Line {i+1}: {line.strip()}")
        start = max(0, i - 2)
        end = min(len(lines), i + 40)
        print("--- CONTEXT ---")
        for j in range(start, end):
            print(f"{j+1}: {lines[j].rstrip()}")
        print("==============")
        break
