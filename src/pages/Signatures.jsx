import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Eraser, Eye, EyeOff, ImagePlus, Loader2, PenLine, RotateCcw, Trash2, Users } from "lucide-react";

import { useFeedback } from "../components/Feedback";
import BackgroundRemovalDialog from "../components/BackgroundRemovalDialog";
import CombinedPreview from "../components/CombinedPreview";
import PlacementEditor from "../components/PlacementEditor";
import { apiFetch } from "../services/localApi";
import {
  SIGNATURE_SLOTS,
  loadEmployeeSignatures,
  loadSignatureSettings,
  readSignatureFile,
  saveEmployeeSignatures,
  saveSignatureSettings,
} from "../services/signatures";

// Data contoh hanya untuk menguji penempatan; tidak disimpan dan tidak dipakai untuk dokumen asli.
const SAMPLE_ITEMS = [
  {
    tanggalSurat: "10 September 2026",
    perihal: "Permohonan",
    subPerihal: "Pemeliharaan ULTG Parepare",
    penerima: "Manager PLN Tarakan Regional Sulawesi 2",
    namaPegawai: "KARYAWAN CONTOH",
    maksud: "Contoh pengujian penempatan tanda tangan dan paraf",
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
    purpose: "Contoh pengujian penempatan tanda tangan dan paraf",
    startDate: "2026-09-10",
    endDate: "2026-09-12",
    position: "Tenaga Pemeliharaan ULTG Parepare",
  },
];

export default function Signatures() {
  const { toast, confirm } = useFeedback();
  const [settings, setSettings] = useState(null);
  const [saveState, setSaveState] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [preview, setPreview] = useState(false);
  // Dialog hapus latar: { kind: "slot" | "employee", key?, employee?, title, source: { dataUrl, fileName } }
  const [bgTarget, setBgTarget] = useState(null);
  const loadedRef = useRef(false);
  const timerRef = useRef(null);
  const [employees, setEmployees] = useState([]);
  const [empSigs, setEmpSigs] = useState(null);
  const empLoadedRef = useRef(false);
  const empTimerRef = useRef(null);

  useEffect(() => {
    loadSignatureSettings()
      .then((value) => {
        setSettings(value);
        loadedRef.current = true;
      })
      .catch(() => toast.error("Pengaturan tanda tangan tidak dapat dimuat dari penyimpanan browser."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Daftar karyawan + tanda tangan per karyawan.
  useEffect(() => {
    apiFetch("/employees")
      .then((response) => (response.ok ? response.json() : []))
      .then(setEmployees)
      .catch(() => {});

    loadEmployeeSignatures()
      .then((doc) => {
        setEmpSigs(doc);
        empLoadedRef.current = true;
      })
      .catch(() => toast.error("Tanda tangan karyawan tidak dapat dimuat dari penyimpanan browser."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!empSigs || !empLoadedRef.current) return undefined;

    window.clearTimeout(empTimerRef.current);
    empTimerRef.current = window.setTimeout(() => {
      saveEmployeeSignatures(empSigs).catch(() => toast.error("Tanda tangan karyawan gagal disimpan."));
    }, 500);

    return () => window.clearTimeout(empTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empSigs]);

  // Simpan otomatis ke IndexedDB setelah perubahan (ditunda sebentar agar tidak menulis berulang).
  useEffect(() => {
    if (!settings || !loadedRef.current) return undefined;

    setSaveState("saving");
    window.clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(() => {
      saveSignatureSettings(settings)
        .then(() => setSaveState("saved"))
        .catch(() => {
          setSaveState("");
          toast.error("Pengaturan tanda tangan gagal disimpan.");
        });
    }, 500);

    return () => window.clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // Mengubah lebar (angka, seret handle, tombol +/-) menandai ukuran sebagai manual: sejak itu ukuran
  // dipakai persis dan tidak dibatasi otomatis. "Ukuran otomatis" mengembalikannya.
  function patchSlot(key, patch) {
    const next = "widthMm" in patch && !("sizeManual" in patch) ? { ...patch, sizeManual: true } : patch;

    setSettings((current) => ({
      ...current,
      slots: { ...current.slots, [key]: { ...current.slots[key], ...next } },
    }));
  }

  async function handleFile(key, event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setBusyKey(key);

    try {
      const image = await readSignatureFile(file);
      const def = SIGNATURE_SLOTS.find((item) => item.key === key);
      setBgTarget({ kind: "slot", key, title: def?.label || key, source: image });
    } catch (error) {
      toast.error(error.message || "Gambar tidak dapat dibaca.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleEmployeeFile(employee, event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setBusyKey(`emp-${employee.id}`);

    try {
      const image = await readSignatureFile(file);
      setBgTarget({ kind: "employee", employee, title: `tanda tangan ${employee.name}`, source: image });
    } catch (error) {
      toast.error(error.message || "Gambar tidak dapat dibaca.");
    } finally {
      setBusyKey("");
    }
  }

  // Hasil dialog hapus latar (hasil, atau gambar asli) disimpan ke slot/karyawan yang dituju.
  function applyBgResult(image, { removed }) {
    const target = bgTarget;

    setBgTarget(null);

    if (!target) return;

    if (target.kind === "slot") {
      patchSlot(target.key, { dataUrl: image.dataUrl, ratio: image.ratio, fileName: image.fileName, enabled: true });
    } else {
      setEmpSigs((current) => ({
        ...current,
        items: {
          ...current.items,
          [target.employee.id]: { dataUrl: image.dataUrl, ratio: image.ratio, fileName: image.fileName, updatedAt: new Date().toISOString() },
        },
      }));
    }

    toast.success(
      removed
        ? "Gambar dengan latar transparan disimpan. Pengaturan tersimpan otomatis."
        : "Gambar asli disimpan tanpa penghapusan latar. Pengaturan tersimpan otomatis."
    );
  }

  async function handleEmployeeRemove(employee) {
    const confirmed = await confirm({
      title: "Hapus tanda tangan karyawan?",
      message: `Hapus tanda tangan ${employee.name}?`,
      confirmLabel: "Hapus",
      danger: true,
    });

    if (!confirmed) return;

    setEmpSigs((current) => {
      const items = { ...current.items };
      delete items[employee.id];
      return { ...current, items };
    });
  }

  async function handleRemove(def) {
    const confirmed = await confirm({
      title: "Hapus gambar?",
      message: `Hapus gambar untuk "${def.label}"? Pengaturan ukuran dan posisi tetap tersimpan.`,
      confirmLabel: "Hapus Gambar",
      danger: true,
    });

    if (confirmed) patchSlot(def.key, { dataUrl: "", fileName: "", ratio: 1 });
  }

  if (!settings || !empSigs) {
    return (
      <main className="page">
        <p className="docx-preview-status">
          <Loader2 size={16} className="spin" /> Memuat pengaturan...
        </p>
      </main>
    );
  }

  const sampleEmployee = Object.values(empSigs.items).find((item) => item.dataUrl) || null;
  const hasAnyImage = SIGNATURE_SLOTS.some((def) => settings.slots[def.key].dataUrl) || Boolean(sampleEmployee);

  return (
    <main className="page">
      <header className="page-header">
        <h1>Tanda Tangan &amp; Paraf</h1>
        <p>
          Unggah gambar tanda tangan, paraf, atau stempel (PNG, JPG, atau JPEG). Setelah memilih berkas, Anda dapat menghapus latar putih/polos secara otomatis dan memeriksa hasilnya sebelum dipakai.
          Gambar hanya muncul pada PDF gabungan dan pratinjaunya. Aplikasi tidak membuat tanda tangan
          otomatis. Pengaturan tersimpan di browser ini.
        </p>
      </header>

      <section className="card">
        <div className="card-title">
          <h2>
            <PenLine size={20} aria-hidden="true" /> Lokasi Penempatan
          </h2>
          <p>
            Geser (mm): X positif ke kanan, Y positif ke bawah. Gunakan &quot;Uji Penempatan&quot; untuk melihat hasilnya
            pada PDF contoh.
          </p>
        </div>

        <div className="sig-grid">
          {SIGNATURE_SLOTS.map((def) => {
            const slot = settings.slots[def.key];

            return (
              <article key={def.key} className="sig-card" data-testid={`slot-${def.key}`}>
                <h3>{def.label}</h3>
                <p className="hint">{def.hint}</p>

                {def.perEmployee ? (
                  <div className="sig-thumb">
                    <span className="hint">Gambar diatur per karyawan (lihat daftar di bawah)</span>
                  </div>
                ) : (
                <>
                <div className="sig-thumb">
                  {slot.dataUrl ? (
                    <img src={slot.dataUrl} alt={`Gambar ${def.label}`} />
                  ) : (
                    <span className="hint">Belum ada gambar</span>
                  )}
                </div>

                <div className="actions">
                  <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>
                    {busyKey === def.key ? <Loader2 size={16} className="spin" /> : <ImagePlus size={16} />}
                    {slot.dataUrl ? "Ganti gambar" : "Unggah gambar"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      hidden
                      data-testid={`file-${def.key}`}
                      onChange={(event) => handleFile(def.key, event)}
                    />
                  </label>

                  {slot.dataUrl && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      data-testid={`bg-${def.key}`}
                      onClick={() =>
                        setBgTarget({ kind: "slot", key: def.key, title: def.label, source: { dataUrl: slot.dataUrl, fileName: slot.fileName } })
                      }
                    >
                      <Eraser size={16} /> Hapus latar
                    </button>
                  )}
                  {slot.dataUrl && (
                    <button type="button" className="btn btn-ghost-danger btn-sm" data-testid={`remove-${def.key}`} onClick={() => handleRemove(def)}>
                      <Trash2 size={16} /> Hapus
                    </button>
                  )}
                </div>
                </>
                )}

                {def.stamp ? (
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      data-testid="toggle-stamp"
                      aria-pressed={slot.enabled}
                      onClick={() => patchSlot(def.key, { enabled: !slot.enabled })}
                    >
                      {slot.enabled ? <EyeOff size={16} /> : <Eye size={16} />} {slot.enabled ? "Sembunyikan stempel" : "Tampilkan stempel"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      data-testid="reset-stamp"
                      onClick={() => patchSlot(def.key, { ...def.defaults, sizeManual: false, enabled: slot.enabled })}
                    >
                      <RotateCcw size={16} /> Reset posisi
                    </button>
                  </div>
                ) : (
                  <label className="sig-toggle">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      data-testid={`enabled-${def.key}`}
                      onChange={(event) => patchSlot(def.key, { enabled: event.target.checked })}
                    />
                    Tampilkan di dokumen
                  </label>
                )}

                <div className="sig-fields">
                  {[
                    ["widthMm", "Lebar (mm)", 2, 400],
                    ["offsetXMm", "Geser X (mm)", -300, 300],
                    ["offsetYMm", "Geser Y (mm)", -300, 300],
                  ].map(([field, label, min, max]) => (
                    <label key={field}>
                      {label}
                      <input
                        className="input"
                        type="number"
                        step="0.5"
                        min={min}
                        max={max}
                        value={slot[field]}
                        data-testid={`${field}-${def.key}`}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          patchSlot(def.key, { [field]: Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : field === "widthMm" ? def.defaults.widthMm : 0 });
                        }}
                      />
                    </label>
                  ))}
                </div>

                <div className="sig-size-mode">
                  <span data-testid={`size-mode-${def.key}`}>{slot.sizeManual ? "Ukuran: manual (dipakai persis)" : "Ukuran: otomatis"}</span>
                  {slot.sizeManual && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      data-testid={`auto-size-${def.key}`}
                      onClick={() => patchSlot(def.key, { widthMm: def.defaults.widthMm, sizeManual: false })}
                    >
                      <RotateCcw size={14} /> Ukuran otomatis
                    </button>
                  )}
                </div>

                {def.stamp && (
                  <div className="sig-stamp-fields">
                    <label>
                      Transparansi stempel: {Math.round(slot.opacity * 100)}% terlihat
                      <input
                        type="range"
                        min="10"
                        max="100"
                        step="5"
                        value={Math.round(slot.opacity * 100)}
                        data-testid="opacity-stamp"
                        onChange={(event) => patchSlot(def.key, { opacity: Number(event.target.value) / 100 })}
                      />
                    </label>
                    <label>
                      Posisi awal
                      <select
                        className="input"
                        value={slot.side}
                        data-testid="side-stamp"
                        onChange={(event) => patchSlot(def.key, { side: event.target.value, offsetXMm: 0, offsetYMm: 0 })}
                      >
                        <option value="left">Di kiri tanda tangan</option>
                        <option value="right">Di kanan tanda tangan</option>
                      </select>
                    </label>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <label className="sig-toggle" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={settings.avoidText !== false}
            data-testid="avoid-text"
            onChange={(event) => setSettings((current) => ({ ...current, avoidText: event.target.checked }))}
          />
          Jaga agar tidak menutupi teks (otomatis kecilkan gambar yang terlalu besar; kotak oranye di editor = sedang dibatasi)
        </label>

        <div className="actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-primary" onClick={() => setPreview(true)} disabled={!hasAnyImage}>
            <Eye size={18} /> Tinjau PDF contoh
          </button>
          {saveState === "saved" && (
            <span className="sig-saved">
              <CheckCircle2 size={14} aria-hidden="true" /> Tersimpan di browser
            </span>
          )}
          {saveState === "saving" && <span className="hint">Menyimpan...</span>}
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h2>
            <Users size={20} aria-hidden="true" /> Tanda Tangan Karyawan
          </h2>
          <p>
            Simpan tanda tangan tiap karyawan di sini. Saat membuat SPPD, pada setiap perjalanan Anda memilih
            tanda tangan karyawan mana yang dipakai.
          </p>
        </div>

        {employees.length === 0 && <p className="hint">Belum ada data personel. Tambahkan di menu Data Personel.</p>}

        <div className="sig-grid">
          {employees.map((employee) => {
            const sig = empSigs.items[employee.id];

            return (
              <article key={employee.id} className="sig-card" data-testid={`emp-${employee.id}`}>
                <h3>{employee.name}</h3>
                <div className="sig-thumb">
                  {sig?.dataUrl ? <img src={sig.dataUrl} alt={`Tanda tangan ${employee.name}`} /> : <span className="hint">Belum ada tanda tangan</span>}
                </div>
                <div className="actions">
                  <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>
                    {busyKey === `emp-${employee.id}` ? <Loader2 size={16} className="spin" /> : <ImagePlus size={16} />}
                    {sig?.dataUrl ? "Ganti" : "Unggah"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      hidden
                      data-testid={`emp-file-${employee.id}`}
                      onChange={(event) => handleEmployeeFile(employee, event)}
                    />
                  </label>
                  {sig?.dataUrl && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      data-testid={`emp-bg-${employee.id}`}
                      onClick={() =>
                        setBgTarget({ kind: "employee", employee, title: `tanda tangan ${employee.name}`, source: { dataUrl: sig.dataUrl, fileName: sig.fileName } })
                      }
                    >
                      <Eraser size={16} /> Hapus latar
                    </button>
                  )}
                  {sig?.dataUrl && (
                    <button type="button" className="btn btn-ghost-danger btn-sm" onClick={() => handleEmployeeRemove(employee)}>
                      <Trash2 size={16} /> Hapus
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h2>
            <Eye size={20} aria-hidden="true" /> Atur Posisi Langsung
          </h2>
          <p>Halaman contoh di bawah memakai posisi dan ukuran yang sama dengan PDF. Hasil geseran tersimpan otomatis.</p>
        </div>
        <PlacementEditor settings={settings} onPatchSlot={patchSlot} sampleEmployee={sampleEmployee} />
      </section>

      {bgTarget && (
        <BackgroundRemovalDialog
          key={`${bgTarget.source.fileName}-${bgTarget.source.dataUrl.length}`}
          source={bgTarget.source}
          title={bgTarget.title}
          onAccept={(image) => applyBgResult(image, { removed: true })}
          onUseOriginal={(image) => applyBgResult(image, { removed: false })}
          onReupload={(source) => setBgTarget((current) => ({ ...current, source }))}
          onCancel={() => setBgTarget(null)}
        />
      )}

      {preview && (
        <CombinedPreview
          items={SAMPLE_ITEMS}
          trips={SAMPLE_TRIPS}
          employeeImages={[sampleEmployee?.dataUrl || null]}
          fileName="SPPD_contoh_penempatan.pdf"
          title="PDF Contoh Penempatan"
          onClose={() => setPreview(false)}
        />
      )}
    </main>
  );
}
