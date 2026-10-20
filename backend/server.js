const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const sppdDocumentRoutes = require("./routes/sppdDocument");
const sppdExcelRoutes = require("./routes/sppdExcel");
const sppdEmployeeRoutes = require("./routes/sppdEmployees");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "data");
const employeesFile = path.join(dataDir, "employees.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(employeesFile)) {
  fs.writeFileSync(employeesFile, "[]", "utf8");
}

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin tidak diizinkan oleh CORS."));
    },
  })
);
app.use(express.json());
app.use("/api/sppd", sppdDocumentRoutes);

function readEmployees() {
  return JSON.parse(fs.readFileSync(employeesFile, "utf8"));
}

function saveEmployees(employees) {
  fs.writeFileSync(
    employeesFile,
    JSON.stringify(employees, null, 2),
    "utf8"
  );
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend SPPD TAD berjalan",
  });
});

app.get("/api/employees", (req, res) => {
  // Personel yang dinonaktifkan (soft delete) tidak ditampilkan; riwayat perjalanan tetap utuh.
  res.json(readEmployees().filter((employee) => employee.active !== false));
});

app.post("/api/employees", (req, res) => {
  const { name, nickname, position } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({
      message: "Nama lengkap wajib diisi.",
    });
  }

  const employees = readEmployees();

  // Cegah personel ganda (termasuk akibat tombol simpan ditekan berulang).
  const duplicate = sppdEmployeeRoutes.findDuplicateName(employees, name);

  if (duplicate) {
    return res.status(409).json({
      message: `Nama "${duplicate.name}" sudah terdaftar.`,
    });
  }

  const employee = {
    id: Date.now().toString(),
    name: name.trim(),
    nickname: (nickname || "").trim(),
    aliases: sppdEmployeeRoutes.cleanAliases(req.body.aliases),
    position: (position || "Tenaga Pemeliharaan ULTG Parepare").trim(),
    createdAt: new Date().toISOString(),
  };

  employees.push(employee);
  saveEmployees(employees);

  res.status(201).json(employee);
});


const tripsFile = path.join(dataDir, "trips.json");

if (!fs.existsSync(tripsFile)) {
  fs.writeFileSync(tripsFile, "[]", "utf8");
}

function readTrips() {
  return JSON.parse(fs.readFileSync(tripsFile, "utf8"));
}

function saveTrips(trips) {
  fs.writeFileSync(tripsFile, JSON.stringify(trips, null, 2), "utf8");
}

// Mengambil seluruh perjalanan dinas
app.get("/api/trips", (req, res) => {
  res.json(readTrips());
});

// Menyimpan perjalanan dinas
app.post("/api/trips", (req, res) => {
  const {
    employeeId,
    purpose,
    destination,
    startDate,
    endDate,
    transport,
  } = req.body;

  if (
    !employeeId ||
    !purpose?.trim() ||
    !destination?.trim() ||
    !startDate ||
    !endDate
  ) {
    return res.status(400).json({
      message: "Data karyawan, maksud, tujuan, dan tanggal wajib diisi.",
    });
  }

  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString().slice(0, 10) !== startDate ||
    end.toISOString().slice(0, 10) !== endDate ||
    end < start
  ) {
    return res.status(400).json({
      message: "Tanggal perjalanan tidak valid.",
    });
  }

  const employees = readEmployees();
  const employee = employees.find(
    (item) => item.id === String(employeeId)
  );

  if (!employee) {
    return res.status(400).json({
      message: "Karyawan tidak ditemukan. Periksa data karyawan.",
    });
  }

  const durationDays =
    Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

  const trips = readTrips();

  const trip = {
    id: Date.now().toString(),
    employeeId: employee.id,
    employeeName: employee.name,
    purpose: purpose.trim(),
    destination: destination.trim(),
    startDate,
    endDate,
    durationDays,
    transport: (transport || "").trim(),
    createdAt: new Date().toISOString(),
  };

  trips.push(trip);
  saveTrips(trips);

  res.status(201).json({
    message: "Perjalanan dinas berhasil disimpan.",
    trip,
  });
});


app.delete("/api/trips/:id", (req, res) => {
  const trips = readTrips();
  const tripIndex = trips.findIndex(
    (trip) => trip.id === req.params.id
  );

  if (tripIndex === -1) {
    return res.status(404).json({
      message: "Data perjalanan tidak ditemukan.",
    });
  }

  const deletedTrip = trips[tripIndex];

  trips.splice(tripIndex, 1);
  saveTrips(trips);

  res.json({
    success: true,
    message: "Data perjalanan berhasil dihapus.",
    data: deletedTrip,
  });
});


app.put("/api/trips/:id", (req, res) => {
  const trips = readTrips();
  const tripIndex = trips.findIndex(
    (trip) => trip.id === req.params.id
  );

  if (tripIndex === -1) {
    return res.status(404).json({
      message: "Data perjalanan tidak ditemukan.",
    });
  }

  const {
    employeeId,
    purpose,
    destination,
    startDate,
    endDate,
    transport,
  } = req.body;

  if (
    !employeeId ||
    !purpose?.trim() ||
    !destination?.trim() ||
    !startDate ||
    !endDate
  ) {
    return res.status(400).json({
      message: "Nama karyawan, tujuan, maksud, dan tanggal wajib diisi.",
    });
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  function isValidDate(value) {
    if (!datePattern.test(value)) return false;

    const date = new Date(`${value}T00:00:00.000Z`);

    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
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

  const employees = readEmployees();
  const employee = employees.find(
    (item) => item.id === employeeId
  );

  if (!employee) {
    return res.status(400).json({
      message: "Karyawan tidak ditemukan. Silakan pilih karyawan yang valid.",
    });
  }

  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  const durationDays =
    Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

  const updatedTrip = {
    ...trips[tripIndex],
    employeeId,
    employeeName: employee.name,
    purpose: purpose.trim(),
    destination: destination.trim(),
    startDate,
    endDate,
    durationDays,
    transport: (transport || "").trim(),
    updatedAt: new Date().toISOString(),
  };

  trips[tripIndex] = updatedTrip;
  saveTrips(trips);

  res.json({
    success: true,
    message: "Perjalanan berhasil diperbarui.",
    data: updatedTrip,
  });
});

app.use("/api/sppd-excel", sppdExcelRoutes);
app.use("/api/sppd-gabungan", require("./routes/sppdCombined"));
app.use("/api/sppd-preview", require("./routes/sppdPreview"));
app.use("/api/drafts", require("./routes/sppdDrafts"));
app.use("/api/employees", sppdEmployeeRoutes);


app.listen(PORT, () => {
  console.log(`Backend berjalan di http://localhost:${PORT}`);
});