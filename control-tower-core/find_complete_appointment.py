with open(r"c:\Users\adrad\OneDrive\Desktop\dfo-backend\control-tower-core\src\domains\janmasethu\janmasethu.controller.ts", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "complete" in line.lower() and "@Post" in line:
        print(f"Line {i+1}: {line.strip()}")
        start = max(0, i - 2)
        end = min(len(lines), i + 20)
        for j in range(start, end):
            print(f"{j+1}: {lines[j].rstrip()}")
        break
