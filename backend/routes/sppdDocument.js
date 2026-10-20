
const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

const router = express.Router();
const execFileAsync = promisify(execFile);

const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "templates",
  "sppd-template-otomatis.docx"
);

const SOFFICE_PATH =
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe";

function createDocx(data) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error("Template Word otomatis tidak ditemukan.");
  }

  const requiredFields = [
    "tanggalSurat",
    "perihal",
    "subPerihal",
    "penerima",
    "namaPegawai",
    "maksud",
    "tujuan",
    "durasi",
    "durasiTerbilang",
    "tanggalBerangkat",
    "tanggalKembali",
    "namaManajer",
  ];

  const missingFields = requiredFields.filter(
    (field) =>
      data[field] === undefined ||
      data[field] === null ||
      String(data[field]).trim() === ""
  );

  if (missingFields.length) {
    const error = new Error("Data surat belum lengkap.");
    error.status = 400;
    error.fields = missingFields;
    throw error;
  }

  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

 doc.render({
  tanggalSurat: String(data.tanggalSurat),
  perihal: String(data.perihal),
  subPerihal: String(data.subPerihal),
  penerima: String(data.penerima),
  namaPegawai: String(data.namaPegawai).toLocaleUpperCase("id-ID"),
  maksud: String(data.maksud),
  tujuan: String(data.tujuan),
  durasi: String(data.durasi),
  durasiTerbilang: String(data.durasiTerbilang),
  tanggalBerangkat: String(data.tanggalBerangkat),
  tanggalKembali: String(data.tanggalKembali),
  namaManajer: String(data.namaManajer).toLocaleUpperCase("id-ID"),
});

  return doc.toBuffer();
}

function sendError(res, error) {
  console.error("SPPD document error:", error);

  return res.status(error.status || 500).json({
    message: error.message || "Gagal memproses dokumen SPPD.",
    fields: error.fields || [],
    detail:
      error.properties?.errors
        ?.map((item) => item.properties?.explanation)
        .filter(Boolean) || [],
  });
}

// Unduh dokumen Word

const DocxMerger = require("docx-merger");


function mergeDocxBuffers(buffers) {
  return new Promise((resolve, reject) => {
    try {
      if (!buffers.length) {
        throw new Error("Tidak ada surat SPPD untuk digabungkan.");
      }

      if (buffers.length === 1) {
        return resolve(buffers[0]);
      }

      const merger = new DocxMerger(
        { pageBreak: true },
        buffers
      );

      merger.save("nodebuffer", (data) => {
        if (!data) {
          reject(new Error("Gagal menggabungkan dokumen Word."));
          return;
        }

        resolve(Buffer.from(data));
      });
    } catch (error) {
      reject(error);
    }
  });
}


// Unduh satu atau beberapa surat dalam satu file Word.
router.post("/generate", async (req, res) => {
  try {
    const items = Array.isArray(req.body.items)
      ? req.body.items
      : [req.body];

    if (items.length === 0) {
      return res.status(400).json({
        message: "Minimal satu data SPPD harus dikirim.",
      });
    }

    if (items.length > 100) {
      return res.status(400).json({
        message: "Maksimal 100 surat SPPD dalam satu dokumen.",
      });
    }

    const buffers = items.map((item) => createDocx(item));
    const finalBuffer = await mergeDocxBuffers(buffers);

    const safeName = String(items[0].namaPegawai || "Karyawan")
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "");

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="SPPD_${safeName}_${items.length}_surat.docx"`
    );

    return res.send(finalBuffer);
  } catch (error) {
    return sendError(res, error);
  }
});


// Pratinjau dokumen dari template Word dalam bentuk PDF
router.post("/preview", async (req, res) => {
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "sppd-preview-")
  );

  try {
    if (!fs.existsSync(SOFFICE_PATH)) {
      throw new Error(
        "LibreOffice tidak ditemukan pada lokasi instalasi yang dikonfigurasi."
      );
    }

    const docxBuffer = createDocx(req.body);
    const docxPath = path.join(workDir, "preview.docx");

    fs.writeFileSync(docxPath, docxBuffer);

   const profileDir = path.join(workDir, "lo-profile");

fs.mkdirSync(profileDir, { recursive: true });

await execFileAsync(
  SOFFICE_PATH,
  [
    "--headless",
    "--nologo",
    "--nodefault",
    "--nofirststartwizard",
    `-env:UserInstallation=${require("url").pathToFileURL(profileDir).href}`,
    "--convert-to",
    "pdf:writer_pdf_Export",
    "--outdir",
    workDir,
    docxPath,
  ],
  {
    timeout: 60000,
    windowsHide: true,
  }
);

    const pdfPath = path.join(workDir, "preview.pdf");

    if (!fs.existsSync(pdfPath)) {
      throw new Error("LibreOffice tidak menghasilkan file PDF.");
    }

    const pdfBuffer = fs.readFileSync(pdfPath);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=SPPD-preview.pdf");
    res.setHeader("Cache-Control", "no-store");

    return res.send(pdfBuffer);
  } catch (error) {
    return sendError(res, error);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

module.exports = router;

module.exports.createDocx = createDocx;
