# -*- coding: utf-8 -*-
"""
MPD OCR Backend — อ่านลายมือจากฟอร์มงานติดตั้งด้วย Vision-AI
รัน local:  start-ocr.bat   (หรือ  uvicorn app:app --port 8000)
แล้ววาง URL  http://localhost:8000  ลงในช่อง "Backend OCR" ของหน้า MPD-Workspace
"""
import os
import traceback

# โหลดค่าจากไฟล์ .env อัตโนมัติ (ถ้ามี) — ต้องทำก่อน import extractor
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from extractor import extract_fields
from prompts import SCHEMAS

app = FastAPI(title="MPD OCR Backend", version="1.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/")
def health():
    return {"status": "ok", "forms": list(SCHEMAS.keys()),
            "provider": os.getenv("OCR_PROVIDER", "gemini"),
            "key_loaded": bool(os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
                               or os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY"))}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...), form_type: str = Form("receive")):
    try:
        image_bytes = await file.read()
        fields = extract_fields(image_bytes, form_type)
        return {"ok": True, "form_type": form_type, "fields": fields}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})
