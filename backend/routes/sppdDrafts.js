// Draft SPPD (Simpan Draft) - versi Supabase.
// Data disimpan di tabel `sppd_drafts` (id, data JSONB, created_at, updated_at).
// File ini TIDAK lagi membaca/menulis data/drafts.json (file itu tetap utuh sebagai cadangan).
// Tidak menyentuh trips, employees, template Word/Excel, maupun route lain.
const express = require("express");
const supabase = require("../supabase");

const router = express.Router();
const TABLE = "sppd_drafts";

// Express 4 tidak menangkap error dari fungsi async, jadi dibungkus agar server tidak mati.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error("[drafts]", err);
      res.status(500).json({ message: "Terjadi kesalahan pada server saat memproses draft." });
    }
  };
}

// Baris database -> objek draft yang sama seperti dulu di drafts.json.
function rowToDraft(row) {
  const data = row.data && typeof row.data === "object" ? row.data : {};

  return {
    ...data,
    id: row.id,
    createdAt: data.createdAt || row.created_at,
    updatedAt: data.updatedAt || row.updated_at,
  };
}

// Objek draft -> baris database.
function draftToRow(draft) {
  return {
    id: draft.id,
    data: draft,
    created_at: draft.createdAt,
    updated_at: draft.updatedAt,
  };
}

function createDraftId() {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Bidang sementara di layar (pratinjau, loading) tidak ikut disimpan.
const RUNTIME_FIELDS = new Set([
  "previewUrl",
  "previewLoading",
  "excelPreviewUrl",
  "excelPreviewLoading",
  "downloadLoading",
]);

function cleanTrip(trip) {
  const cleaned = {};

  for (const [field, value] of Object.entries(trip || {})) {
    if (!RUNTIME_FIELDS.has(field)) cleaned[field] = value;
  }

  return cleaned;
}

function isTripComplete(trip) {
  return Boolean(
    String(trip.employeeName || "").trim() &&
      String(trip.purpose || "").trim() &&
      String(trip.destination || "").trim() &&
      trip.startDate &&
      trip.endDate &&
      trip.endDate >= trip.startDate
  );
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function uniqueValues(values) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function buildDefaultName(trips, nowIso) {
  const names = uniqueValues(trips.map((trip) => trip.employeeName));
  const label =
    names.length === 0
      ? "Tanpa nama pegawai"
      : names.length <= 2
        ? names.join(", ")
        : `${names[0]} +${names.length - 1} pegawai`;

  return `Draft ${label} - ${formatShortDate(nowIso)}`;
}

function summarize(draft) {
  const trips = draft.results || [];

  return {
    id: draft.id,
    name: draft.name,
    status: draft.status,
    tripCount: trips.length,
    employeeNames: uniqueValues(trips.map((trip) => trip.employeeName)),
    destinations: uniqueValues(trips.map((trip) => trip.destination)),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

// Validasi ringan: draft sengaja boleh berisi data yang belum lengkap.
function readBody(body) {
  const results = Array.isArray(body?.results) ? body.results.map(cleanTrip) : [];
  const message = typeof body?.message === "string" ? body.message : "";

  if (results.length === 0 && !message.trim()) {
    return { error: "Draft kosong. Baca pesan WhatsApp atau tambahkan perjalanan terlebih dahulu." };
  }

  return {
    value: {
      name: typeof body?.name === "string" ? body.name.trim() : "",
      message,
      letterDate: typeof body?.letterDate === "string" ? body.letterDate : "",
      recipient: typeof body?.recipient === "string" ? body.recipient : "",
      managerName: typeof body?.managerName === "string" ? body.managerName : "",
      results,
    },
  };
}

function computeStatus(results) {
  if (results.length === 0) return "Belum lengkap";
  return results.every(isTripComplete) ? "Siap diproses" : "Belum lengkap";
}

// Daftar draft (ringkasan), terbaru di atas.
router.get(
  "/",
  handle(async (req, res) => {
    const { data, error } = await supabase.from(TABLE).select("*");
    if (error) throw error;

    const drafts = data
      .map(rowToDraft)
      .map(summarize)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    res.json(drafts);
  })
);

// Satu draft lengkap.
router.get(
  "/:id",
  handle(async (req, res) => {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      return res.status(404).json({ message: "Draft tidak ditemukan." });
    }

    res.json(rowToDraft(data));
  })
);

// Buat draft baru.
router.post(
  "/",
  handle(async (req, res) => {
    const { value, error: bodyError } = readBody(req.body);

    if (bodyError) return res.status(400).json({ message: bodyError });

    const now = new Date().toISOString();
    const draft = {
      id: createDraftId(),
      ...value,
      name: value.name || buildDefaultName(value.results, now),
      status: computeStatus(value.results),
      createdAt: now,
      updatedAt: now,
    };

    const { error } = await supabase.from(TABLE).insert(draftToRow(draft));
    if (error) throw error;

    res.status(201).json({ message: "Draft berhasil disimpan.", draft });
  })
);

// Perbarui draft yang sudah ada (ID tetap sama).
router.put(
  "/:id",
  handle(async (req, res) => {
    const { data: existingRow, error: findError } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (findError) throw findError;

    if (!existingRow) {
      return res.status(404).json({ message: "Draft tidak ditemukan." });
    }

    const { value, error: bodyError } = readBody(req.body);

    if (bodyError) return res.status(400).json({ message: bodyError });

    const existing = rowToDraft(existingRow);
    const now = new Date().toISOString();
    const draft = {
      ...existing,
      ...value,
      id: existing.id,
      name: value.name || existing.name || buildDefaultName(value.results, now),
      status: computeStatus(value.results),
      createdAt: existing.createdAt,
      updatedAt: now,
    };

    const { error } = await supabase
      .from(TABLE)
      .update({ data: draft, updated_at: now })
      .eq("id", existing.id);
    if (error) throw error;

    res.json({ message: "Draft berhasil diperbarui.", draft });
  })
);

// Hapus draft. Hanya baris draft yang dihapus, bukan trips/dokumen lain.
router.delete(
  "/:id",
  handle(async (req, res) => {
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .eq("id", req.params.id)
      .select("*");
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ message: "Draft tidak ditemukan." });
    }

    res.json({
      success: true,
      message: "Draft berhasil dihapus.",
      data: summarize(rowToDraft(data[0])),
    });
  })
);

module.exports = router;