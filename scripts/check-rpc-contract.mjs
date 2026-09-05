#!/usr/bin/env node
// เทสต์สัญญา RPC — ทุกชื่อที่โค้ดเรียกด้วย .rpc("...") ต้องมีฟังก์ชันจริงในฐานข้อมูล
// ใช้ได้ 2 แบบ:
//   node scripts/check-rpc-contract.mjs --functions-file <ไฟล์รายชื่อฟังก์ชัน 1 ชื่อ/บรรทัด>
//   SUPABASE_DB_URL=... node scripts/check-rpc-contract.mjs      (ดึงรายชื่อจาก DB ด้วย psql)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { extractRpcCalls, findMissingRpcs } from "../lib/rpc-contract.ts";

const ROOTS = ["app", "components", "lib"];
const EXT = /\.(ts|tsx)$/;
const SKIP = /\.test\.tsx?$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(entry) && !SKIP.test(entry)) out.push(full);
  }
  return out;
}

function existingFunctions() {
  const flag = process.argv.indexOf("--functions-file");
  if (flag !== -1) {
    return new Set(readFileSync(process.argv[flag + 1], "utf8").split("\n").map((s) => s.trim()).filter(Boolean));
  }
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw || !raw.trim()) return null;
  // GitHub secret มักติดช่องว่าง/ขึ้นบรรทัดใหม่/เครื่องหมายคำพูดมาด้วย -> psql จะมองว่าเป็นชื่อ db
  // แล้วไปต่อ unix socket ในเครื่อง runner ซึ่งไม่มี Postgres (error ชวนงง) จึงตัดทิ้งและเช็คก่อน
  const url = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error("SUPABASE_DB_URL ไม่ใช่ connection URI");
    console.error(`  ค่าที่ได้ขึ้นต้นด้วย: ${JSON.stringify(url.slice(0, 12))} (ยาว ${url.length} ตัวอักษร)`);
    console.error("  ต้องเป็น: postgresql://floor_ci_reader.<project-ref>:<password>@<host>:5432/postgres?sslmode=require");
    console.error("  ห้ามใส่เครื่องหมายคำพูดครอบ และห้ามใส่แค่ host");
    process.exit(1);
  }
  const sql = "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'";
  const out = execFileSync("psql", [url, "-Atc", sql], { encoding: "utf8" });
  return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
}

const existing = existingFunctions();
if (!existing) {
  console.log("ข้าม: ไม่ได้ตั้ง SUPABASE_DB_URL และไม่ได้ส่ง --functions-file");
  console.log("      ตั้ง secret แล้วเทสต์นี้จะเริ่มกันไม่ให้ merge โค้ดที่เรียก RPC ที่ไม่มีจริง");
  process.exit(0);
}

const calls = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    calls.push(...extractRpcCalls(readFileSync(file, "utf8"), relative(process.cwd(), file)));
  }
}

const missing = findMissingRpcs(calls, existing);
const names = new Set(calls.map((c) => c.name));
console.log(`ตรวจ ${calls.length} จุดที่เรียก RPC (${names.size} ชื่อไม่ซ้ำ) เทียบกับ ${existing.size} ฟังก์ชันในฐานข้อมูล`);

if (missing.length === 0) {
  console.log("ผ่าน: ทุก RPC ที่โค้ดเรียก มีอยู่จริงในฐานข้อมูล");
  process.exit(0);
}

console.error(`\nไม่ผ่าน: พบ ${missing.length} จุดที่เรียก RPC ที่ไม่มีในฐานข้อมูล\n`);
for (const m of missing) console.error(`  ${m.file}:${m.line}  ->  ${m.name}()`);
console.error("\nแก้โดย: ขึ้น migration ของฟังก์ชันนี้ก่อน แล้วค่อย merge โค้ดที่เรียก");
process.exit(1);
