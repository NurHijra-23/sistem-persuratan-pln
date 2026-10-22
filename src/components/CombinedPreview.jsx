import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";

import { buildCombinedPdf } from "../services/pdf/combinedPdf";
import { loadSignatureSettings } from "../services/signatures";
import { saveBlob } from "../services/backup";

// Tinjau Gabungan: membuat PDF gabungan (surat + formulir tiap perjalanan, dengan tanda tangan/paraf
// yang tersimpan) lalu menampilkan halaman PDF itu sendiri. File yang diunduh dari sini adalah
// byte yang sama dengan yang ditampilkan.
export default function CombinedPreview({ items, trips, employeeImages, fileName, title = "Tinjau Gabungan", onClose }) {
  const [state, setState] = useState({ loading: true, error: "", result: null });
  const pagesRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const signatures = await loadSignatureSettings();
        const result = await buildCombinedPdf({ items, trips, signatures, employeeImages });

        if (cancelled) return;

        // Tampilkan halaman PDF hasil akhir (pdf.js, build "legacy" agar jalan di browser lebih lama).
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
        const { default: workerUrl } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const doc = await pdfjs.getDocument({ data: result.bytes.slice() }).promise;
        const host = pagesRef.current;

        if (cancelled || !host) return;

        host.innerHTML = "";
        const ratio = Math.min(2, window.devicePixelRatio || 1);

        for (let number = 1; number <= doc.numPages; number++) {
          const page = await doc.getPage(number);
          const viewport = page.getViewport({ scale: 1.4 * ratio });
          const canvas = document.createElement("canvas");

          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "combined-page";
          canvas.dataset.kind = result.order[number - 1] || "";
          canvas.setAttribute("aria-label", `Halaman ${number} dari ${doc.numPages}`);

          const label = document.createElement("p");
          label.className = "combined-page-label";
          label.textContent = `Halaman ${number} — ${result.order[number - 1] === "form" ? "Formulir perhitungan" : "Surat SPPD"}`;

          host.append(label, canvas);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        }

        if (!cancelled) setState({ loading: false, error: "", result });
      } catch (error) {
        console.error("Tinjau gabungan gagal:", error);
        if (!cancelled) setState({ loading: false, error: error.message || "Gagal membuat pratinjau gabungan.", result: null });
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [items, trips, employeeImages]);

  const { loading, error, result } = state;

  return (
    <div className="combined-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="combined-modal">
        <header className="combined-header">
          <div>
            <h2>{title}</h2>
            <p>
              {result
                ? `${result.pageCount} halaman: urutan surat lalu formulir untuk setiap perjalanan. Tampilan ini adalah PDF yang akan diunduh.`
                : "Menyiapkan PDF gabungan..."}
            </p>
          </div>

          <div className="combined-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!result}
              onClick={() => saveBlob(new Blob([result.bytes], { type: "application/pdf" }), fileName)}
            >
              <Download size={16} /> Unduh PDF
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              <X size={16} /> Tutup
            </button>
          </div>
        </header>

        {loading && (
          <p className="docx-preview-status">
            <Loader2 size={16} className="spin" /> Membuat PDF gabungan (bisa beberapa detik)...
          </p>
        )}
        {error && <p className="docx-preview-status error">{error}</p>}
        {result?.warnings?.length > 0 && (
          <p className="docx-preview-status error" role="alert">
            {result.warnings.join(" ")}
          </p>
        )}

        <div ref={pagesRef} className="combined-pages" />
      </div>
    </div>
  );
}
