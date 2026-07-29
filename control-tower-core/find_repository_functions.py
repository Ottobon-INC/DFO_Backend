with open(r"c:\Users\adrad\OneDrive\Desktop\dfo-backend\control-tower-core\src\domains\janmasethu\janmasethu.repository.ts", "r", encoding="utf-8") as f:
    content = f.read()

import re
methods = re.findall(r"async\s+(\w+)\s*\(", content)
print("Repository methods:")
for m in methods:
    print("  ", m)
