import os

search_dirs = [
    r"c:\Users\adrad\OneDrive\Desktop\dfo-backend\control-tower-core\src",
    r"c:\Users\adrad\OneDrive\Desktop\Janmasethu\Whatsapp_backend"
]

keywords = ["gbp", "google business", "star rating", "review question", "positive feedback", "negative feedback"]

for directory in search_dirs:
    print(f"=== SEARCHING IN {directory} ===")
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith((".ts", ".py")):
                path = os.path.join(root, file)
                try:
                    with open(path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                    
                    matched = [kw for kw in keywords if kw in content.lower()]
                    if matched:
                        print(f"File: {path} matches keywords: {matched}")
                        # print matching lines
                        lines = content.splitlines()
                        for i, line in enumerate(lines):
                            if any(kw in line.lower() for kw in matched):
                                print(f"  Line {i+1}: {line.strip()}")
                except Exception as e:
                    pass
