// Logika data personel, perjalanan dinas, dan draft.
// Disalin dari route backend (sppdEmployees.js, sppdTrips.js, sppdDrafts.js) dengan validasi
// dan pesan yang sama; yang berubah hanya penyimpanannya (IndexedDB, bukan Supabase).
// Setiap fungsi mengembalikan { status, body } agar bentuk respons sama seperti API lama.
import { deleteOne, getAll, getOne, putOne } from "./db.js";
import { ensureSeeded } from "./seed.js";
import { resolveSheetName } from "./sppd/excelWorkbook.js";

const ok = (body, status = 200) => ({ status, body });
const fail = (status, message) => ({ status, body: { message } });

/* ------------------------------------------------------------------ */
/* Personel                                                            */
/* ------------------------------------------------------------------ */

function nameKey(value) {
  return String(value || "")
    .toLocaleLowerCase("id-ID")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findDuplicateName(employees, name, ignoreId = null) {
  const key = nameKey(name);
  if (!key) return null;

  return (
    employees.find(
      (employee) =>
        employee.active !== false &&
        employee.id !== ignoreId &&
        nameKey(employee.name) === key
    ) || null
  );
}

function cleanAliases(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,\n]/);
  const seen = new Set();
  const result = [];

  for (const item of list) {
    const text = String(item || "").trim();
    const key = nameKey(text);

    if (text && !seen.has(key)) {
      seen.add(key);
      result.push(text);
    }
  }

  return result;
}

function normalizeEmployee(row) {
  const employee = {
    id: row.id,
    name: row.name,
    nickname: row.nickname || "",
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    position: row.position || "",
    active: row.active !== false,
    createdAt: row.createdAt,
  };

  if (row.sheetName) employee.sheetName = row.sheetName;
  if (row.deletedAt) employee.deletedAt = row.deletedAt;
  if (row.updatedAt) employee.updatedAt = row.updatedAt;

  return employee;
}

async function listActiveEmployees() {
  await ensureSeeded();
  const rows = await getAll("employees");

  return rows
    .filter((row) => row.active !== false)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
    .map(normalizeEmployee);
}

async function findEmployeeById(id) {
  if (id === undefined || id === null || id === "") return null;
  const row = await getOne("employees", id);
  return row ? normalizeEmployee(row) : null;
}

async function findActiveEmployeeById(id) {
  const employee = await findEmployeeById(id);
  return employee && employee.active !== false ? employee : null;
}

async function isEmployeeUsed(employeeId) {
  const id = String(employeeId);
  const trips = await getAll("trips");

  if (trips.some((trip) => String(trip.employeeId) === id)) return true;

  const drafts = await getAll("drafts");

  return drafts.some((draft) =>
    (draft.results || []).some((trip) => String(trip.employeeId) === id)
  );
}

export const employees = {
  async list() {
    return ok(await listActiveEmployees());
  },

  async create(body) {
    const { nickname, position } = body || {};
    const name = String(body?.name || "").trim();

    if (!name) return fail(400, "Nama lengkap wajib diisi.");

    const duplicate = findDuplicateName(await listActiveEmployees(), name);

    if (duplicate) return fail(409, `Nama "${duplicate.name}" sudah terdaftar.`);

    const now = new Date().toISOString();
    const row = {
      id: Date.now().toString(),
      name,
      nickname: String(nickname || "").trim(),
      aliases: cleanAliases(body.aliases),
      position: String(position || "Tenaga Pemeliharaan ULTG Parepare").trim(),
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await putOne("employees", row);
    return ok(normalizeEmployee(row), 201);
  },

  async update(id, body) {
    const current = await findActiveEmployeeById(id);

    if (!current) return fail(404, "Personel tidak ditemukan.");

    const name = String(body?.name || "").trim();
    const position = String(body?.position || "").trim();

    if (!name) return fail(400, "Nama lengkap wajib diisi.");
    if (!position) return fail(400, "Jabatan wajib diisi.");

    const duplicate = findDuplicateName(await listActiveEmployees(), name, current.id);

    if (duplicate) {
      return fail(409, `Nama "${duplicate.name}" sudah terdaftar sebagai personel lain.`);
    }

    // Pertahankan pemetaan sheet Excel sebelum nama berubah.
    const sheetName = current.sheetName || resolveSheetName(current.name);

    const nickname =
      body?.nickname === undefined ? current.nickname || "" : String(body.nickname || "").trim();
    const aliases =
      body?.aliases === undefined ? current.aliases || [] : cleanAliases(body.aliases);

    const stored = await getOne("employees", current.id);
    const row = {
      ...stored,
      name,
      nickname,
      aliases,
      position,
      updatedAt: new Date().toISOString(),
    };

    if (sheetName) row.sheetName = sheetName;

    await putOne("employees", row);

    return ok({
      success: true,
      message: "Data personel berhasil diperbarui.",
      data: normalizeEmployee(row),
    });
  },

  async remove(id) {
    const employee = await findActiveEmployeeById(id);

    if (!employee) return fail(404, "Personel tidak ditemukan.");

    if (await isEmployeeUsed(employee.id)) {
      const now = new Date().toISOString();
      const stored = await getOne("employees", employee.id);
      const row = { ...stored, active: false, deletedAt: now, updatedAt: now };

      await putOne("employees", row);

      return ok({
        success: true,
        softDeleted: true,
        message: `${employee.name} dihapus dari daftar personel. Riwayat perjalanan tetap tersimpan.`,
        data: normalizeEmployee(row),
      });
    }

    await deleteOne("employees", employee.id);

    return ok({
      success: true,
      softDeleted: false,
      message: `${employee.name} berhasil dihapus.`,
      data: employee,
    });
  },
};

/* ------------------------------------------------------------------ */
/* Perjalanan dinas                                                    */
/* ------------------------------------------------------------------ */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function calculateDuration(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

const hasText = (value) => typeof value === "string" && value.trim() !== "";

function createTripId() {
  return `${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}

function normalizeTrip(row) {
  const trip = {
    id: row.id,
    employeeId: row.employeeId || "",
    employeeName: row.employeeName,
    purpose: row.purpose || "",
    destination: row.destination || "",
    startDate: row.startDate,
    endDate: row.endDate,
    durationDays: row.durationDays,
    transport: row.transport || "",
    createdAt: row.createdAt,
  };

  if (row.updatedAt && row.updatedAt !== row.createdAt) trip.updatedAt = row.updatedAt;

  return trip;
}

export const trips = {
  async list() {
    const rows = await getAll("trips");
    rows.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    return ok(rows.map(normalizeTrip));
  },

  async create(body) {
    const { employeeId, purpose, destination, startDate, endDate, transport } = body || {};

    if (!employeeId || !hasText(purpose) || !hasText(destination) || !startDate || !endDate) {
      return fail(400, "Data karyawan, maksud, tujuan, dan tanggal wajib diisi.");
    }

    if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) {
      return fail(400, "Tanggal perjalanan tidak valid.");
    }

    const employee = await findEmployeeById(employeeId);

    if (!employee) return fail(400, "Karyawan tidak ditemukan. Periksa data karyawan.");

    const now = new Date().toISOString();
    const row = {
      id: createTripId(),
      employeeId: employee.id,
      employeeName: employee.name,
      purpose: purpose.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
      durationDays: calculateDuration(startDate, endDate),
      transport: String(transport || "").trim(),
      createdAt: now,
      updatedAt: now,
    };

    await putOne("trips", row);

    return ok({ message: "Perjalanan dinas berhasil disimpan.", trip: normalizeTrip(row) }, 201);
  },

  async update(id, body) {
    const existing = await getOne("trips", id);

    if (!existing) return fail(404, "Data perjalanan tidak ditemukan.");

    const { employeeId, purpose, destination, startDate, endDate, transport } = body || {};

    if (!employeeId || !hasText(purpose) || !hasText(destination) || !startDate || !endDate) {
      return fail(400, "Nama karyawan, tujuan, maksud, dan tanggal wajib diisi.");
    }

    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return fail(400, "Format tanggal tidak valid.");
    }

    if (endDate < startDate) {
      return fail(400, "Tanggal kembali tidak boleh sebelum tanggal berangkat.");
    }

    const employee = await findEmployeeById(employeeId);

    if (!employee) return fail(400, "Karyawan tidak ditemukan. Silakan pilih karyawan yang valid.");

    const row = {
      ...existing,
      employeeId: employee.id,
      employeeName: employee.name,
      purpose: purpose.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
      durationDays: calculateDuration(startDate, endDate),
      transport: String(transport || "").trim(),
      updatedAt: new Date().toISOString(),
    };

    await putOne("trips", row);

    return ok({ success: true, message: "Perjalanan berhasil diperbarui.", data: normalizeTrip(row) });
  },

  async remove(id) {
    const existing = await getOne("trips", id);

    if (!existing) return fail(404, "Data perjalanan tidak ditemukan.");

    await deleteOne("trips", id);

    return ok({ success: true, message: "Data perjalanan berhasil dihapus.", data: normalizeTrip(existing) });
  },
};

/* ------------------------------------------------------------------ */
/* Draft SPPD                                                          */
/* ------------------------------------------------------------------ */

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

  return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function uniqueValues(values) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function buildDefaultName(list, nowIso) {
  const names = uniqueValues(list.map((trip) => trip.employeeName));
  const label =
    names.length === 0
      ? "Tanpa nama pegawai"
      : names.length <= 2
        ? names.join(", ")
        : `${names[0]} +${names.length - 1} pegawai`;

  return `Draft ${label} - ${formatShortDate(nowIso)}`;
}

function summarize(draft) {
  const list = draft.results || [];

  return {
    id: draft.id,
    name: draft.name,
    status: draft.status,
    tripCount: list.length,
    employeeNames: uniqueValues(list.map((trip) => trip.employeeName)),
    destinations: uniqueValues(list.map((trip) => trip.destination)),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function readDraftBody(body) {
  const results = Array.isArray(body?.results) ? body.results.map(cleanTrip) : [];
  const message = typeof body?.message === "string" ? body.message : "";

  if (results.length === 0 && !message.trim()) {
    return {
      error: "Draft kosong. Baca pesan WhatsApp atau tambahkan perjalanan terlebih dahulu.",
    };
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

function createDraftId() {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const drafts = {
  async list() {
    const rows = await getAll("drafts");
    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return ok(rows.map(summarize));
  },

  async get(id) {
    const draft = await getOne("drafts", id);
    return draft ? ok(draft) : fail(404, "Draft tidak ditemukan.");
  },

  async create(body) {
    const { value, error } = readDraftBody(body);

    if (error) return fail(400, error);

    const now = new Date().toISOString();
    const draft = {
      id: createDraftId(),
      ...value,
      name: value.name || buildDefaultName(value.results, now),
      status: computeStatus(value.results),
      createdAt: now,
      updatedAt: now,
    };

    await putOne("drafts", draft);

    return ok({ message: "Draft berhasil disimpan.", draft }, 201);
  },

  async update(id, body) {
    const existing = await getOne("drafts", id);

    if (!existing) return fail(404, "Draft tidak ditemukan.");

    const { value, error } = readDraftBody(body);

    if (error) return fail(400, error);

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

    await putOne("drafts", draft);

    return ok({ message: "Draft berhasil diperbarui.", draft });
  },

  async remove(id) {
    const existing = await getOne("drafts", id);

    if (!existing) return fail(404, "Draft tidak ditemukan.");

    await deleteOne("drafts", id);

    return ok({ success: true, message: "Draft berhasil dihapus.", data: summarize(existing) });
  },
};
