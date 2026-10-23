import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ImagePlus, Loader2, Undo2, X } from "lucide-react";

import { DEFAULT_TOLERANCE, removeBackground } from "../services/imageBackground";
import { dataUrlToPixels, drawPixels, pixelsToDataUrl } from "../services/imageIo";
import { readSignatureFile } from "../services/signatures";

const METHOD_LABEL = {
  auto: "Otomatis (disarankan)",
  plain: "Latar polos / putih",
  edge: "Latar berwarna / tidak rata (dari tepi)",
  none: "Jangan hapus latar",
};

const BACKDROPS = [
  ["checker", "Kotak-kotak"],
  ["white", "Putih"],
  ["dark", "Gelap"],
  ["pink", "Merah muda"],
];

// Dialog penghapusan latar: perbandingan gambar asli dan hasil, kontrol metode/toleransi, lalu
// terima hasil, pakai gambar asli, unggah ulang, atau batal. Penghapusan otomatis tidak selalu
// sempurna, jadi pengguna selalu dapat memeriksa hasilnya dan tetap memakai gambar asli.
//
// source: { dataUrl, fileName }   onAccept / onUseOriginal menerima { dataUrl, ratio, fileName }
export default function BackgroundRemovalDialog({ source, title, onAccept, onUseOriginal, onReupload, onCancel }) {
  const [pixels, setPixels] = useState(null);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("auto");
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [includeEnclosed, setIncludeEnclosed] = useState(false);
  const [trim, setTrim] = useState(true);
  const [backdrop, setBackdrop] = useState("checker");
  const [working, setWorking] = useState(false);
  const originalRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    // Dialog dibuat ulang (key) setiap gambar sumber berganti, jadi state awal selalu bersih.
    dataUrlToPixels(source.dataUrl)
      .then((value) => !cancelled && setPixels(value))
      .catch((reason) => !cancelled && setError(reason.message || "Gambar tidak dapat dibaca."));

    return () => {
      cancelled = true;
    };
  }, [source.dataUrl]);

  // Hitung ulang hasil setelah pengaturan berubah (ditunda sedikit agar geser slider tetap ringan).
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    if (!pixels) return undefined;

    const timer = window.setTimeout(() => {
      setWorking(true);

      try {
        setOutcome(removeBackground(pixels, { method, tolerance, includeEnclosed, trim }));
        setError("");
      } catch (reason) {
        console.error("Penghapusan latar gagal:", reason);
        setError("Penghapusan latar gagal diproses. Anda tetap dapat memakai gambar asli.");
      } finally {
        setWorking(false);
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [pixels, method, tolerance, includeEnclosed, trim]);

  useEffect(() => {
    if (pixels && originalRef.current) drawPixels(originalRef.current, pixels);
  }, [pixels]);

  useEffect(() => {
    if (outcome && resultRef.current) drawPixels(resultRef.current, outcome.image);
  }, [outcome]);

  const stats = outcome?.stats;
  const ratio = useMemo(() => (outcome ? outcome.image.height / outcome.image.width : 1), [outcome]);

  function accept() {
    if (!outcome) return;

    onAccept({
      dataUrl: outcome.method === "none" && !trim ? source.dataUrl : pixelsToDataUrl(outcome.image),
      ratio,
      fileName: source.fileName,
    });
  }

  async function reupload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    try {
      onReupload(await readSignatureFile(file));
    } catch (reason) {
      setError(reason.message || "Gambar tidak dapat dibaca.");
    }
  }

  const effectiveMethod = outcome?.method || method;

  return (
    <div className="combined-overlay" role="dialog" aria-modal="true" aria-label={`Hapus latar ${title}`}>
      <div className="combined-modal bg-dialog">
        <header className="combined-header">
          <div>
            <h2>Hapus latar: {title}</h2>
            <p>
              Latar putih atau polos diubah menjadi transparan agar hanya tinta/warna yang menempel di dokumen.
              Hasil otomatis tidak selalu sempurna: periksa di bawah, lalu terima hasilnya atau pakai gambar asli.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            <X size={16} /> Batal
          </button>
        </header>

        <div className="bg-body">
          <div className="bg-compare">
            <figure>
              <figcaption>Gambar asli</figcaption>
              <div className="bg-stage bg-stage-white">
                {pixels ? <canvas ref={originalRef} data-testid="bg-original" /> : <Loader2 size={20} className="spin" />}
              </div>
            </figure>
            <figure>
              <figcaption>
                Hasil penghapusan latar {working && <Loader2 size={14} className="spin" aria-label="Memproses" />}
              </figcaption>
              <div className={`bg-stage bg-stage-${backdrop}`}>
                {outcome ? <canvas ref={resultRef} data-testid="bg-result" /> : <Loader2 size={20} className="spin" />}
              </div>
            </figure>
          </div>

          <div className="bg-controls">
            <label>
              Metode
              <select className="input" value={method} onChange={(event) => setMethod(event.target.value)} data-testid="bg-method">
                {Object.entries(METHOD_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {method === "auto" && outcome && <span className="hint">Terpilih otomatis: {METHOD_LABEL[effectiveMethod]}</span>}
            </label>

            <label>
              Toleransi latar: {tolerance}
              <input
                type="range"
                min="5"
                max="120"
                value={tolerance}
                onChange={(event) => setTolerance(Number(event.target.value))}
                disabled={effectiveMethod === "none"}
                data-testid="bg-tolerance"
              />
              <span className="hint">Makin tinggi, makin banyak warna mirip latar yang dihapus (garis tipis/pucat bisa ikut hilang).</span>
            </label>

            <label>
              Latar uji hasil
              <select className="input" value={backdrop} onChange={(event) => setBackdrop(event.target.value)}>
                {BACKDROPS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="bg-checks">
              {effectiveMethod === "edge" && (
                <label className="sig-toggle">
                  <input type="checkbox" checked={includeEnclosed} onChange={(event) => setIncludeEnclosed(event.target.checked)} />
                  Hapus juga area tertutup (mis. bagian dalam lingkaran stempel)
                </label>
              )}
              <label className="sig-toggle">
                <input type="checkbox" checked={trim} onChange={(event) => setTrim(event.target.checked)} data-testid="bg-trim" />
                Pangkas tepi kosong di sekeliling gambar
              </label>
            </div>
          </div>

          {stats && (
            <p className="bg-stats" data-testid="bg-stats">
              Piksel transparan: <strong>{(stats.transparentRatio * 100).toFixed(0)}%</strong>
              {stats.inkRetention !== null && (
                <>
                  {" "}
                  ?? Tinta/warna jelas yang tetap utuh: <strong>{(stats.inkRetention * 100).toFixed(0)}%</strong>
                </>
              )}
              {outcome.trimmed && " ?? tepi kosong dipangkas"}
            </p>
          )}

          {outcome?.warnings.length > 0 && (
            <ul className="bg-warnings" role="status" data-testid="bg-warnings">
              {outcome.warnings.map((text) => (
                <li key={text}>
                  <AlertTriangle size={14} aria-hidden="true" /> {text}
                </li>
              ))}
            </ul>
          )}

          {error && <p className="docx-preview-status error">{error}</p>}
        </div>

        <footer className="bg-footer">
          <button type="button" className="btn btn-primary" onClick={accept} disabled={!outcome || working} data-testid="bg-accept">
            <Check size={18} /> Pakai hasil ini
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onUseOriginal({ dataUrl: source.dataUrl, ratio: pixels ? pixels.height / pixels.width : 1, fileName: source.fileName })}
            disabled={!pixels}
            data-testid="bg-original-use"
          >
            <Undo2 size={18} /> Pakai gambar asli
          </button>
          <label className="btn btn-outline" style={{ cursor: "pointer" }}>
            <ImagePlus size={18} /> Unggah ulang
            <input type="file" accept="image/png,image/jpeg" hidden data-testid="bg-reupload" onChange={reupload} />
          </label>
        </footer>
      </div>
    </div>
  );
}
