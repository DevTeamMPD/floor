"use client";

import { useEffect, useState } from "react";

export function ImageLightbox({ images, label, renderTrigger }: { images: string[]; label: string; renderTrigger: (open: (index: number) => void) => React.ReactNode }) {
  const [index, setIndex] = useState<number | null>(null);
  const close = () => setIndex(null);
  const go = (step: number) => setIndex((current) => current === null ? null : (current + step + images.length) % images.length);
  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); if (event.key === "ArrowLeft") go(-1); if (event.key === "ArrowRight") go(1); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length]);
  return <>{renderTrigger((nextIndex) => setIndex(nextIndex))}{index !== null ? <div role="dialog" aria-modal="true" aria-label={`${label} รูปที่ ${index + 1}`} className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="flex h-full w-full max-w-6xl flex-col"><div className="flex items-center justify-between pb-3 text-white"><div className="text-sm font-medium">{label} · {index + 1} / {images.length}</div><button type="button" onClick={close} className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25">ปิด ×</button></div><div className="relative flex min-h-0 flex-1 items-center justify-center"><img src={images[index]} alt={`${label} รูปที่ ${index + 1}`} className="max-h-full max-w-full rounded-xl object-contain" />{images.length > 1 ? <><button type="button" onClick={() => go(-1)} aria-label="รูปก่อนหน้า" className="absolute left-1 rounded-full bg-black/55 px-4 py-3 text-2xl text-white hover:bg-black/75 sm:left-4">‹</button><button type="button" onClick={() => go(1)} aria-label="รูปถัดไป" className="absolute right-1 rounded-full bg-black/55 px-4 py-3 text-2xl text-white hover:bg-black/75 sm:right-4">›</button></> : null}</div>{images.length > 1 ? <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{images.map((url, itemIndex) => <button type="button" key={`${url}-${itemIndex}`} onClick={() => setIndex(itemIndex)} aria-label={`ดูรูปที่ ${itemIndex + 1}`} className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${itemIndex === index ? "border-white" : "border-transparent opacity-60"}`}><img src={url} alt="" className="h-full w-full object-cover" /></button>)}</div> : null}</div></div> : null}</>;
}
