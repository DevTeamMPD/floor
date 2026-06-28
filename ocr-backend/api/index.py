# Vercel Python entrypoint — ใช้ FastAPI app เดิมจาก app.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app  # noqa: E402  (Vercel จะ serve ตัวแปร `app` แบบ ASGI อัตโนมัติ)
