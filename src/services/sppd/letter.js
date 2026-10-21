// Surat Word SPPD dari template sppd-template-otomatis.docx (dijalankan di browser).
// Logika pengisian disalin dari backend/routes/sppdDocument.js; yang berubah hanya
// sumber template (public/templates) dan cara menggabungkan beberapa surat.
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

import { loadTemplate } from "../templates.js";
import { attachSectPr, readBody } from "./combined.js";

export const LETTER_TEMPLATE_NAME = "sppd-template-otomatis.docx";

const REQUIRED_FIELDS = [
  "tanggalSurat",
  "perihal",
  "subPerihal",
  "penerima",
  "namaPegawai",
  "maksud",
  "tujuan",
  "durasi",
  "durasiTerbilang",
  "tanggalBerangkat",
  "tanggalKembali",
  "namaManajer",
];

// Mengembalikan surat Word (Uint8Array) untuk satu perjalanan.
export async function createDocx(data) {
  const missingFields = REQUIRED_FIELDS.filter(
    (field) =>
      data[field] === undefined ||
      data[field] === null ||
      String(data[field]).trim() === ""
  );

  if (missingFields.length) {
    const error = new Error("Data surat belum lengkap.");
    error.status = 400;
    error.fields = missingFields;
    throw error;
  }

  const zip = new PizZip(await loadTemplate(LETTER_TEMPLATE_NAME));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.render({
    tanggalSurat: String(data.tanggalSurat),
    perihal: String(data.perihal),
    subPerihal: String(data.subPerihal),
    penerima: String(data.penerima),
    namaPegawai: String(data.namaPegawai).toLocaleUpperCase("id-ID"),
    maksud: String(data.maksud),
    tujuan: String(data.tujuan),
    durasi: String(data.durasi),
    durasiTerbilang: String(data.durasiTerbilang),
    tanggalBerangkat: String(data.tanggalBerangkat),
    tanggalKembali: String(data.tanggalKembali),
    namaManajer: String(data.namaManajer).toLocaleUpperCase("id-ID"),
  });

  return doc
    .getZip()
    .generate({ type: "uint8array", compression: "DEFLATE" });
}

// Menggabungkan beberapa surat dari template yang sama menjadi satu file Word,
// setiap surat di halaman baru. Pengganti docx-merger (yang bergantung pada Node):
// semua surat memakai kop, relasi, dan gambar yang sama, sehingga isi dokumen cukup
// disambung dengan pemisah halaman.
export function mergeDocxBuffers(buffers) {
  if (!buffers.length) {
    throw new Error("Tidak ada surat SPPD untuk digabungkan.");
  }

  if (buffers.length === 1) return buffers[0];

  const zips = buffers.map((buffer) => new PizZip(buffer));
  const base = zips[0];
  const first = readBody(base);
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const bodies = zips.map((zip, index) => {
    let { body } = readBody(zip);

    // ID paragraf Word harus unik di seluruh dokumen.
    if (index > 0) {
      body = body.replace(/\sw14:(?:paraId|textId)="[0-9A-Fa-f]+"/g, "");
    }

    return body;
  });

  const documentXml = `${first.head}${bodies.join(pageBreak)}${first.sectPr}</w:body></w:document>`;
  base.file("word/document.xml", documentXml);

  return base.generate({ type: "uint8array", compression: "DEFLATE" });
}

export { attachSectPr };
