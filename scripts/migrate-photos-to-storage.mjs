#!/usr/bin/env node
// Migrates base64 photo data embedded in install_jobs.site_photos (jsonb) to
// Supabase Storage (bucket "job-files"), replacing each embedded `data:` URL
// with a `url` pointing at the uploaded file. Safe to re-run: it only ever
// touches records that still have a `data:` payload.
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=xxxx \
//   node scripts/migrate-photos-to-storage.mjs [--dry-run]
//
// Requires: npm install (in this scripts/ folder) to pull in @supabase/supabase-js.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'job-files';
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role, not anon key) before running.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function sanitizeKey(key) {
  return String(key).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extFromDataUrl(dataUrl, fallbackName) {
  const m = /^data:([^;]+);base64,/.exec(dataUrl || '');
  const mime = m ? m[1] : '';
  const fromName = (fallbackName || '').match(/\.[a-zA-Z0-9]+$/);
  if (fromName) return fromName[0];
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'application/pdf') return '.pdf';
  return '';
}

function decodeDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

// Walks site_photos looking for {name,type,data:"data:..."} records, whether
// stored as a single object under a key or inside an array under a key.
// Returns a flat list of {record, replace(url)} descriptors.
function findMigratable(sitePhotos, orderNo) {
  const found = [];
  if (!sitePhotos || typeof sitePhotos !== 'object') return found;
  for (const key of Object.keys(sitePhotos)) {
    const val = sitePhotos[key];
    if (Array.isArray(val)) {
      val.forEach((rec, idx) => {
        if (rec && typeof rec.data === 'string' && rec.data.startsWith('data:')) {
          const ext = extFromDataUrl(rec.data, rec.name);
          const path = `${orderNo}/${sanitizeKey(key)}_${idx}${ext}`;
          found.push({ rec, path });
        }
      });
    } else if (val && typeof val === 'object' && typeof val.data === 'string' && val.data.startsWith('data:')) {
      const ext = extFromDataUrl(val.data, val.name);
      const path = `${orderNo}/${sanitizeKey(key)}${ext}`;
      found.push({ rec: val, path });
    }
  }
  return found;
}

async function main() {
  console.log(DRY_RUN ? 'Running in --dry-run mode (no writes will be made).' : 'Running for real — this will modify install_jobs rows and upload to Storage.');

  const { data: rows, error } = await supabase
    .from('install_jobs')
    .select('id, order_no, site_photos')
    .not('site_photos', 'is', null);

  if (error) {
    console.error('Failed to fetch install_jobs:', error.message);
    process.exit(1);
  }

  let rowsTouched = 0;
  let recordsMigrated = 0;
  let recordsFailed = 0;
  let bytesFreed = 0;

  for (const row of rows) {
    const orderNo = row.order_no || row.id;
    const targets = findMigratable(row.site_photos, orderNo);
    if (!targets.length) continue;

    console.log(`\nOrder ${orderNo}: ${targets.length} embedded photo(s) found.`);
    let changed = false;

    for (const { rec, path } of targets) {
      const decoded = decodeDataUrl(rec.data);
      if (!decoded) {
        console.warn(`  ! ${path}: could not parse data URL, skipping`);
        recordsFailed++;
        continue;
      }
      const beforeSize = rec.data.length;

      if (DRY_RUN) {
        console.log(`  would upload -> ${path} (${(decoded.buffer.length / 1024).toFixed(1)} KB)`);
        continue;
      }

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, decoded.buffer, { upsert: true, contentType: decoded.mime || rec.type || 'application/octet-stream' });

      if (upErr) {
        console.warn(`  ! ${path}: upload failed — ${upErr.message}`);
        recordsFailed++;
        continue;
      }

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = pub && pub.publicUrl;
      if (!publicUrl) {
        console.warn(`  ! ${path}: uploaded but could not resolve public URL`);
        recordsFailed++;
        continue;
      }

      rec.url = publicUrl;
      delete rec.data;
      bytesFreed += beforeSize;
      recordsMigrated++;
      changed = true;
      console.log(`  ✓ ${path} -> ${publicUrl}`);
    }

    if (changed && !DRY_RUN) {
      const { error: updErr } = await supabase
        .from('install_jobs')
        .update({ site_photos: row.site_photos })
        .eq('id', row.id);
      if (updErr) {
        console.warn(`  ! order ${orderNo}: failed to save updated site_photos — ${updErr.message}`);
      } else {
        rowsTouched++;
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Rows with embedded photos: scanned ${rows.length}, updated ${rowsTouched}`);
  console.log(`Records migrated: ${recordsMigrated}, failed: ${recordsFailed}`);
  console.log(`Approx. bytes freed from database: ${(bytesFreed / 1024 / 1024).toFixed(2)} MB`);
  if (DRY_RUN) console.log('(dry run — nothing was actually uploaded or written)');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
