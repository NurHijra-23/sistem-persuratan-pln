// Pratinjau formulir Excel SPPD (PDF sementara).
// File ini HANYA membaca hasil generateWorkbook() dari sppdExcel.js.
// Template, print area, page break, garis biru, dan rumus biaya tidak disentuh.
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");
const { promisify } = require("util");

const { generateWorkbook } = require("./sppdExcel");

const router = express.Router();
const execFileAsync = promisify(execFile);

// Lokasi LibreOffice. Default sama dengan yang dipakai pratinjau Word.
// Bisa diganti lewat variabel lingkungan SOFFICE_PATH bila perlu.
const WINDOWS_SOFFICE = "C:\\Program Files\\LibreOffice\\program\\soffice.exe";

function resolveSoffice() {
  if (process.env.SOFFICE_PATH) return process.env.SOFFICE_PATH;
  if (fs.existsSync(WINDOWS_SOFFICE)) return WINDOWS_SOFFICE;
  return "soffice";
}

// Satu konversi pada satu waktu agar LibreOffice tidak berebut profil/proses.
let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

async function convertXlsxToPdf(xlsxBuffer) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sppd-xlsx-preview-"));

  try {
    const xlsxPath = path.join(workDir, "preview.xlsx");
    const profileDir = path.join(workDir, "lo-profile");

    fs.writeFileSync(xlsxPath, xlsxBuffer);
    fs.mkdirSync(profileDir, { recursive: true });

    await execFileAsync(
      resolveSoffice(),
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        "--convert-to",
        "pdf:calc_pdf_Export",
        "--outdir",
        workDir,
        xlsxPath,
      ],
      { timeout: 90000, windowsHide: true }
    );

    const pdfPath = path.join(workDir, "preview.pdf");

    if (!fs.existsSync(pdfPath)) {
      throw new Error("LibreOffice tidak menghasilkan file PDF.");
    }

    return fs.readFileSync(pdfPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// Body sama persis dengan POST /api/sppd-excel/generate (satu perjalanan).
router.post("/excel", async (req, res) => {
  try {
    // Hasil workbook identik dengan yang diunduh pengguna.
    const xlsxBuffer = Buffer.from(await generateWorkbook([req.body]));
    const pdfBuffer = await enqueue(() => convertXlsxToPdf(xlsxBuffer));

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=SPPD-excel-preview.pdf");
    res.setHeader("Cache-Control", "no-store");

    return res.send(pdfBuffer);
  } catch (error) {
    console.error("SPPD Excel preview error:", error);

    return res.status(400).json({
      message: error.message || "Gagal membuat pratinjau Excel SPPD.",
    });
  }
});

module.exports = router;
