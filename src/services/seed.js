// Mengisi data personel awal (dari data lama proyek) sekali saja saat database masih kosong.
// Data awal ada di public/seed/employees.json. Setelah itu data sepenuhnya dikelola pengguna.
import { getAll, putMany } from "./db.js";

const SEED_FLAG = "sppd-ultg-seeded-v1";

let seedPromise = null;

export function ensureSeeded() {
  if (!seedPromise) seedPromise = runSeed();
  return seedPromise;
}

async function runSeed() {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(SEED_FLAG)) return;

    const existing = await getAll("employees");

    if (existing.length === 0) {
      const base = import.meta.env?.BASE_URL || "/";
      const response = await fetch(`${base}seed/employees.json`);

      if (response.ok) {
        const list = await response.json();

        if (Array.isArray(list) && list.length > 0) {
          await putMany(
            "employees",
            list.map((employee) => ({
              ...employee,
              active: employee.active !== false,
              updatedAt: employee.updatedAt || employee.createdAt || new Date().toISOString(),
            }))
          );
        }
      }
    }

    if (typeof localStorage !== "undefined") localStorage.setItem(SEED_FLAG, "1");
  } catch (error) {
    // Gagal mengisi data awal tidak boleh menghentikan aplikasi.
    console.warn("Data awal personel tidak dapat dimuat:", error);
    seedPromise = null;
  }
}
