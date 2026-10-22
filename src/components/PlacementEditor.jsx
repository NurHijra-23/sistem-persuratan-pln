import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { buildCombinedPdf } from "../services/pdf/combinedPdf";
import { MM_TO_PT, SLOT_PAGE, slotRect } from "../services/pdf/placement";
import { SIGNATURE_SLOTS } from "../services/signatures";

// Halaman contoh (tanpa tanda tangan) hanya untuk mengatur posisi; tidak disimpan.
const SAMPLE_ITEMS = [
  {
    tanggalSurat: "10 September 2026",
    perihal: "Permohonan",
    subPerihal: "Pemeliharaan ULTG Parepare",
    penerima: "Manager PLN Tarakan Regional Sulawesi 2",
    namaPegawai: "KARYAWAN CONTOH",
    maksud: "Contoh pengaturan posisi tanda tangan dan paraf",
    tujuan: "Parepare - Polmas",
    durasi: "03",
    durasiTerbilang: "Tiga",
    tanggalBerangkat: "10 September 2026",
    tanggalKembali: "12 September 2026",
    namaManajer: "SAMSU ALAM",
  },
];

const SAMPLE_TRIPS = [
  {
    employeeName: "KARYAWAN CONTOH",
    destination: "Parepare - Polmas",
    purpose: "Contoh pengaturan posisi tanda tangan dan paraf",
    startDate: "2026-09-10",
    endDate: "2026-09-12",
    position: "Tenaga Pemeliharaan ULTG Parepare",
  },
];

const DISPLAY_WIDTH = 640; // px lebar halaman di editor
const round1 = (value) => Math.round(value * 10) / 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Editor posisi langsung: geser gambar dengan mouse/jari, tarik sudut kanan-bawah untuk mengubah
// ukuran, atau gunakan tombol panah (0,5 mm; Shift = 2 mm). Perubahan tersimpan otomatis.
export default function PlacementEditor({ settings, onPatchSlot, sampleEmployee }) {
  const [state, setState] = useState({ loading: true, error: "", pages: [] });
  const dragRef = useRef(null);

  const load = useCallback(async () => {
    setState({ loading: true, error: "", pages: [] });

    try {
      const result = await buildCombinedPdf({ items: SAMPLE_ITEMS, trips: SAMPLE_TRIPS, signatures: null });
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
      const { default: workerUrl } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

      const doc = await pdfjs.getDocument({ data: result.bytes.slice() }).promise;
      const pages = [];

      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (DISPLAY_WIDTH * 1.5) / base.width });
        const canvas = document.createElement("canvas");

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

        pages.push({ ...result.layouts[n - 1], src: canvas.toDataURL("image/jpeg", 0.88) });
      }

      setState({ loading: false, error: "", pages });
    } catch (error) {
      console.error("Editor posisi gagal dimuat:", error);
      setState({ loading: false, error: error.message || "Halaman contoh gagal dibuat.", pages: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startDrag(event, key, mode, rect, scale) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const slot = settings.slots[key];
    dragRef.current = { key, mode, scale, x: event.clientX, y: event.clientY, slot, rect };
  }

  function moveDrag(event) {
    const drag = dragRef.current;
    if (!drag) return;

    const mmX = (event.clientX - drag.x) / drag.scale / MM_TO_PT;
    const mmY = (event.clientY - drag.y) / drag.scale / MM_TO_PT;

    if (drag.mode === "move") {
      onPatchSlot(drag.key, {
        offsetXMm: round1(clamp((Number(drag.slot.offsetXMm) || 0) + mmX, -60, 60)),
        offsetYMm: round1(clamp((Number(drag.slot.offsetYMm) || 0) + mmY, -60, 60)),
      });
    } else {
      // Lebar dihitung dari lebar yang tampil saat ini (bisa lebih kecil dari pengaturan bila dibatasi otomatis).
      const startWidthMm = drag.rect.width / MM_TO_PT;
      onPatchSlot(drag.key, { widthMm: round1(clamp(startWidthMm + mmX, 3, 120)) });
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  function nudge(event, key) {
    const step = event.shiftKey ? 2 : 0.5;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];

    if (!move) return;

    event.preventDefault();
    const slot = settings.slots[key];
    onPatchSlot(key, {
      offsetXMm: round1(clamp((Number(slot.offsetXMm) || 0) + move[0], -60, 60)),
      offsetYMm: round1(clamp((Number(slot.offsetYMm) || 0) + move[1], -60, 60)),
    });
  }

  return (
    <div className="pe-root">
      <div className="pe-toolbar">
        <p className="hint">
          Seret gambar ke posisi yang diinginkan, tarik kotak kecil di sudut kanan-bawah untuk mengubah ukuran
          (atau pilih gambar lalu pakai tombol panah). Kotak putus-putus berlabel adalah penanda posisi untuk slot
          yang belum ada gambarnya.
        </p>
        <button type="button" className="btn btn-outline btn-sm" onClick={load} disabled={state.loading}>
          {state.loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Muat ulang halaman contoh
        </button>
      </div>

      {state.loading && (
        <p className="docx-preview-status">
          <Loader2 size={16} className="spin" /> Menyiapkan halaman contoh...
        </p>
      )}
      {state.error && <p className="docx-preview-status error">{state.error}</p>}

      <div className="pe-pages">
        {state.pages.map((page, pageIndex) => {
          const scale = DISPLAY_WIDTH / page.widthPt;
          const slots = SIGNATURE_SLOTS.filter((def) => SLOT_PAGE[def.key] === page.kind);

          return (
            <div key={pageIndex} className="pe-page-wrap">
              <p className="combined-page-label">
                {page.kind === "form" ? "Formulir perhitungan" : "Surat SPPD"}
              </p>
              <div className="pe-page" style={{ width: DISPLAY_WIDTH, height: page.heightPt * scale }} data-testid={`pe-page-${page.kind}`}>
                <img src={page.src} alt={page.kind === "form" ? "Formulir contoh" : "Surat contoh"} draggable={false} />

                {slots.map((def) => {
                  const slot = settings.slots[def.key];
                  if (!slot || !slot.enabled) return null;

                  const image = def.key === "employee" ? sampleEmployee?.dataUrl : slot.dataUrl;
                  const ratio = def.key === "employee" ? sampleEmployee?.ratio || 0.4 : slot.dataUrl ? slot.ratio : 0.4;
                  const rect = slotRect(def.key, slot, page.layout, { avoidText: settings.avoidText, ratio });

                  if (!rect) return null;

                  return (
                    <div
                      key={def.key}
                      className={`pe-slot${image ? "" : " pe-empty"}${rect.capped ? " pe-capped" : ""}`}
                      style={{ left: rect.left * scale, top: rect.top * scale, width: rect.width * scale, height: rect.height * scale }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Atur posisi ${def.label}`}
                      data-testid={`pe-slot-${def.key}`}
                      title={rect.capped ? `${def.label} (ukuran dibatasi otomatis agar tidak menutupi teks)` : def.label}
                      onPointerDown={(event) => startDrag(event, def.key, "move", rect, scale)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(event) => nudge(event, def.key)}
                    >
                      {image ? <img src={image} alt="" draggable={false} /> : <span>{def.key === "employee" ? "TTD karyawan" : def.key === "manager" ? "TTD manajer" : `Paraf ${def.key.slice(-1)}`}</span>}
                      <i
                        className="pe-handle"
                        data-testid={`pe-handle-${def.key}`}
                        onPointerDown={(event) => startDrag(event, def.key, "resize", rect, scale)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
