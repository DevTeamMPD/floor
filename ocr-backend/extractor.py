# -*- coding: utf-8 -*-
"""
ตัวเรียก Vision-AI เพื่ออ่านลายมือจากรูปฟอร์ม แล้วคืน dict ตามสคีมา
รองรับ 4 ผู้ให้บริการ เลือกผ่าน env OCR_PROVIDER:
  - gemini     (ฟรี — Google AI Studio)      [ค่าเริ่มต้น]
  - openai     (เสียเงิน)
  - anthropic  (เสียเงิน)
  - openrouter (ผ่าน OpenRouter — fallback อัตโนมัติเมื่อ Gemini ติด quota)
API key อ่านจาก environment variable เท่านั้น (ไม่เก็บในโค้ด/หน้าเว็บ)
"""
import os, json, base64
from prompts import build_prompt, SCHEMAS

PROVIDER = os.getenv("OCR_PROVIDER", "gemini").lower()


def _empty(form_type):
    out = {}
    for k in SCHEMAS.get(form_type, SCHEMAS["receive"])["fields"].keys():
        out[k] = [] if k in ("room", "rows") else ""
    return out


def _coerce(form_type, data):
    base = _empty(form_type)
    if isinstance(data, dict):
        for k in base:
            if k in data and data[k] is not None:
                base[k] = data[k]
    return base


def _loads(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    return json.loads(text)


def _extract_gemini(image_bytes, form_type):
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
    resp = client.models.generate_content(
        model=os.getenv("OCR_MODEL", "gemini-2.5-flash"),
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
            build_prompt(form_type),
        ],
        config=types.GenerateContentConfig(temperature=0, response_mime_type="application/json"),
    )
    return _loads(resp.text)


def _extract_openai(image_bytes, form_type):
    from openai import OpenAI
    client = OpenAI()
    b64 = base64.b64encode(image_bytes).decode()
    data_url = "data:image/jpeg;base64," + b64
    content = [
        {"type": "text", "text": build_prompt(form_type)},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]
    resp = client.chat.completions.create(
        model=os.getenv("OCR_MODEL", "gpt-4o"),
        temperature=0,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": content}],
    )
    return _loads(resp.choices[0].message.content)


def _extract_anthropic(image_bytes, form_type):
    import anthropic
    client = anthropic.Anthropic()
    b64 = base64.b64encode(image_bytes).decode()
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
        {"type": "text", "text": build_prompt(form_type) + "\n\nตอบเป็น JSON object ล้วนเท่านั้น"},
    ]
    msg = client.messages.create(
        model=os.getenv("OCR_MODEL", "claude-sonnet-4-6"),
        max_tokens=2000, temperature=0,
        messages=[{"role": "user", "content": content}],
    )
    return _loads(msg.content[0].text)


def _extract_openrouter(image_bytes, form_type):
    from openai import OpenAI
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.getenv("OPENROUTER_API_KEY"),
    )
    b64 = base64.b64encode(image_bytes).decode()
    data_url = "data:image/jpeg;base64," + b64
    content = [
        {"type": "text", "text": build_prompt(form_type)},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]
    resp = client.chat.completions.create(
        model=os.getenv("OPENROUTER_MODEL", "google/gemini-2.0-flash-exp:free"),
        temperature=0,
        messages=[{"role": "user", "content": content}],
    )
    return _loads(resp.choices[0].message.content)


_PDF_FORM_ORDER = ["receive", "issue", "sign"]


def _build_pdf_combined_prompt():
    def flds(sc):
        return "\n".join(f'  - "{k}": {v}' for k, v in sc["fields"].items())
    r, iss, s = SCHEMAS["receive"], SCHEMAS["issue"], SCHEMAS["sign"]
    return f"""คุณเป็นผู้ช่วยอ่านเอกสาร PDF ฟอร์มงานติดตั้ง MPD ที่เขียนด้วยลายมือ
PDF นี้มีหลายหน้า แต่ละหน้าเป็นฟอร์มต่างชนิด

ดึงข้อมูลออกมาเป็น JSON object เดียวที่มี 3 key เท่านั้น:

"receive" — {r['title']}:
{flds(r)}

"issue" — {iss['title']}:
{flds(iss)}

"sign" — {s['title']}:
{flds(s)}

กฎ: ช่องว่าง/อ่านไม่ออก → "" (หรือ [] สำหรับ room/rows) · ห้ามแต่งข้อมูล · ตอบ JSON ล้วน ไม่มีคำอธิบาย"""


def _extract_pdf_gemini(pdf_bytes):
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
    resp = client.models.generate_content(
        model=os.getenv("OCR_MODEL", "gemini-2.5-flash"),
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            _build_pdf_combined_prompt(),
        ],
        config=types.GenerateContentConfig(temperature=0, response_mime_type="application/json"),
    )
    return _loads(resp.text)


def _pdf_to_images(pdf_bytes):
    import fitz  # pymupdf
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = [page.get_pixmap(matrix=fitz.Matrix(2, 2)).tobytes("jpeg") for page in doc]
    doc.close()
    return images


def extract_pdf_fields(pdf_bytes):
    """คืน dict {"receive": {...}, "issue": {...}, "sign": {...}}"""
    def from_images(extractor_fn):
        images = _pdf_to_images(pdf_bytes)
        result = {ft: _coerce(ft, extractor_fn(img, ft))
                  for ft, img in zip(_PDF_FORM_ORDER, images[:3])}
        for ft in _PDF_FORM_ORDER:
            result.setdefault(ft, _coerce(ft, {}))
        return result

    if PROVIDER == "openai":
        return from_images(_extract_openai)
    elif PROVIDER == "anthropic":
        return from_images(_extract_anthropic)
    elif PROVIDER == "openrouter":
        return from_images(_extract_openrouter)
    else:
        try:
            raw = _extract_pdf_gemini(pdf_bytes)
            return {ft: _coerce(ft, raw.get(ft, {})) for ft in _PDF_FORM_ORDER}
        except Exception as e:
            if os.getenv("OPENROUTER_API_KEY") and _is_rate_limit(e):
                print(f"[OCR PDF] Gemini rate-limit → OpenRouter image fallback ({e})")
                return from_images(_extract_openrouter)
            raise


def _is_rate_limit(exc):
    msg = str(exc).lower()
    return "429" in msg or "quota" in msg or "rate" in msg or "resourceexhausted" in type(exc).__name__.lower()


def extract_fields(image_bytes, form_type):
    if form_type not in SCHEMAS:
        form_type = "receive"
    if PROVIDER == "openai":
        raw = _extract_openai(image_bytes, form_type)
    elif PROVIDER == "anthropic":
        raw = _extract_anthropic(image_bytes, form_type)
    elif PROVIDER == "openrouter":
        raw = _extract_openrouter(image_bytes, form_type)
    else:
        # gemini — fallback to OpenRouter อัตโนมัติเมื่อติด quota/rate-limit
        try:
            raw = _extract_gemini(image_bytes, form_type)
        except Exception as e:
            if os.getenv("OPENROUTER_API_KEY") and _is_rate_limit(e):
                print(f"[OCR] Gemini rate-limit → fallback OpenRouter ({e})")
                raw = _extract_openrouter(image_bytes, form_type)
            else:
                raise
    return _coerce(form_type, raw)
