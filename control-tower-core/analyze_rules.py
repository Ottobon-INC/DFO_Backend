import re

def analyze():
    path = r"c:\Users\adrad\OneDrive\Desktop\Janmasethu\Whatsapp_backend\modules\context_router.py"
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
            
        with open("context_analysis.txt", "w", encoding="utf-8") as out:
            out.write("=== FUNCTION ANALYSES ===\n\n")
            
            # Extract _is_thread_human_locked
            m_lock = re.search(r"def _is_thread_human_locked.*?(?=def |\Z)", content, re.DOTALL)
            if m_lock:
                out.write("--- _is_thread_human_locked ---\n")
                out.write(m_lock.group(0) + "\n\n")
                
            # Extract classify_escalation_intent
            m_esc = re.search(r"def classify_escalation_intent.*?(?=def |\Z)", content, re.DOTALL)
            if m_esc:
                out.write("--- classify_escalation_intent ---\n")
                out.write(m_esc.group(0) + "\n\n")
                
            # Extract build_hospital_ai_system_prompt
            m_prompt = re.search(r"def build_hospital_ai_system_prompt.*?(?=def |\Z)", content, re.DOTALL)
            if m_prompt:
                out.write("--- build_hospital_ai_system_prompt ---\n")
                out.write(m_prompt.group(0) + "\n\n")
                
            # Extract route_conversation
            m_route = re.search(r"async def route_conversation.*?(?=def |\Z)", content, re.DOTALL)
            if m_route:
                out.write("--- route_conversation (first 100 lines) ---\n")
                out.write("\n".join(m_route.group(0).split("\n")[:100]) + "\n\n")
                
        print("SUCCESS: Wrote context analysis to context_analysis.txt")
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    analyze()
