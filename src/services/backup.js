// Ekspor/impor cadangan data (JSON) dan pembantu unduhan file.
import { STORES, getAll, putMany, replaceAll } from "./db.js";

export const BACKUP_APP = "sppd-ultg-parepare";
export const BACKUP_VERSION = 1;

export async function buildBackup() {
  const data = {};

  for (const name of STORES) data[name] = await getAll(name);

  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    employees: data.employees,
    trips: data.trips,
    drafts: data.drafts,
  };
}

// Memeriksa isi berkas cadangan; mengembalikan data bersih atau melempar Error berpesan jelas.
export function parseBackup(text) {
  let raw;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Berkas bukan JSON yang valid.");
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Format cadangan tidak dikenali.");
  }

  if (raw.app && raw.app !== BACKUP_APP) {
    throw new Error("Berkas ini bukan cadangan aplikasi SPPD ULTG Parepare.");
  }

  if (raw.version && Number(raw.version) > BACKUP_VERSION) {
    throw new Error("Berkas cadangan dibuat oleh versi aplikasi yang lebih baru.");
  }

  const result = {};

  for (const name of STORES) {
    const list = raw[name] === undefined ? [] : raw[name];

    if (!Array.isArray(list)) throw new Error(`Bagian "${name}" pada cadangan tidak valid.`);

    const seen = new Set();

    result[name] = list.map((item, index) => {
      if (!item || typeof item !== "object" || item.id === undefined || item.id === null || item.id === "") {
        throw new Error(`Data "${name}" nomor ${index + 1} tidak memiliki id.`);
      }

      const id = String(item.id);

      if (seen.has(id)) throw new Error(`Data "${name}" memiliki id ganda: ${id}.`);
      seen.add(id);

      return { ...item, id };
    });
  }

  if (STORES.every((name) => result[name].length === 0)) {
    throw new Error("Berkas cadangan tidak berisi data.");
  }

  return result;
}

// mode "gabung": data dengan id sama ditimpa, data lain dipertahankan.
// mode "ganti": seluruh data lokal diganti isi cadangan.
export async function restoreBackup(data, mode) {
  if (mode === "ganti") {
    await replaceAll(data);
  } else {
    for (const name of STORES) await putMany(name, data[name]);
  }

  return Object.fromEntries(STORES.map((name) => [name, data[name].length]));
}

export function backupFileName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  return `cadangan-sppd-ultg_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

// Mengunduh Blob sebagai berkas.
export function saveBlob(blob, fileName, revokeAfterMs = 1500) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), revokeAfterMs);
}
