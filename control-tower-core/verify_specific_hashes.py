import bcrypt

hash_val = "$2b$10$ZNhRPrtXcX2iqv6xieTc8uBmPAgs7oeVmlNXtjBelkhdb4HnSkcBW"
passwords = [
    "Medcy@123",
    "MedcyIVF@123",
    "Admin@123",
    "admin@123",
    "Sakhi@123",
    "Janmasethu@123",
    "Narayanaswamy@3152",
    "Narayanaswamy@123",
    "Narayanaswamy@315",
    "MedcyLaunch2026",
    "MedcyLaunch@2026",
    "MedcyLaunch2026!",
    "Janmasethu@2026",
    "password@123",
    "Password@123"
]

print("=== CHECKING CUSTOM PASSWORD LIST ===")
for p in passwords:
    if bcrypt.checkpw(p.encode('utf-8'), hash_val.encode('utf-8')):
        print(f"MATCH FOUND! The password is: '{p}'")
        break
else:
    print("No matches found.")
