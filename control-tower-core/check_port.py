import socket

def check_port(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        result = s.connect_ex(('127.0.0.1', port))
        if result == 0:
            print(f"Port {port} is OPEN/Listening")
        else:
            print(f"Port {port} is CLOSED (code {result})")

if __name__ == "__main__":
    check_port(3005)
