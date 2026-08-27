-- Resetting a technician's personal access needs to change the personal token,
-- PIN hash, and device registrations together.  The browser must not receive
-- direct UPDATE access to floor_technicians for this operation.
CREATE OR REPLACE FUNCTION public.reset_floor_technician_access(
  p_technician_id uuid,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pin text := regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g');
  v_token uuid;
BEGIN
  IF lower(coalesce(auth.jwt() ->> 'email', '')) <> 'supakrit.k@mpdgroup.co' THEN
    RAISE EXCEPTION 'PIN reset is restricted to the system administrator';
  END IF;

  IF v_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'PIN must contain 4 to 6 digits';
  END IF;

  -- Lock the employee row so a concurrent reset cannot create two valid links.
  PERFORM 1
  FROM public.floor_technicians
  WHERE id = p_technician_id
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active technician not found';
  END IF;

  UPDATE public.floor_technicians
  SET personal_token = gen_random_uuid(),
      pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
      pin_updated_at = now(),
      updated_at = now()
  WHERE id = p_technician_id
  RETURNING personal_token INTO v_token;

  DELETE FROM public.floor_technician_devices
  WHERE technician_id = p_technician_id;

  RETURN jsonb_build_object('personalToken', v_token);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_floor_technician_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_floor_technician_access(uuid, text) TO authenticated;
