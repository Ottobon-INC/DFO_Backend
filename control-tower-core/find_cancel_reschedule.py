with open(r"c:\Users\adrad\OneDrive\Desktop\dfo-backend\control-tower-core\src\domains\janmasethu\appointments\appointment.service.ts", "r", encoding="utf-8") as f:
    content = f.read()

import re
methods = re.findall(r"async\s+(\w+)\s*\(", content)
print("AppointmentService methods:")
for m in methods:
    if "cancel" in m.lower() or "reschedule" in m.lower():
        print("  Matched:", m)
    else:
        print("  Other:", m)
