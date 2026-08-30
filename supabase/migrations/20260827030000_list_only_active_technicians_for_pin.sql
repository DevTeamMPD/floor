-- The PIN administration screen must not show historical/inactive technician
-- records.  They cannot receive a personal work link or PIN by design.
CREATE OR REPLACE FUNCTION public.list_floor_technicians_admin()
RETURNS TABLE(
  id uuid,
  name text,
  phone text,
  personal_token uuid,
  is_team_lead boolean,
  created_at timestamptz,
  device_count bigint
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
  WHERE t.is_active = true
  GROUP BY t.id, t.name, t.phone, t.personal_token, t.is_team_lead, t.created_at
  ORDER BY t.name;
$$;
