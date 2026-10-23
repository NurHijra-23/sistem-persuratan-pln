// Pengaturan gambar tanda tangan dan paraf. Disimpan di IndexedDB (store "settings", id "signatures")
// sehingga tetap ada setelah browser ditutup. Hanya gambar yang diunggah pengguna yang dipakai;
// aplikasi tidak pernah menggambar atau membuat tanda tangan sendiri.
import { getOne, putOne } from "./db.js";

export const SIGNATURE_SETTINGS_ID = "signatures";

// Lokasi penempatan. anchor menunjuk teks pada dokumen yang menjadi patokan posisi.
//  employee : di atas nama karyawan pada formulir Excel (nama terakhir di halaman formulir)
//  manager  : di atas nama manajer (mis. SAMSU ALAM) pada bagian MANAGER ULTG PAREPARE di surat
//  paraf1-3 : slot paraf Team Leader/Supervisor pada bagian paraf surat (kata "Paraf" di kaki surat)
//  stamp    : stempel kantor di samping tanda tangan manajer (sebagian menimpa tanda tangan)
export const SIGNATURE_SLOTS = [
  {
    key: "employee",
    label: "Tanda tangan karyawan (posisi)",
    hint: "Posisi dan ukuran di atas nama karyawan pada formulir. Gambarnya disimpan per karyawan di daftar bawah, lalu dipilih pada tiap perjalanan.",
    perEmployee: true,
    defaults: { widthMm: 32, offsetXMm: 0, offsetYMm: 0 },
  },
  {
    key: "manager",
    label: "Tanda tangan manajer",
    hint: "Muncul tepat di atas nama manajer pada bagian MANAGER ULTG PAREPARE (halaman surat).",
    defaults: { widthMm: 36, offsetXMm: 0, offsetYMm: 0 },
  },
  {
    key: "paraf1",
    label: "Paraf 1 (Team Leader/Supervisor)",
    hint: "Slot paraf pertama pada bagian paraf di kaki surat.",
    defaults: { widthMm: 8, offsetXMm: 0, offsetYMm: 0 },
  },
  {
    key: "paraf2",
    label: "Paraf 2",
    hint: "Slot paraf kedua, di sebelah kanan paraf 1.",
    defaults: { widthMm: 8, offsetXMm: 0, offsetYMm: 0 },
  },
  {
    key: "paraf3",
    label: "Paraf 3",
    hint: "Slot paraf ketiga, di sebelah kanan paraf 2.",
    defaults: { widthMm: 8, offsetXMm: 0, offsetYMm: 0 },
  },
  {
    key: "stamp",
    label: "Stempel kantor",
    hint: "Muncul di samping tanda tangan manajer, sebagian boleh menimpa tanda tangan. Posisi awal mengikuti tanda tangan manajer; atur dengan editor posisi.",
    stamp: true,
    defaults: { widthMm: 30, offsetXMm: 0, offsetYMm: 0, opacity: 0.85, side: "left" },
  },
];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_SIDE = 900; // piksel; cukup tajam untuk tanda tangan, menjaga ukuran PDF kecil

function emptySlot(def) {
  return { key: def.key, enabled: true, dataUrl: "", fileName: "", ratio: 1, opacity: 1, sizeManual: false, ...def.defaults };
}

export function defaultSignatureSettings() {
  return {
    id: SIGNATURE_SETTINGS_ID,
    avoidText: true, // otomatis kecilkan gambar agar tidak menutupi teks di sekitarnya
    slots: Object.fromEntries(SIGNATURE_SLOTS.map((def) => [def.key, emptySlot(def)])),
  };
}

// Menggabungkan data tersimpan dengan bawaan agar slot baru selalu ada.
export function normalizeSignatureSettings(stored) {
  const base = defaultSignatureSettings();
  if (stored && typeof stored.avoidText === "boolean") base.avoidText = stored.avoidText;

  for (const def of SIGNATURE_SLOTS) {
    const saved = stored?.slots?.[def.key];
    if (saved && typeof saved === "object") base.slots[def.key] = { ...base.slots[def.key], ...saved, key: def.key };

    // Ukuran "manual" = ukuran yang diatur sendiri pengguna (dipakai persis, tanpa pembatasan otomatis).
    // Data lama tanpa penanda dianggap manual bila lebarnya sudah berbeda dari ukuran awal.
    const slotValue = base.slots[def.key];
    slotValue.sizeManual =
      saved && saved.sizeManual === undefined
        ? Number(saved.widthMm) > 0 && Number(saved.widthMm) !== def.defaults.widthMm
        : Boolean(slotValue.sizeManual);

    const slot = base.slots[def.key];
    const opacity = Number(slot.opacity);

    slot.opacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0.1, opacity)) : 1;
    if (def.stamp) slot.side = slot.side === "right" ? "right" : "left";
  }

  return base;
}

export async function loadSignatureSettings() {
  return normalizeSignatureSettings(await getOne("settings", SIGNATURE_SETTINGS_ID));
}

export async function saveSignatureSettings(settings) {
  const normalized = normalizeSignatureSettings(settings);
  normalized.updatedAt = new Date().toISOString();
  await putOne("settings", normalized);
  return normalized;
}

// Slot aktif = diaktifkan DAN sudah memiliki gambar.
export function activeSlots(settings) {
  return SIGNATURE_SLOTS.filter((def) => {
    const slot = settings?.slots?.[def.key];
    return slot && slot.enabled && slot.dataUrl;
  }).map((def) => settings.slots[def.key]);
}

// Membaca file PNG/JPG yang diunggah pengguna. Gambar diperkecil (bila perlu) dan disimpan sebagai
// PNG (transparansi dipertahankan) atau JPEG (untuk foto tanpa transparansi).
export async function readSignatureFile(file) {
  if (!file) throw new Error("Tidak ada file yang dipilih.");

  // Format yang diterima: PNG, JPG, JPEG. Sebagian browser/OS mengosongkan file.type, jadi ekstensi ikut diperiksa.
  const typeOk = /^image\/(png|jpe?g)$/i.test(file.type) || (!file.type && /\.(png|jpe?g)$/i.test(file.name || ""));

  if (!typeOk) {
    throw new Error("Format gambar harus PNG, JPG, atau JPEG.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Ukuran gambar maksimal 5 MB.");
  }

  const bitmap = await createImageBitmap(file).catch(() => null);

  if (!bitmap || !bitmap.width || !bitmap.height) {
    throw new Error("Gambar tidak dapat dibaca. Gunakan file PNG atau JPG yang valid.");
  }

  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const isJpeg = /jpe?g/i.test(file.type) || (!file.type && /\.jpe?g$/i.test(file.name || ""));
  const dataUrl = isJpeg ? canvas.toDataURL("image/jpeg", 0.92) : canvas.toDataURL("image/png");

  return { dataUrl, ratio: height / width, fileName: file.name };
}

export function dataUrlToBytes(dataUrl) {
  const [meta, base64] = String(dataUrl).split(",");
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return { bytes, isPng: /image\/png/i.test(meta) };
}

// ---- Tanda tangan per karyawan ----
// Disimpan terpisah: { id: "employee-signatures", items: { [employeeId]: { dataUrl, ratio, fileName, updatedAt } } }
export const EMPLOYEE_SIGNATURES_ID = "employee-signatures";

export async function loadEmployeeSignatures() {
  const stored = await getOne("settings", EMPLOYEE_SIGNATURES_ID);
  return { id: EMPLOYEE_SIGNATURES_ID, items: stored?.items && typeof stored.items === "object" ? stored.items : {} };
}

export async function saveEmployeeSignatures(doc) {
  const value = { id: EMPLOYEE_SIGNATURES_ID, items: doc.items || {}, updatedAt: new Date().toISOString() };
  await putOne("settings", value);
  return value;
}
