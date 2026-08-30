"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RemnantReportPiece {
  id?: string;
  widthCm: string;
  lengthCm: string;
  qty: string;
  thickness: string;
  color: string;
  note: string;
  photoPaths: string[];
}

export interface RemnantReportData {
  exists: boolean;
  isLead: boolean;
  id?: string;
  status: "pending_review" | "accepted" | "rejected" | null;
  noRemnant?: boolean;
  materials?: MaterialMovement[];
  notes?: string | null;
  submittedAt?: string;
  reviewNote?: string | null;
  pieces?: RemnantReportPiece[];
}

export interface MaterialMovement {
  thickness: string;
  color: string;
  widthCm: string;
  lengthCm: string;
  qty: string;
  note?: string;
}

interface LocalPhoto { id: string; file: File; url: string }
interface PieceDraft extends RemnantReportPiece { localPhotos: LocalPhoto[] }

const EMPTY_MATERIAL: MaterialMovement = { thickness: "16", color: "B", widthCm: "110", lengthCm: "", qty: "1", note: "" };
const EMPTY_PIECE: PieceDraft = { widthCm: "110", lengthCm: "", qty: "1", thickness: "16", color: "B", note: "", photoPaths: [], localPhotos: [] };

function publicPhotoUrl(path: string, supabase: ReturnType<typeof createClient>) {
  return /^(https?:|blob:|data:)/.test(path) ? path : supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl;
}

export default function RemnantReportForm({
  token, pin, assignmentId, appointmentId, initial, suggestedMaterials, onSaved, demoMode = false,
}: {
  token: string; pin: string; assignmentId: string; appointmentId: string;
  initial: RemnantReportData | null; suggestedMaterials: MaterialMovement[];
  onSaved: (report: RemnantReportData) => void;
  demoMode?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [noRemnant, setNoRemnant] = useState(false);
  const [materials, setMaterials] = useState<MaterialMovement[]>([]);
  const [pieces, setPieces] = useState<PieceDraft[]>([{ ...EMPTY_PIECE }]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const piecesRef = useRef(pieces);
  useEffect(() => { piecesRef.current = pieces; }, [pieces]);
  useEffect(() => () => { if (!demoMode) piecesRef.current.forEach((piece) => piece.localPhotos.forEach((photo) => URL.revokeObjectURL(photo.url))); }, [demoMode]);

  useEffect(() => {
    const loadedPieces = (initial?.pieces ?? []).map((piece) => ({ ...piece, note: piece.note ?? "", localPhotos: [] }));
    setNoRemnant(Boolean(initial?.noRemnant));
    setMaterials(initial?.materials?.length ? initial.materials : suggestedMaterials);
    setPieces(loadedPieces.length ? loadedPieces : [{ ...EMPTY_PIECE }]);
    setNotes(initial?.notes ?? "");
  }, [initial, suggestedMaterials]);

  const locked = initial?.status === "accepted";
  function updateMaterial(index: number, patch: Partial<MaterialMovement>) {
    setMaterials((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  function updatePiece(index: number, patch: Partial<PieceDraft>) {
    setPieces((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  function addPhotos(index: number, files: FileList | null) {
    const added = Array.from(files ?? []).filter((file) => file.type.startsWith("image/")).map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    updatePiece(index, { localPhotos: [...pieces[index].localPhotos, ...added] });
  }
  function removeLocalPhoto(pieceIndex: number, id: string) {
    const photo = pieces[pieceIndex].localPhotos.find((item) => item.id === id); if (photo) URL.revokeObjectURL(photo.url);
    updatePiece(pieceIndex, { localPhotos: pieces[pieceIndex].localPhotos.filter((item) => item.id !== id) });
  }
  function removeStoredPhoto(pieceIndex: number, path: string) {
    updatePiece(pieceIndex, { photoPaths: pieces[pieceIndex].photoPaths.filter((item) => item !== path) });
  }

  async function submit() {
    setError(null);
    if (!noRemnant) {
      if (!pieces.length) { setError("กรุณาเพิ่มรายการเศษ หรือเลือก “ไม่มีเศษเหลือ”"); return; }
      for (const piece of pieces) {
        if (!piece.lengthCm || Number(piece.lengthCm) <= 0 || !piece.qty || Number(piece.qty) <= 0) { setError("กรุณากรอกความยาวและจำนวนของเศษทุกรายการ"); return; }
        if (!piece.photoPaths.length && !piece.localPhotos.length) { setError("เศษแต่ละรายการต้องมีรูปอย่างน้อย 1 รูป"); return; }
      }
    }
    setSaving(true);
    const uploaded: string[] = [];
    try {
      const payloadPieces: RemnantReportPiece[] = [];
      for (let pieceIndex = 0; pieceIndex < (noRemnant ? 0 : pieces.length); pieceIndex++) {
        const piece = pieces[pieceIndex]; const photoPaths = [...piece.photoPaths];
        if (demoMode) {
          payloadPieces.push({ widthCm: piece.widthCm, lengthCm: piece.lengthCm, qty: piece.qty, thickness: piece.thickness, color: piece.color, note: piece.note, photoPaths: [...photoPaths, ...piece.localPhotos.map((photo) => photo.url)] });
          continue;
        }
        for (let photoIndex = 0; photoIndex < piece.localPhotos.length; photoIndex++) {
          const photo = piece.localPhotos[photoIndex]; const safe = photo.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `remnants/${appointmentId}/${Date.now()}-${pieceIndex}-${photoIndex}-${safe}`;
          const { error: uploadError } = await supabase.storage.from("job-photos").upload(path, photo.file, { upsert: false, contentType: photo.file.type || "image/jpeg" });
          if (uploadError) throw uploadError; photoPaths.push(path); uploaded.push(path);
        }
        payloadPieces.push({ widthCm: piece.widthCm, lengthCm: piece.lengthCm, qty: piece.qty, thickness: piece.thickness, color: piece.color, note: piece.note, photoPaths });
      }
      const cleanMaterials = materials.filter((item) => Number(item.lengthCm) > 0 && Number(item.qty) > 0);
      if (demoMode) {
        onSaved({ exists: true, isLead: true, status: "pending_review", noRemnant, materials: cleanMaterials, notes, pieces: payloadPieces, submittedAt: new Date().toISOString() });
        setSaving(false);
        return;
      }
      const { data, error: rpcError } = await supabase.rpc("save_technician_remnant_report", {
        p_token: token, p_pin: pin, p_assignment_id: assignmentId, p_no_remnant: noRemnant,
        p_materials: cleanMaterials, p_pieces: payloadPieces, p_notes: notes.trim() || null,
      });
      if (rpcError) throw rpcError;
      pieces.forEach((piece) => piece.localPhotos.forEach((photo) => URL.revokeObjectURL(photo.url)));
      const report: RemnantReportData = { exists: true, isLead: true, ...(data as object), noRemnant, materials: cleanMaterials, notes, pieces: payloadPieces, submittedAt: new Date().toISOString() } as RemnantReportData;
      setPieces(payloadPieces.length ? payloadPieces.map((piece) => ({ ...piece, localPhotos: [] })) : [{ ...EMPTY_PIECE }]);
      onSaved(report);
    } catch (caught) {
      if (uploaded.length) await supabase.storage.from("job-photos").remove(uploaded);
      const message = caught && typeof caught === "object" && "message" in caught ? String(caught.message) : "";
      setError(message.includes("remnant photo") ? "เศษแต่ละรายการต้องมีรูปอย่างน้อย 1 รูป" : message.includes("lead technician") ? "เฉพาะหัวหน้าทีมที่รับผิดชอบหลักเท่านั้นที่บันทึกเศษได้" : `บันทึกรายงานเศษไม่สำเร็จ${message ? `: ${message}` : ""}`);
    }
    setSaving(false);
  }

  return <div className="space-y-4">
    {initial?.status === "pending_review" ? <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">ส่งให้คลังตรวจรับแล้ว · แก้ไขและส่งใหม่ได้จนกว่าคลังจะรับ</div> : null}
    {initial?.status === "accepted" ? <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ คลังตรวจรับแล้ว เศษถูกเพิ่มเข้าสต็อกพร้อมใช้</div> : null}
    {initial?.status === "rejected" ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">คลังส่งกลับให้แก้ไข: {initial.reviewNote || "ไม่ระบุเหตุผล"}</div> : null}

    <div>
      <div className="text-sm font-semibold text-slate-900">1. วัสดุที่นำไปใช้หน้างาน</div>
      <p className="mt-0.5 text-xs text-slate-500">ระบบเติมจากใบสั่งงานให้เท่าที่พบ ตรวจความยาวและจำนวนก่อนบันทึก</p>
      <div className="mt-2 space-y-2">{materials.map((item, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-6">
        <select disabled={locked} value={item.thickness} onChange={(e) => updateMaterial(index,{thickness:e.target.value})} className="rounded-lg border px-2 py-2 text-xs"><option value="16">หนา 16 มม.</option><option value="6">หนา 6 มม.</option></select>
        <select disabled={locked} value={item.color} onChange={(e) => updateMaterial(index,{color:e.target.value})} className="rounded-lg border px-2 py-2 text-xs"><option value="B">สี B</option><option value="W">สี W</option></select>
        <select disabled={locked} value={item.widthCm} onChange={(e) => updateMaterial(index,{widthCm:e.target.value})} className="rounded-lg border px-2 py-2 text-xs"><option value="110">กว้าง 110 ซม.</option><option value="140">กว้าง 140 ซม.</option></select>
        <input disabled={locked} type="number" min="0" step="0.1" value={item.lengthCm} onChange={(e) => updateMaterial(index,{lengthCm:e.target.value})} placeholder="ยาว (ซม.)" className="rounded-lg border px-2 py-2 text-xs" />
        <input disabled={locked} type="number" min="1" step="1" value={item.qty} onChange={(e) => updateMaterial(index,{qty:e.target.value})} placeholder="จำนวน" className="rounded-lg border px-2 py-2 text-xs" />
        {!locked ? <button type="button" onClick={() => setMaterials((rows) => rows.filter((_,i)=>i!==index))} className="rounded-lg bg-red-50 px-2 text-xs text-red-600">ลบ</button> : <span />}
      </div>)}</div>
      {!locked ? <button type="button" onClick={() => setMaterials((rows)=>[...rows,{...EMPTY_MATERIAL}])} className="mt-2 rounded-lg border border-dashed border-blue-300 px-3 py-2 text-xs font-medium text-blue-700">+ เพิ่มวัสดุที่นำไปใช้</button> : null}
    </div>

    <div className="border-t border-slate-200 pt-4">
      <div className="text-sm font-semibold text-slate-900">2. เศษที่เหลือจากการติดตั้ง</div>
      <label className="mt-2 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-3 text-sm font-medium text-slate-800"><input disabled={locked} type="checkbox" checked={noRemnant} onChange={(e)=>setNoRemnant(e.target.checked)} /> งานนี้ไม่มีเศษเหลือส่งกลับคลัง</label>
      {!noRemnant ? <div className="mt-3 space-y-3">{pieces.map((piece,index)=><div key={index} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-amber-950">เศษชิ้นที่ {index+1}</span>{!locked && pieces.length>1?<button type="button" onClick={()=>setPieces((rows)=>rows.filter((_,i)=>i!==index))} className="text-xs text-red-600">ลบรายการ</button>:null}</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] font-medium text-amber-900">ชนิดเศษ<select disabled={locked} value={`${piece.thickness}${piece.color}`} onChange={(e)=>updatePiece(index,{thickness:e.target.value.slice(0,-1),color:e.target.value.slice(-1)})} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-2 text-sm"><option value="16B">หนา 16 มม. · สี B</option><option value="16W">หนา 16 มม. · สี W</option><option value="6B">หนา 6 มม. · สี B</option><option value="6W">หนา 6 มม. · สี W</option></select></label>
          <label className="text-[11px] font-medium text-amber-900">ความกว้าง<select disabled={locked} value={piece.widthCm} onChange={(e)=>updatePiece(index,{widthCm:e.target.value})} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-2 text-sm"><option value="110">RS-110</option><option value="140">RS-140</option></select></label>
          <label className="text-[11px] font-medium text-amber-900">ความยาว (ซม.)<input disabled={locked} type="number" min="0.1" step="0.1" value={piece.lengthCm} onChange={(e)=>updatePiece(index,{lengthCm:e.target.value})} placeholder="เช่น 80" className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" /></label>
          <label className="text-[11px] font-medium text-amber-900">จำนวนชิ้น<input disabled={locked} type="number" min="1" step="1" value={piece.qty} onChange={(e)=>updatePiece(index,{qty:e.target.value})} placeholder="เช่น 1" className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" /></label>
        </div>
        <input disabled={locked} value={piece.note} onChange={(e)=>updatePiece(index,{note:e.target.value})} placeholder="ตำหนิ / หมายเหตุของเศษ (ถ้ามี)" className="mt-2 w-full rounded-lg border px-3 py-2 text-xs" />
        {!locked?<label className="mt-2 block cursor-pointer rounded-lg border border-dashed border-amber-400 bg-white px-3 py-2 text-center text-xs font-medium text-amber-800">📷 ถ่ายรูปเศษ / เพิ่มรูป<input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e)=>{addPhotos(index,e.target.files);e.currentTarget.value="";}} /></label>:null}
        {(piece.photoPaths.length||piece.localPhotos.length)?<div className="mt-2 grid grid-cols-4 gap-2">{piece.photoPaths.map((path)=><div key={path} className="relative aspect-square overflow-hidden rounded-lg border bg-white"><img src={publicPhotoUrl(path,supabase)} alt="รูปเศษ" className="h-full w-full object-cover" />{!locked?<button type="button" onClick={()=>removeStoredPhoto(index,path)} className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-1 text-[9px] text-white">ลบ</button>:null}</div>)}{piece.localPhotos.map((photo)=><div key={photo.id} className="relative aspect-square overflow-hidden rounded-lg border bg-white"><img src={photo.url} alt="รูปเศษใหม่" className="h-full w-full object-cover" /><button type="button" onClick={()=>removeLocalPhoto(index,photo.id)} className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-1 text-[9px] text-white">ลบ</button></div>)}</div>:<div className="mt-2 text-xs text-amber-700">ต้องมีรูปเศษอย่างน้อย 1 รูป</div>}
      </div>)}{!locked?<button type="button" onClick={()=>setPieces((rows)=>[...rows,{...EMPTY_PIECE}])} className="w-full rounded-xl border border-dashed border-amber-400 py-2 text-xs font-semibold text-amber-800">+ เพิ่มเศษอีกชิ้น</button>:null}</div>:null}
    </div>
    <textarea disabled={locked} value={notes} onChange={(e)=>setNotes(e.target.value)} rows={2} placeholder="หมายเหตุรวมถึงคลัง (ถ้ามี)" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
    {error?<div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>:null}
    {!locked?<button type="button" onClick={()=>void submit()} disabled={saving} className="w-full rounded-xl bg-amber-600 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving?"กำลังส่งรายงาน…":"บันทึกและส่งให้คลังตรวจรับ"}</button>:null}
  </div>;
}
