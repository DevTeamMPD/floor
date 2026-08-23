-- Migration: mobile_pin_auth
-- เพิ่ม PIN auth สำหรับ mobile app — แทน Supabase Phone OTP
-- ไม่มี SMS ที่จำเป็น, ช่างใช้ลิงก์พนักงาน + PIN 6 หลัก

-- 1) เพิ่ม pin_hash ใน floor_technician_devices
ALTER TABLE public.floor_technician_devices
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS device_secret text;

-- 2) RPC: register_floor_technician_device_pin
--    แทน register_floor_technician_device (ยังคงอันเดิมไว้ compatibility)
CREATE OR REPLACE FUNCTION public.register_floor_technician_device_pin(
  p_personal_token uuid,
  p_pin_hash       text,
  p_platform       text DEFAULT 'unknown',
  p_device_name    text DEFAULT '',
  p_app_version    text DEFAULT 'dev'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tech_id uuid;
  v_device_token uuid := gen_random_uuid();
  v_device_secret uuid := gen_random_uuid();
BEGIN
  -- หา technician จาก personal_token
  SELECT id INTO v_tech_id
  FROM public.floor_technicians
  WHERE personal_token = p_personal_token
  LIMIT 1;

  IF v_tech_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบพนักงาน — ลิงก์ไม่ถูกต้องหรือหมดอายุ';
  END IF;

  INSERT INTO public.floor_technician_devices (
    technician_id, device_token, device_secret,
    platform, device_name, app_version,
    background_permission, enrolled_at,
    pin_hash, pin_set_at
  )
  VALUES (
    v_tech_id, v_device_token, v_device_secret::text,
    p_platform, p_device_name, p_app_version,
    'unknown', now(),
    p_pin_hash, now()
  );

  RETURN jsonb_build_object(
    'deviceToken',  v_device_token,
    'deviceSecret', v_device_secret
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_floor_technician_device_pin TO anon;

-- 3) RPC: verify_floor_device_pin
--    ตรวจ PIN ทุกครั้งที่เปิดแอป
CREATE OR REPLACE FUNCTION public.verify_floor_device_pin(
  p_device_token uuid,
  p_pin_hash     text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored_hash text;
  v_tech_id     uuid;
BEGIN
  SELECT d.pin_hash, d.technician_id
  INTO v_stored_hash, v_tech_id
  FROM public.floor_technician_devices d
  WHERE d.device_token = p_device_token
  LIMIT 1;

  IF v_tech_id IS NULL THEN
    RAISE EXCEPTION 'บัญชีถูกรีเซ็ต กรุณาผูกเครื่องใหม่';
  END IF;

  IF v_stored_hash IS NULL OR v_stored_hash <> p_pin_hash THEN
    RETURN false;
  END IF;

  -- อัปเดตเวลา last seen
  UPDATE public.floor_technician_devices
  SET last_seen_at = now()
  WHERE device_token = p_device_token;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_floor_device_pin TO anon;

-- 4) RPC: reset_floor_device_pin
--    หัวหน้าช่างรีเซ็ตจาก admin — ลบ device ทั้งหมดของช่างคนนั้น
CREATE OR REPLACE FUNCTION public.reset_floor_device_pin(
  p_technician_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.floor_technician_devices
  WHERE technician_id = p_technician_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_floor_device_pin TO anon;

-- 5) RPC: list_floor_technicians_admin
--    สำหรับหน้า /technicians ใน admin
CREATE OR REPLACE FUNCTION public.list_floor_technicians_admin()
RETURNS TABLE(
  id             uuid,
  name           text,
  phone          text,
  personal_token uuid,
  is_team_lead   boolean,
  created_at     timestamptz,
  device_count   bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.name,
    t.phone,
    t.personal_token,
    t.is_team_lead,
    t.created_at,
    COUNT(d.device_token) AS device_count
  FROM public.floor_technicians t
  LEFT JOIN public.floor_technician_devices d ON d.technician_id = t.id
  GROUP BY t.id, t.name, t.phone, t.personal_token, t.is_team_lead, t.created_at
  ORDER BY t.name;
$$;

GRANT EXECUTE ON FUNCTION public.list_floor_technicians_admin TO anon;

-- 6) เพิ่ม last_seen_at ถ้ายังไม่มี
ALTER TABLE public.floor_technician_devices
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
