with open(r"c:\Users\adrad\OneDrive\Desktop\dfo-backend\control-tower-core\src\domains\janmasethu\janmasethu.controller.ts", "r", encoding="utf-8") as f:
    content = f.read()

import re
gets = re.findall(r"@Get\('([^']+)'\)", content)
posts = re.findall(r"@Post\('([^']+)'\)", content)

print("GET endpoints:")
for g in gets:
    print("  ", g)
    
print("\nPOST endpoints:")
for p in posts:
    print("  ", p)
