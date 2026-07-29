with open(r"c:\Users\adrad\OneDrive\Desktop\dfo-backend\control-tower-core\src\domains\janmasethu\janmasethu.controller.ts", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "context" in line.lower():
        print(f"Line {i+1}: {line.strip()}")
        # print context around the match
        start = max(0, i - 5)
        end = min(len(lines), i + 15)
        print("--- CONTEXT ---")
        for j in range(start, end):
            print(f"{j+1}: {lines[j].rstrip()}")
        print("===============")
