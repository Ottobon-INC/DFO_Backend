with open(r"c:\Users\adrad\OneDrive\Desktop\dfo-backend\control-tower-core\src\domains\janmasethu\appointments\appointment.service.ts", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "cancelAppointment" in line or "rescheduleAppointment" in line:
        print(f"Line {i+1}: {line.strip()}")
        start = max(0, i - 2)
        end = min(len(lines), i + 25)
        print("--- CONTEXT ---")
        for j in range(start, end):
            print(f"{j+1}: {lines[j].rstrip()}")
        print("==============")
