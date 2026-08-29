-- Keep a single current personal link for each active technician.  Historical
-- inactive duplicate records redirect to the active record with the same name
-- and team, and their active assignments are moved to that current account.
CREATE TABLE IF NOT EXISTS public.floor_technician_link_redirects (
  old_token uuid PRIMARY KEY,
  new_token uuid NOT NULL,
  technician_id uuid NOT NULL REFERENCES public.floor_technicians(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.floor_technician_link_redirects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_floor_technician_link_redirect(p_old_token uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('newToken', r.new_token)
  FROM public.floor_technician_link_redirects r
  WHERE r.old_token = p_old_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_floor_technician_link_redirect(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_floor_technician_link_redirect(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_floor_technician_link_redirect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.personal_token IS DISTINCT FROM OLD.personal_token THEN
    UPDATE public.floor_technician_link_redirects
    SET new_token = NEW.personal_token
    WHERE technician_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_floor_technician_link_redirect ON public.floor_technicians;
CREATE TRIGGER sync_floor_technician_link_redirect
AFTER UPDATE OF personal_token ON public.floor_technicians
FOR EACH ROW EXECUTE FUNCTION public.sync_floor_technician_link_redirect();

-- Only reconcile an inactive record when there is exactly one active record
-- with the same normalized name and team.  This avoids guessing when names
-- are ambiguous.
WITH candidate_matches AS (
  SELECT
    legacy.id AS legacy_id,
    active.id AS active_id,
    legacy.personal_token AS old_token,
    active.personal_token AS new_token,
    COUNT(*) OVER (PARTITION BY legacy.id) AS active_match_count
  FROM public.floor_technicians legacy
  JOIN public.floor_technicians active
    ON active.is_active = true
   AND legacy.is_active = false
   AND lower(btrim(active.name)) = lower(btrim(legacy.name))
   AND active.team_id IS NOT DISTINCT FROM legacy.team_id
), pairs AS (
  SELECT legacy_id, active_id, old_token, new_token
  FROM candidate_matches
  WHERE active_match_count = 1
)
INSERT INTO public.floor_technician_link_redirects(old_token, new_token, technician_id)
SELECT old_token, new_token, active_id
FROM pairs
ON CONFLICT (old_token) DO UPDATE
SET new_token = EXCLUDED.new_token,
    technician_id = EXCLUDED.technician_id;

WITH candidate_matches AS (
  SELECT
    legacy.id AS legacy_id,
    active.id AS active_id,
    COUNT(*) OVER (PARTITION BY legacy.id) AS active_match_count
  FROM public.floor_technicians legacy
  JOIN public.floor_technicians active
    ON active.is_active = true
   AND legacy.is_active = false
   AND lower(btrim(active.name)) = lower(btrim(legacy.name))
   AND active.team_id IS NOT DISTINCT FROM legacy.team_id
), pairs AS (
  SELECT legacy_id, active_id
  FROM candidate_matches
  WHERE active_match_count = 1
)
UPDATE public.appointment_technicians assignment_row
SET technician_id = pairs.active_id
FROM pairs
WHERE assignment_row.technician_id = pairs.legacy_id
  AND assignment_row.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.appointment_technicians current_assignment
    WHERE current_assignment.appointment_id = assignment_row.appointment_id
      AND current_assignment.technician_id = pairs.active_id
  );
