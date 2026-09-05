-- Backfill install_jobs.address/location_url/product_name/site_photos for BBPS jobs
-- whose payload never carried these at the top level (bbps-sync.ts only read the
-- flat fields until now). The real data was sitting unread in raw_payload.workOrders[0]
-- the whole time (location_address, location_map_link, task_floor/task_ball_pit/...,
-- site_photos) -- see lib/bbps-sync.ts's addressFor/locationUrlFor/productNameFor/
-- sitePhotosFor for the same extraction logic applied going forward on every sync.
--
-- Scoped tightly: only touches rows that are still missing this data today and only
-- fills fields that are currently null/empty, so it can never clobber a value a human
-- already corrected by hand.
update public.install_jobs
set
  address = coalesce(address, nullif(btrim(raw_payload -> 'workOrders' -> 0 ->> 'location_address'), '')),
  location_url = coalesce(location_url, nullif(btrim(raw_payload -> 'workOrders' -> 0 ->> 'location_map_link'), '')),
  product_name = coalesce(product_name, coalesce(
    nullif(btrim(raw_payload -> 'workOrders' -> 0 ->> 'task_floor'), ''),
    nullif(btrim(raw_payload -> 'workOrders' -> 0 ->> 'task_ball_pit'), ''),
    nullif(btrim(raw_payload -> 'workOrders' -> 0 ->> 'task_gym'), ''),
    nullif(btrim(raw_payload -> 'workOrders' -> 0 ->> 'task_workshop_set'), ''),
    nullif(btrim(raw_payload -> 'workOrders' -> 0 ->> 'task_other'), ''),
    nullif(btrim(raw_payload -> 'workOrders' -> 0 ->> 'task_details'), '')
  )),
  site_photos = case
    when (site_photos is null or jsonb_typeof(site_photos) <> 'array' or jsonb_array_length(site_photos) = 0)
      and jsonb_typeof(raw_payload -> 'workOrders' -> 0 -> 'site_photos') = 'array'
    then raw_payload -> 'workOrders' -> 0 -> 'site_photos'
    else site_photos
  end,
  updated_at = now()
where source = 'bbps'
  and status not in ('ยกเลิกคิว', 'BBPS ออกจากคิว')
  and address is null and location_url is null
  and (raw_payload -> 'workOrders' -> 0 ->> 'location_address' is not null
       or raw_payload -> 'workOrders' -> 0 ->> 'location_map_link' is not null);
