import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Upload, Database } from "lucide-react";
import { useFeedback } from "../components/Feedback";
import { getAll, STORES } from "../services/db";
import {
  backupFileName,
  buildBackup,
  parseBackup,
  restoreBackup,
  saveBlob,
} from "../services/backup";

const LABELS = { employees: "personel", trips: "perjalanan dinas", drafts: "draft SPPD" };

async function readCounts() {
  const counts = {};
  for (const name of STORES) counts[name] = (await getAll(name)).length;
  return counts;
}

export default function Backup() {
  const { toast, confirm } = useFeedback();
  const inputRef = useRef(null);
  const [counts, setCounts] = useState(null);
  const [, setErrorState] = useState("");
  const [busy, setBusy] = useState(false);

  // Kesalahan ditampilkan sebagai notifikasi, sama seperti halaman lain.
  function setError(message) {
    setErrorState(message);
    if (message) toast.error(message);
  }

  async function refresh() {
    try {
      setCounts(await readCounts());
    } catch {
      setError("Data lokal tidak dapat dibaca. Pastikan browser mengizinkan penyimpanan situs.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleExport() {
    setError("");
    setBusy(true);

    try {
      const backup = await buildBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });

      saveBlob(blob, backupFileName());
      toast.success("Cadangan data berhasil diunduh.");
    } catch (err) {
      setError(err.message || "Gagal membuat cadangan.");
    } finally {
      setBusy(false);
    }
  }

  // Mode impor dipilih lewat tombol: "gabung" (aman) atau "ganti" (menghapus data lokal saat ini).
  const modeRef = useRef("gabung");

  function chooseFile(mode) {
    modeRef.current = mode;
    inputRef.current?.click();
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    const mode = modeRef.current;

    setError("");
    setBusy(true);

    try {
      const data = parseBackup(await file.text());
      const summary = Object.entries(data)
        .map(([name, list]) => `${list.length} ${LABELS[name]}`)
        .join(", ");

      const confirmed =
        mode === "ganti"
          ? await confirm({
              title: "Ganti seluruh data?",
              message: `Berkas berisi ${summary}. Seluruh data personel, perjalanan, dan draft di browser ini akan DIGANTI dengan isi berkas. Unduh cadangan terlebih dahulu bila data saat ini masih diperlukan.`,
              confirmLabel: "Ganti Semua Data",
              danger: true,
            })
          : await confirm({
              title: "Gabungkan cadangan?",
              message: `Berkas berisi ${summary}. Data dengan ID yang sama akan diperbarui; data lain di browser ini tetap dipertahankan.`,
              confirmLabel: "Gabungkan",
            });

      if (!confirmed) return;

      await restoreBackup(data, mode);
      toast.success(
        mode === "ganti"
          ? "Seluruh data berhasil diganti dengan cadangan."
          : "Cadangan berhasil digabungkan."
      );
      await refresh();
    } catch (err) {
      setError(err.message || "Gagal mengimpor cadangan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>CADANGAN DATA</h1>
        <p>
          Data personel, perjalanan dinas, dan draft disimpan di browser ini (IndexedDB). Unduh
          cadangan secara berkala agar data aman bila data browser terhapus atau berpindah komputer.
        </p>
      </header>

      <div className="backup-grid">
        <section className="card">
          <div className="card-title">
            <h2>
              <Database size={18} /> Data tersimpan di browser ini
            </h2>
          </div>

          {counts ? (
            <ul className="backup-counts">
              {STORES.map((name) => (
                <li key={name}>
                  {counts[name]} {LABELS[name]}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <Loader2 size={16} className="spin" /> Memuat...
            </p>
          )}
        </section>

        <section className="card">
          <div className="card-title">
            <h2>Ekspor cadangan</h2>
            <p>Mengunduh seluruh data menjadi satu berkas JSON.</p>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={handleExport} disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <Download size={18} />}
              Unduh Cadangan (JSON)
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-title">
            <h2>Impor cadangan</h2>
            <p>
              Memulihkan data dari berkas JSON hasil ekspor. Anda dapat memilih menggabungkan atau
              mengganti seluruh data.
            </p>
          </div>
          <div className="actions">
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImport}
              hidden
            />
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => chooseFile("gabung")}
              disabled={busy}
            >
              <Upload size={18} />
              Impor &amp; Gabungkan
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => chooseFile("ganti")}
              disabled={busy}
            >
              <Upload size={18} />
              Impor &amp; Ganti Semua Data
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
