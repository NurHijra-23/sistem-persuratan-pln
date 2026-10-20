// Manajemen personel: edit dan hapus.
// GET dan POST /api/employees tetap berada di server.js (hanya ditambah filter aktif dan cek duplikat).
// File ini menangani PUT /api/employees/:id dan DELETE /api/employees/:id.
const express = require("express");
const fs = require("fs");
const path = require("path");

const { resolveSheetName } = require("./sppdExcel");

const router = express.Router();

const dataDir = path.join(__dirname, "..", "data");
const employeesFile = path.join(dataDir, "employees.json");
const tripsFile = path.join(dataDir, "trips.json");
const draftsFile = path.join(dataDir, "drafts.json");

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readEmployees() {
  return readJson(employeesFile);
}

// Tulis ke file sementara lalu ganti, agar employees.json tidak rusak bila proses terhenti.
function saveEmployees(employees) {
  const tempFile = `${employeesFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(employees, null, 2), "utf8");
  fs.renameSync(tempFile, employeesFile);
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

function isEmployeeUsed(employeeId) {
  const inTrips = readJson(tripsFile).some(
    (trip) => String(trip.employeeId) === String(employeeId)
  );

  const inDrafts = readJson(draftsFile).some((draft) =>
    (draft.results || []).some(
      (trip) => String(trip.employeeId) === String(employeeId)
    )
  );

  return inTrips || inDrafts;
}

// Migrasi satu kali: isi sheetName untuk personel yang sudah dipetakan oleh tabel sheet bawaan,
// agar pemetaan Excel tetap berjalan walaupun nama personel kelak diedit.
// Tidak membuat pemetaan baru: hanya menyalin yang sudah berlaku.
function migrateSheetNames() {
  const employees = readEmployees();
  let changed = false;

  for (const employee of employees) {
    if (employee.sheetName) continue;

    const sheetName = [employee.name, employee.nickname, ...(employee.aliases || [])]
      .map((value) => resolveSheetName(value))
      .find(Boolean);

    if (sheetName) {
      employee.sheetName = sheetName;
      changed = true;
    }
  }

  if (changed) {
    const backupFile = `${employeesFile}.bak`;
    if (!fs.existsSync(backupFile)) {
      fs.copyFileSync(employeesFile, backupFile);
    }
    saveEmployees(employees);
    console.log("employees.json: sheetName diisi untuk personel yang sudah dipetakan.");
  }
}

try {
  migrateSheetNames();
} catch (error) {
  console.error("Migrasi sheetName dilewati:", error.message);
}

// Edit personel (nama, nama singkat, alias, jabatan). ID tetap.
router.put("/:id", (req, res) => {
  const employees = readEmployees();
  const index = employees.findIndex(
    (employee) => employee.id === req.params.id && employee.active !== false
  );

  if (index === -1) {
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

  const duplicate = findDuplicateName(employees, name, req.params.id);

  if (duplicate) {
    return res.status(409).json({
      message: `Nama "${duplicate.name}" sudah terdaftar sebagai personel lain.`,
    });
  }

  const current = employees[index];

  // Pertahankan pemetaan sheet Excel sebelum nama berubah.
  const sheetName = current.sheetName || resolveSheetName(current.name);

  const updated = {
    ...current,
    name,
    nickname:
      req.body?.nickname === undefined
        ? current.nickname || ""
        : String(req.body.nickname || "").trim(),
    aliases:
      req.body?.aliases === undefined
        ? current.aliases || []
        : cleanAliases(req.body.aliases),
    position,
    updatedAt: new Date().toISOString(),
  };

  if (sheetName) updated.sheetName = sheetName;

  employees[index] = updated;
  saveEmployees(employees);

  res.json({
    success: true,
    message: "Data personel berhasil diperbarui.",
    data: updated,
  });
});

// Hapus personel. Bila sudah dipakai pada riwayat perjalanan atau draft, personel hanya dinonaktifkan
// (soft delete) agar riwayat tidak kehilangan rujukan. Riwayat perjalanan dan dokumen tidak disentuh.
router.delete("/:id", (req, res) => {
  const employees = readEmployees();
  const index = employees.findIndex(
    (employee) => employee.id === req.params.id && employee.active !== false
  );

  if (index === -1) {
    return res.status(404).json({ message: "Personel tidak ditemukan." });
  }

  const employee = employees[index];

  if (isEmployeeUsed(employee.id)) {
    employees[index] = {
      ...employee,
      active: false,
      deletedAt: new Date().toISOString(),
    };
    saveEmployees(employees);

    return res.json({
      success: true,
      softDeleted: true,
      message: `${employee.name} dihapus dari daftar personel. Riwayat perjalanan tetap tersimpan.`,
      data: employees[index],
    });
  }

  employees.splice(index, 1);
  saveEmployees(employees);

  res.json({
    success: true,
    softDeleted: false,
    message: `${employee.name} berhasil dihapus.`,
    data: employee,
  });
});

module.exports = router;
module.exports.findDuplicateName = findDuplicateName;
module.exports.cleanAliases = cleanAliases;
