with open(r"c:\Users\adrad\OneDrive\Desktop\Janmasethu\Whatsapp_backend\modules\context_router.py", "r", encoding="utf-8") as f:
    content = f.read()

import re
methods = re.findall(r"def\s+(\w+)\s*\(", content)
print("Router methods:")
for m in methods:
    print("  ", m)
