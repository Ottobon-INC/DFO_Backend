import zipfile
import xml.etree.ElementTree as ET

def get_docx_text(path):
    try:
        with zipfile.ZipFile(path) as docx:
            xml_content = docx.read('word/document.xml')
            root = ET.fromstring(xml_content)
            
            text_runs = []
            for paragraph in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                p_text = []
                for run in paragraph.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
                    if run.text:
                        p_text.append(run.text)
                text_runs.append("".join(p_text))
            
            return "\n".join(text_runs)
    except Exception as e:
        return f"Error reading docx: {e}"

if __name__ == "__main__":
    path = r"c:\Users\adrad\Downloads\Daily Work Report - July 27.docx"
    text = get_docx_text(path)
    with open("extracted_docx.txt", "w", encoding="utf-8") as f:
        f.write(text)
    print("SUCCESS: Wrote extracted text to extracted_docx.txt")
