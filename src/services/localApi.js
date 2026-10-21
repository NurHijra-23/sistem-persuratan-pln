// Pengganti pemanggilan API backend. `apiFetch` memiliki bentuk yang sama seperti `fetch`
// (alamat + { method, headers, body }) dan mengembalikan objek Response sungguhan, sehingga
// halaman-halaman lama tetap memakai response.ok / response.json() / response.blob().
// Semua proses berjalan di browser: data di IndexedDB, dokumen dibuat dari template lokal.
import PizZip from "pizzip";

import { drafts, employees, trips } from "./dataServices.js";
import { createDocx, mergeDocxBuffers } from "./sppd/letter.js";
import { generateWorkbook } from "./sppd/excelWorkbook.js";
import { createCombinedDocx, createFormOnlyDocx, groupKey } from "./sppd/combined.js";

export const API_URL = "/api";

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_ZIP = "application/zip";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const binary = (bytes, type) =>
  new Response(new Blob([bytes], { type }), { status: 200, headers: { "Content-Type": type } });

function errorResponse(error, fallback) {
  console.error(fallback, error);

  return json(
    {
      message: error.message || fallback,
      fields: error.fields || [],
      detail:
        error.properties?.errors?.map((item) => item.properties?.explanation).filter(Boolean) || [],
    },
    error.status || 400
  );
}

function safeFileLabel(name, fallback = "Karyawan") {
  return (
    String(name || fallback)
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback
  );
}

function toResponse(result) {
  return json(result.body, result.status);
}

async function handleDocuments(path, body) {
  switch (path) {
    // Surat Word (satu atau beberapa surat digabung ke satu file).
    case "/sppd/generate": {
      const items = Array.isArray(body.items) ? body.items : [body];

      if (items.length === 0) return json({ message: "Minimal satu data SPPD harus dikirim." }, 400);
      if (items.length > 100) return json({ message: "Maksimal 100 surat SPPD dalam satu dokumen." }, 400);

      const buffers = [];
      for (const item of items) buffers.push(await createDocx(item));

      return binary(mergeDocxBuffers(buffers), MIME_DOCX);
    }

    // Pratinjau surat: dokumen Word yang sama dengan unduhan, ditampilkan di browser.
    case "/sppd/preview":
      return binary(await createDocx(body), MIME_DOCX);

    case "/sppd-excel/generate":
      return binary(await generateWorkbook([body]), MIME_XLSX);

    case "/sppd-excel/generate-all":
      return binary(await generateWorkbook(body.items), MIME_XLSX);

    // Pratinjau formulir Excel: formulir yang sama dikonversi menjadi tabel Word.
    case "/sppd-preview/excel":
      return binary(await createFormOnlyDocx(body), MIME_DOCX);

    case "/sppd-gabungan/generate": {
      const { items, trips: tripList } = body || {};

      if (!Array.isArray(items) || !Array.isArray(tripList) || items.length === 0) {
        return json({ message: "Data surat dan data perjalanan wajib dikirim." }, 400);
      }

      if (items.length !== tripList.length) {
        return json({ message: "Jumlah data surat dan data perjalanan harus sama." }, 400);
      }

      if (items.length > 100) {
        return json({ message: "Maksimal 100 perjalanan dalam satu dokumen." }, 400);
      }

      return binary(await createCombinedDocx(items, tripList), MIME_DOCX);
    }

    // ZIP berisi Word (semua surat) + Excel (semua perjalanan) dari data SPPD yang sama.
    case "/sppd-paket/zip": {
      const { items, trips: tripList } = body || {};

      if (!Array.isArray(items) || !Array.isArray(tripList) || items.length === 0) {
        return json({ message: "Data surat dan data perjalanan wajib dikirim." }, 400);
      }

      if (items.length !== tripList.length) {
        return json({ message: "Jumlah data surat dan data perjalanan harus sama." }, 400);
      }

      const letters = [];
      for (const item of items) letters.push(await createDocx(item));

      const word = mergeDocxBuffers(letters);
      const excel = await generateWorkbook(tripList);
      const names = [...new Set(items.map((item) => groupKey(item.namaPegawai)))];
      const label = names.length === 1 ? safeFileLabel(items[0].namaPegawai) : "Beberapa_Pegawai";

      const zip = new PizZip();
      zip.file(`SPPD_${label}_${items.length}_surat.docx`, word);
      zip.file(`SPPD_Excel_${label}_${items.length}_perjalanan.xlsx`, excel);

      return binary(zip.generate({ type: "uint8array", compression: "DEFLATE" }), MIME_ZIP);
    }

    default:
      return null;
  }
}

async function routeData(method, segments, body) {
  const [resource, id] = segments;
  const service = { employees, trips, drafts }[resource];

  if (!service) return null;

  if (!id) {
    if (method === "GET") return toResponse(await service.list());
    if (method === "POST") return toResponse(await service.create(body));
  } else {
    if (method === "GET" && service.get) return toResponse(await service.get(id));
    if (method === "PUT") return toResponse(await service.update(id, body));
    if (method === "DELETE") return toResponse(await service.remove(id));
  }

  return null;
}

export async function apiFetch(url, init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const path = String(url).replace(/^.*?\/api(?=\/)/, "").split("?")[0];
  const segments = path.split("/").filter(Boolean).map(decodeURIComponent);

  let body = {};

  if (typeof init.body === "string" && init.body) {
    try {
      body = JSON.parse(init.body);
    } catch {
      return json({ message: "Data yang dikirim tidak valid." }, 400);
    }
  }

  try {
    const dataResponse = await routeData(method, segments, body);
    if (dataResponse) return dataResponse;

    if (method === "POST") {
      const documentResponse = await handleDocuments(path, body);
      if (documentResponse) return documentResponse;
    }

    return json({ message: `Layanan lokal ${method} ${path} tidak tersedia.` }, 404);
  } catch (error) {
    return errorResponse(error, "Gagal memproses data lokal.");
  }
}
