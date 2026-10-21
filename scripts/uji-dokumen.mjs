// Uji pembuatan dokumen di Node (tanpa browser): membuat Word/Excel/ZIP dari template asli
// dan menyimpannya ke folder hasil-uji/ agar bisa dibuka di Word/Excel/LibreOffice.
//   npm run test:dokumen
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { setTemplateLoader } from "../src/services/templates.js";
import { putMany } from "../src/services/db.js";
import { apiFetch } from "../src/services/localApi.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "hasil-uji");

fs.mkdirSync(out, { recursive: true });
setTemplateLoader(async (name) => new Uint8Array(fs.readFileSync(path.join(root, "public", "templates", name))));

const seed = JSON.parse(fs.readFileSync(path.join(root, "public", "seed", "employees.json"), "utf8"));
await putMany("employees", seed.map((e) => ({ ...e, active: true })));

const letter = (name, start, end, days, dest) => ({
  tanggalSurat: "21 Oktober 2026",
  perihal: "Perintah Perjalanan Dinas",
  subPerihal: "Pemeliharaan",
  penerima: "Manager PLN Tarakan Regional Sulawesi 2",
  namaPegawai: name,
  maksud: `Pemeliharaan jaringan ${dest}`,
  tujuan: dest,
  durasi: String(days),
  durasiTerbilang: ["Nol", "Satu", "Dua", "Tiga", "Empat"][days],
  tanggalBerangkat: start.label,
  tanggalKembali: end.label,
  namaManajer: "Samsu Alam",
});
const trip = (name, s, e, dest) => ({
  employeeName: name, destination: dest, purpose: `Pemeliharaan jaringan ${dest}`,
  startDate: s, endDate: e, position: "Tenaga Pemeliharaan ULTG Parepare",
});

const data = [
  ["AKRAM ASSIDIK", "2026-09-01", "2026-09-03", 3, "Barru - Pangkep"],
  ["Akram", "2026-09-10", "2026-09-12", 3, "Parepare - Polmas"],
  ["agim", "2026-09-13", "2026-09-14", 2, "Parepare - Pinrang"],
  ["MUH. ARDI", "2026-09-20", "2026-09-20", 1, "Enrekang"],
];
const items = data.map(([n, s, e, d, dest]) => letter(n, { label: s }, { label: e }, d, dest));
const trips = data.map(([n, s, e, , dest]) => trip(n, s, e, dest));

async function save(name, response) {
  if (!response.ok) throw new Error(`${name}: ${response.status} ${await response.text()}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(out, name), bytes);
  console.log("OK ", name, bytes.length, "byte");
}
const post = (url, body) => apiFetch(url, { method: "POST", body: JSON.stringify(body) });

await save("surat-satu.docx", await post("/api/sppd/generate", items[0]));
await save("surat-semua.docx", await post("/api/sppd/generate", { items }));
await save("excel-satu-agim.xlsx", await post("/api/sppd-excel/generate", trips[2]));
await save("excel-semua.xlsx", await post("/api/sppd-excel/generate-all", { items: trips }));
await save("gabungan.docx", await post("/api/sppd-gabungan/generate", { items, trips }));
await save("paket.zip", await post("/api/sppd-paket/zip", { items, trips }));
await save("pratinjau-surat.docx", await post("/api/sppd/preview", items[0]));
await save("pratinjau-excel.docx", await post("/api/sppd-preview/excel", trips[0]));
console.log("Selesai.");
