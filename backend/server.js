const express = require("express");
const cors = require("cors");
const sppdDocumentRoutes = require("./routes/sppdDocument");
const sppdExcelRoutes = require("./routes/sppdExcel");
const sppdEmployeeRoutes = require("./routes/sppdEmployees");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  ...(process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(",").map((url) => url.trim())
    : []),
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

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend SPPD TAD berjalan",
  });
});

// Data pegawai, perjalanan, dan draft kini disimpan di Supabase (lihat routes/sppdEmployees.js,
// routes/sppdTrips.js, dan routes/sppdDrafts.js). File JSON lama di folder data/ hanya cadangan.
app.use("/api/trips", require("./routes/sppdTrips"));
app.use("/api/sppd-excel", sppdExcelRoutes);
app.use("/api/sppd-gabungan", require("./routes/sppdCombined"));
app.use("/api/sppd-preview", require("./routes/sppdPreview"));
app.use("/api/drafts", require("./routes/sppdDrafts"));
app.use("/api/employees", sppdEmployeeRoutes);


app.listen(PORT, () => {
  console.log(`Backend berjalan di http://localhost:${PORT}`);
});