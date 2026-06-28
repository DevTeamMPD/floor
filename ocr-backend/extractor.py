# -*- coding: utf-8 -*-
"""
ตัวเรียก Vision-AI เพื่ออ่านลายมือจากรูปฟอร์ม แล้วคืน dict ตามสคีมา
รองรับ 3 ผู้ให้บริการ เลือกผ่าน env OCR_PROVIDER:
  - gemini    (ฟรี — Google AI Studio)      [ค่าเริ่มต้น]
  - openai    (เสียเงิน)
  - anthropic (เสียเงิน)
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


def extract_fields(image_bytes, form_type):
    if form_type not in SCHEMAS:
        form_type = "receive"
    if PROVIDER == "openai":
        raw = _extract_openai(image_bytes, form_type)
    elif PROVIDER == "anthropic":
        raw = _extract_anthropic(image_bytes, form_type)
    else:
        raw = _extract_gemini(image_bytes, form_type)
    return _coerce(form_type, raw)
