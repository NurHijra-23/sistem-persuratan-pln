// Manajemen personel - versi Supabase (tabel `employees`).
// Menangani GET, POST, PUT, dan DELETE untuk /api/employees.
// File employees.json TIDAK lagi dibaca atau ditulis (tetap utuh sebagai cadangan).
const express = require("express");

const supabase = require("../supabase");
const { resolveSheetName } = require("./sppdExcel");

const router = express.Router();

const EMPLOYEES = "employees";
const DRAFTS = "sppd_drafts";
const TRIPS = "trips";

// Express 4 tidak menangkap error dari fungsi async, jadi dibungkus agar server tidak mati.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error("[employees]", err);
      res.status(500).json({ message: "Terjadi kesalahan pada server saat memproses data personel." });
    }
  };
}

// Baris database (snake_case) -> objek personel (camelCase) seperti format lama.
function rowToEmployee(row) {
  const employee = {
    id: row.id,
    name: row.name,
    nickname: row.nickname || "",
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    position: row.position || "",
    active: row.active !== false,
    createdAt: row.created_at,
  };

  if (row.sheet_name) employee.sheetName = row.sheet_name;
  if (row.deleted_at) employee.deletedAt = row.deleted_at;
  if (row.updated_at) employee.updatedAt = row.updated_at;

  return employee;
}

// Personel aktif (yang belum di-soft-delete), urut dari yang paling lama dibuat.
async function listActiveEmployees() {
  const { data, error } = await supabase
    .from(EMPLOYEES)
    .select("*")
    .or("active.is.null,active.eq.true")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return data.map(rowToEmployee);
}

// Cari personel berdasarkan ID (termasuk yang sudah nonaktif, sama seperti perilaku lama pada route perjalanan).
async function findEmployeeById(id) {
  if (id === undefined || id === null || id === "") return null;

  const { data, error } = await supabase
    .from(EMPLOYEES)
    .select("*")
    .eq("id", String(id))
    .maybeSingle();

  if (error) throw error;

  return data ? rowToEmployee(data) : null;
}

async function findActiveEmployeeById(id) {
  const employee = await findEmployeeById(id);
  return employee && employee.active !== false ? employee : null;
}

// Kunci pembanding nama: huruf kecil, tanpa titik, spasi, atau tanda baca.
function nameKey(value) {
  return String(value || "")
    .toLocaleLowerCase("id-ID")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Personel aktif lain dengan nama lengkap yang sama (mengabaikan huruf besar/kecil, titik, spasi).
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

// Alias dapat berupa array atau teks dipisahkan koma/baris baru.
function cleanAliases(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\n]/);

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

// Apakah personel sudah dipakai pada riwayat perjalanan atau draft? (keduanya di Supabase)
async function isEmployeeUsed(employeeId) {
  const id = String(employeeId);

  const { data: tripRows, error: tripError } = await supabase
    .from(TRIPS)
    .select("id")
    .eq("employee_id", id)
    .limit(1);

  if (tripError) throw tripError;
  if (tripRows.length > 0) return true;

  const { data, error } = await supabase.from(DRAFTS).select("data");
  if (error) throw error;

  return data.some((row) =>
    (row.data?.results || []).some((trip) => String(trip.employeeId) === id)
  );
}

// Daftar personel aktif.
router.get(
  "/",
  handle(async (req, res) => {
    res.json(await listActiveEmployees());
  })
);

// Tambah personel.
router.post(
  "/",
  handle(async (req, res) => {
    const { nickname, position } = req.body || {};
    const name = String(req.body?.name || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Nama lengkap wajib diisi." });
    }

    // Cegah personel ganda (termasuk akibat tombol simpan ditekan berulang).
    const duplicate = findDuplicateName(await listActiveEmployees(), name);

    if (duplicate) {
      return res.status(409).json({
        message: `Nama "${duplicate.name}" sudah terdaftar.`,
      });
    }

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from(EMPLOYEES)
      .insert({
        id: Date.now().toString(),
        name,
        nickname: String(nickname || "").trim() || null,
        aliases: cleanAliases(req.body.aliases),
        position: String(position || "Tenaga Pemeliharaan ULTG Parepare").trim(),
        active: true,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(rowToEmployee(data));
  })
);

// Edit personel (nama, nama singkat, alias, jabatan). ID tetap.
router.put(
  "/:id",
  handle(async (req, res) => {
    const current = await findActiveEmployeeById(req.params.id);

    if (!current) {
      return res.status(404).json({ message: "Personel tidak ditemukan." });
    }

    const name = String(req.body?.name || "").trim();
    const position = String(req.body?.position || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Nama lengkap wajib diisi." });
    }

    if (!position) {
      return res.status(400).json({ message: "Jabatan wajib diisi." });
    }

    const duplicate = findDuplicateName(await listActiveEmployees(), name, current.id);

    if (duplicate) {
      return res.status(409).json({
        message: `Nama "${duplicate.name}" sudah terdaftar sebagai personel lain.`,
      });
    }

    // Pertahankan pemetaan sheet Excel sebelum nama berubah.
    const sheetName = current.sheetName || resolveSheetName(current.name);

    const nickname =
      req.body?.nickname === undefined
        ? current.nickname || ""
        : String(req.body.nickname || "").trim();

    const aliases =
      req.body?.aliases === undefined
        ? current.aliases || []
        : cleanAliases(req.body.aliases);

    const changes = {
      name,
      nickname: nickname || null,
      aliases,
      position,
      updated_at: new Date().toISOString(),
    };

    if (sheetName) changes.sheet_name = sheetName;

    const { data, error } = await supabase
      .from(EMPLOYEES)
      .update(changes)
      .eq("id", current.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Data personel berhasil diperbarui.",
      data: rowToEmployee(data),
    });
  })
);

// Hapus personel. Bila sudah dipakai pada riwayat perjalanan atau draft, personel hanya dinonaktifkan
// (soft delete) agar riwayat tidak kehilangan rujukan. Riwayat perjalanan dan dokumen tidak disentuh.
router.delete(
  "/:id",
  handle(async (req, res) => {
    const employee = await findActiveEmployeeById(req.params.id);

    if (!employee) {
      return res.status(404).json({ message: "Personel tidak ditemukan." });
    }

    if (await isEmployeeUsed(employee.id)) {
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from(EMPLOYEES)
        .update({ active: false, deleted_at: now, updated_at: now })
        .eq("id", employee.id)
        .select()
        .single();

      if (error) throw error;

      return res.json({
        success: true,
        softDeleted: true,
        message: `${employee.name} dihapus dari daftar personel. Riwayat perjalanan tetap tersimpan.`,
        data: rowToEmployee(data),
      });
    }

    const { error } = await supabase.from(EMPLOYEES).delete().eq("id", employee.id);
    if (error) throw error;

    res.json({
      success: true,
      softDeleted: false,
      message: `${employee.name} berhasil dihapus.`,
      data: employee,
    });
  })
);

module.exports = router;
module.exports.findDuplicateName = findDuplicateName;
module.exports.cleanAliases = cleanAliases;
module.exports.findEmployeeById = findEmployeeById;