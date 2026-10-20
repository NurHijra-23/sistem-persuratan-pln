
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const supabase = require("./supabase");

const dataDir = path.join(__dirname, "data");
const employeesFile = path.join(dataDir, "employees.json");
const draftsFile = path.join(dataDir, "drafts.json");

function readJsonArray(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`File tidak ditemukan: ${file}`);
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8"));

  if (!Array.isArray(data)) {
    throw new Error(`Isi ${path.basename(file)} bukan array.`);
  }

  return data;
}

async function migrateEmployees() {
  const employees = readJsonArray(employeesFile);
  let inserted = 0;
  let skipped = 0;

  for (const employee of employees) {
    if (!employee.id || !employee.name) {
      throw new Error("Ada pegawai tanpa ID atau nama. Migrasi dihentikan.");
    }

    const { data: existing, error: findError } = await supabase
      .from("employees")
      .select("id")
      .eq("id", String(employee.id))
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      console.log(`Pegawai ID ${employee.id}: sudah ada, dilewati.`);
      skipped++;
      continue;
    }

    const record = {
      id: String(employee.id),
      name: employee.name,
      nickname: employee.nickname || null,
      aliases: Array.isArray(employee.aliases) ? employee.aliases : [],
      position: employee.position || null,
      sheet_name: employee.sheetName || null,
      active: employee.active !== false,
      deleted_at: employee.deletedAt || null,
      created_at: employee.createdAt || new Date().toISOString(),
      updated_at: employee.updatedAt || employee.createdAt || new Date().toISOString(),
    };

    const { error: insertError } = await supabase
      .from("employees")
      .insert(record);

    if (insertError) throw insertError;

    inserted++;
    console.log(`Pegawai ID ${employee.id}: berhasil dimigrasikan.`);
  }

  console.log(`Pegawai: ${inserted} ditambahkan, ${skipped} dilewati.`);
}

async function migrateDrafts() {
  const drafts = readJsonArray(draftsFile);
  let inserted = 0;
  let skipped = 0;

  for (const draft of drafts) {
    if (!draft.id) {
      throw new Error("Ada draft tanpa ID. Migrasi dihentikan.");
    }

    const { data: existing, error: findError } = await supabase
      .from("sppd_drafts")
      .select("id")
      .eq("id", String(draft.id))
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      console.log(`Draft ID ${draft.id}: sudah ada, dilewati.`);
      skipped++;
      continue;
    }

    // Simpan objek draft lengkap sebagai JSONB agar struktur aslinya tetap terjaga.
    const { error: insertError } = await supabase
      .from("sppd_drafts")
      .insert({
        id: String(draft.id),
        data: draft,
        created_at: draft.createdAt || new Date().toISOString(),
        updated_at: draft.updatedAt || draft.createdAt || new Date().toISOString(),
      });

    if (insertError) throw insertError;

    inserted++;
    console.log(`Draft ID ${draft.id}: berhasil dimigrasikan.`);
  }

  console.log(`Draft: ${inserted} ditambahkan, ${skipped} dilewati.`);
}

async function main() {
  console.log("Memulai migrasi pegawai...");
  await migrateEmployees();

  console.log("\nMemulai migrasi draft...");
  await migrateDrafts();

  console.log("\nMigrasi selesai.");
  console.log("File JSON lokal tidak diubah.");
  console.log("trips.json tidak dibaca atau dimigrasikan.");
}

main().catch((error) => {
  console.error("\nMigrasi gagal:", error.message);
  process.exitCode = 1;
});
