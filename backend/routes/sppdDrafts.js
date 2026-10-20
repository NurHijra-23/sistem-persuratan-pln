// Draft SPPD (Simpan Draft).
// File ini berdiri sendiri: hanya membaca/menulis data/drafts.json.
// Tidak menyentuh trips.json, employees.json, template Word/Excel, maupun route lain.
const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const dataDir = path.join(__dirname, "..", "data");
const draftsFile = path.join(dataDir, "drafts.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(draftsFile)) {
  fs.writeFileSync(draftsFile, "[]", "utf8");
}

function readDrafts() {
  try {
    const parsed = JSON.parse(fs.readFileSync(draftsFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Tulis ke file sementara lalu ganti, agar drafts.json tidak rusak bila proses terhenti.
function saveDrafts(drafts) {
  const tempFile = `${draftsFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(drafts, null, 2), "utf8");
  fs.renameSync(tempFile, draftsFile);
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
router.get("/", (req, res) => {
  const drafts = readDrafts()
    .map(summarize)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  res.json(drafts);
});

// Satu draft lengkap.
router.get("/:id", (req, res) => {
  const draft = readDrafts().find((item) => item.id === req.params.id);

  if (!draft) {
    return res.status(404).json({ message: "Draft tidak ditemukan." });
  }

  res.json(draft);
});

// Buat draft baru.
router.post("/", (req, res) => {
  const { value, error } = readBody(req.body);

  if (error) return res.status(400).json({ message: error });

  const now = new Date().toISOString();
  const draft = {
    id: createDraftId(),
    ...value,
    name: value.name || buildDefaultName(value.results, now),
    status: computeStatus(value.results),
    createdAt: now,
    updatedAt: now,
  };

  const drafts = readDrafts();
  drafts.push(draft);
  saveDrafts(drafts);

  res.status(201).json({ message: "Draft berhasil disimpan.", draft });
});

// Perbarui draft yang sudah ada (ID tetap sama).
router.put("/:id", (req, res) => {
  const drafts = readDrafts();
  const index = drafts.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Draft tidak ditemukan." });
  }

  const { value, error } = readBody(req.body);

  if (error) return res.status(400).json({ message: error });

  const now = new Date().toISOString();
  const draft = {
    ...drafts[index],
    ...value,
    id: drafts[index].id,
    name: value.name || drafts[index].name || buildDefaultName(value.results, now),
    status: computeStatus(value.results),
    createdAt: drafts[index].createdAt,
    updatedAt: now,
  };

  drafts[index] = draft;
  saveDrafts(drafts);

  res.json({ message: "Draft berhasil diperbarui.", draft });
});

// Hapus draft. Hanya baris draft yang dihapus, bukan trips/dokumen lain.
router.delete("/:id", (req, res) => {
  const drafts = readDrafts();
  const index = drafts.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Draft tidak ditemukan." });
  }

  const [removed] = drafts.splice(index, 1);
  saveDrafts(drafts);

  res.json({ success: true, message: "Draft berhasil dihapus.", data: summarize(removed) });
});

module.exports = router;
