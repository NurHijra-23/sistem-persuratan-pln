// Perjalanan dinas - versi Supabase (tabel `trips`).
// Menangani GET, POST, PUT, dan DELETE untuk /api/trips.
// File trips.json TIDAK lagi dibaca atau ditulis (tetap utuh sebagai cadangan).
const express = require("express");

const supabase = require("../supabase");
const { findEmployeeById } = require("./sppdEmployees");

const router = express.Router();

const TRIPS = "trips";

// Express 4 tidak menangkap error dari fungsi async, jadi dibungkus agar server tidak mati.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error("[trips]", err);
      res.status(500).json({ message: "Terjadi kesalahan pada server saat memproses data perjalanan." });
    }
  };
}

// Baris database (snake_case) -> objek perjalanan (camelCase) seperti format lama.
function rowToTrip(row) {
  const trip = {
    id: row.id,
    employeeId: row.employee_id || "",
    employeeName: row.employee_name,
    purpose: row.purpose || "",
    destination: row.destination || "",
    startDate: row.start_date,
    endDate: row.end_date,
    durationDays: row.duration_days,
    transport: row.transport || "",
    createdAt: row.created_at,
  };

  // Sama seperti dulu: updatedAt hanya ada bila perjalanan pernah diedit.
  if (row.updated_at && row.updated_at !== row.created_at) {
    trip.updatedAt = row.updated_at;
  }

  return trip;
}

// ID unik; tambahan 3 digit acak mencegah bentrok bila dua perjalanan disimpan pada milidetik yang sama.
function createTripId() {
  return `${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}

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

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Mengambil seluruh perjalanan dinas (urut dari yang paling lama dibuat, seperti sebelumnya).
router.get(
  "/",
  handle(async (req, res) => {
    const { data, error } = await supabase
      .from(TRIPS)
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json(data.map(rowToTrip));
  })
);

// Menyimpan perjalanan dinas.
router.post(
  "/",
  handle(async (req, res) => {
    const { employeeId, purpose, destination, startDate, endDate, transport } = req.body || {};

    if (!employeeId || !hasText(purpose) || !hasText(destination) || !startDate || !endDate) {
      return res.status(400).json({
        message: "Data karyawan, maksud, tujuan, dan tanggal wajib diisi.",
      });
    }

    if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) {
      return res.status(400).json({
        message: "Tanggal perjalanan tidak valid.",
      });
    }

    const employee = await findEmployeeById(employeeId);

    if (!employee) {
      return res.status(400).json({
        message: "Karyawan tidak ditemukan. Periksa data karyawan.",
      });
    }

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from(TRIPS)
      .insert({
        id: createTripId(),
        employee_id: employee.id,
        employee_name: employee.name,
        purpose: purpose.trim(),
        destination: destination.trim(),
        start_date: startDate,
        end_date: endDate,
        duration_days: calculateDuration(startDate, endDate),
        transport: String(transport || "").trim(),
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: "Perjalanan dinas berhasil disimpan.",
      trip: rowToTrip(data),
    });
  })
);

// Hapus perjalanan.
router.delete(
  "/:id",
  handle(async (req, res) => {
    const { data, error } = await supabase
      .from(TRIPS)
      .delete()
      .eq("id", req.params.id)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({
        message: "Data perjalanan tidak ditemukan.",
      });
    }

    res.json({
      success: true,
      message: "Data perjalanan berhasil dihapus.",
      data: rowToTrip(data[0]),
    });
  })
);

// Perbarui perjalanan (ID dan tanggal dibuat tetap).
router.put(
  "/:id",
  handle(async (req, res) => {
    const { data: existing, error: findError } = await supabase
      .from(TRIPS)
      .select("id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;

    if (!existing) {
      return res.status(404).json({
        message: "Data perjalanan tidak ditemukan.",
      });
    }

    const { employeeId, purpose, destination, startDate, endDate, transport } = req.body || {};

    if (!employeeId || !hasText(purpose) || !hasText(destination) || !startDate || !endDate) {
      return res.status(400).json({
        message: "Nama karyawan, tujuan, maksud, dan tanggal wajib diisi.",
      });
    }

    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({
        message: "Format tanggal tidak valid.",
      });
    }

    if (endDate < startDate) {
      return res.status(400).json({
        message: "Tanggal kembali tidak boleh sebelum tanggal berangkat.",
      });
    }

    const employee = await findEmployeeById(employeeId);

    if (!employee) {
      return res.status(400).json({
        message: "Karyawan tidak ditemukan. Silakan pilih karyawan yang valid.",
      });
    }

    const { data, error } = await supabase
      .from(TRIPS)
      .update({
        employee_id: employee.id,
        employee_name: employee.name,
        purpose: purpose.trim(),
        destination: destination.trim(),
        start_date: startDate,
        end_date: endDate,
        duration_days: calculateDuration(startDate, endDate),
        transport: String(transport || "").trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Perjalanan berhasil diperbarui.",
      data: rowToTrip(data),
    });
  })
);

module.exports = router;