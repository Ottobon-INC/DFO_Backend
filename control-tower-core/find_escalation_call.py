with open(r"c:\Users\adrad\OneDrive\Desktop\Janmasethu\Whatsapp_backend\modules\context_router.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "classify_escalation_intent" in line:
        print(f"Line {i+1}: {line.strip()}")
        # print 5 lines before and after
        start = max(0, i - 10)
        end = min(len(lines), i + 15)
        print("--- CONTEXT ---")
        for j in range(start, end):
            print(f"{j+1}: {lines[j].rstrip()}")
        print("===============")
