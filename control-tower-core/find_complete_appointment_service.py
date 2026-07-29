import os

src_dir = r"c:\Users\adrad\OneDrive\Desktop\dfo-backend\control-tower-core\src"
for root, dirs, files in os.walk(src_dir):
    for file in files:
        if file.endswith(".ts"):
            path = os.path.join(root, file)
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            if "completeAppointment" in content:
                print(f"Found in {path}")
                # print the lines matching completeAppointment
                lines = content.splitlines()
                for i, line in enumerate(lines):
                    if "completeAppointment" in line:
                        print(f"Line {i+1}: {line.strip()}")
                        start = max(0, i - 2)
                        end = min(len(lines), i + 20)
                        print("--- CONTEXT ---")
                        for j in range(start, end):
                            print(f"{j+1}: {lines[j]}")
                        print("==============")
