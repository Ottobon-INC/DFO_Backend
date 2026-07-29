import bcrypt

hash_val = "$2b$10$ZNhRPrtXcX2iqv6xieTc8uBmPAgs7oeVmlNXtjBelkhdb4HnSkcBW"
passwords = [
    "admin",
    "admin123",
    "password",
    "password123",
    "MedcyLaunch2026",
    "Narayanaswamy@3152",
    "Narayanaswamy",
    "3152",
    "Medcy123",
    "medcy",
    "medcyivf",
    "janmasethu",
    "frontdesk"
]

print("=== CHECKING PASSWORD HASH ===")
for p in passwords:
    if bcrypt.checkpw(p.encode('utf-8'), hash_val.encode('utf-8')):
        print(f"MATCH FOUND! The password is: '{p}'")
        break
else:
    print("No matches found in the common list.")
