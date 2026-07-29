import subprocess
import time

def main():
    print("=== STARTING NestJS DIAGNOSTIC RUN ===")
    try:
        proc = subprocess.Popen(
            ["node", "dist/main.js"],
            cwd="c:\\Users\\adrad\\OneDrive\\Desktop\\dfo-backend\\control-tower-core",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Let it run for 10 seconds to capture initialization logs or crashes
        time.sleep(10)
        
        # Kill the process
        proc.terminate()
        stdout, stderr = proc.communicate(timeout=5)
        
        print("\n=== STDOUT ===")
        print(stdout)
        
        print("\n=== STDERR ===")
        print(stderr)
        
    except Exception as e:
        print("Error running diagnostics:", e)

if __name__ == "__main__":
    main()
