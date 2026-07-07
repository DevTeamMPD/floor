# migrate-photos-to-storage

Moves old photos that are still embedded as base64 `data:` URLs inside
`install_jobs.site_photos` (jsonb) into the `job-files` Supabase Storage
bucket, and rewrites those records to point at the uploaded file's public
URL instead. This shrinks the `install_jobs` table and matches how the app
has stored new photos since Storage upload support was added.

This must be run from a machine with normal internet access — it cannot be
run from this coding sandbox, which is blocked by org egress policy from
reaching the Supabase Storage REST API directly.

## Setup

```bash
cd scripts
npm install
```

## Run

Get the **service role key** (not the anon key) from Supabase dashboard →
Project Settings → API. Never commit this key or put it in the app itself.

```bash
SUPABASE_URL="https://nroyacasuchqniaiuirk.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
node migrate-photos-to-storage.mjs --dry-run
```

Review the dry-run output (lists every photo it would upload and roughly how
much space it would free), then run it for real by dropping `--dry-run`:

```bash
SUPABASE_URL="https://nroyacasuchqniaiuirk.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
node migrate-photos-to-storage.mjs
```

The script is safe to re-run — it only touches records that still contain an
embedded `data:` payload, so a partial run (e.g. interrupted network) can
just be re-run to pick up where it left off.
