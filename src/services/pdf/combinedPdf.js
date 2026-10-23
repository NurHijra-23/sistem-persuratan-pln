// Unduh Gabungan PDF: satu PDF berisi surat SPPD lalu formulir perhitungan untuk setiap perjalanan
// (surat 1, formulir 1, surat 2, formulir 2, ...), lengkap dengan tanda tangan/paraf yang diunggah.
// Semua proses berjalan di browser.
import { PDFDocument, rgb } from "pdf-lib";

import { createCombinedDocx } from "../sppd/combined.js";
import { renderDocxPages } from "./rasterPages.js";
import { dataUrlToBytes, normalizeSignatureSettings } from "../signatures.js";
import { readLetterDecorations } from "./letterDecor.js";
import { slotRect } from "./placement.js";

const PX_TO_PT = 0.75; // 96 dpi -> 72 dpi

function classifyPage(text) {
  if (text.includes("MANAGER ULTG PAREPARE")) return "letter";
  if (text.includes("BIAYA PERJALANAN DINAS")) return "form";
  return "other";
}

const toPt = (box) =>
  box && { left: box.left * PX_TO_PT, right: box.right * PX_TO_PT, top: box.top * PX_TO_PT, bottom: box.bottom * PX_TO_PT };

async function embedDataUrl(pdf, dataUrl, cache) {
  if (cache.has(dataUrl)) return cache.get(dataUrl);

  const { bytes, isPng } = dataUrlToBytes(dataUrl);
  const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

  cache.set(dataUrl, image);
  return image;
}

function drawRect(page, pageHeightPt, image, rect, opacity = 1) {
  page.drawImage(image, {
    x: rect.left,
    y: pageHeightPt - rect.top - rect.height,
    width: rect.width,
    height: rect.height,
    ...(opacity < 1 ? { opacity } : {}),
  });
}

// items          : payload surat per perjalanan (hasil buildSppdPayload)
// trips          : payload formulir Excel per perjalanan (urutan sama)
// signatures     : pengaturan posisi/gambar dari signatures.js (boleh kosong)
// employeeImages : data URL tanda tangan karyawan per perjalanan (sejajar dengan trips; null = tanpa)
// Hasil menyertakan `layouts` (posisi anchor tiap halaman, dalam pt) untuk editor posisi.
export async function buildCombinedPdf({ items, trips, signatures, employeeImages = [] }) {
  if (!Array.isArray(items) || !Array.isArray(trips) || items.length === 0 || items.length !== trips.length) {
    throw new Error("Data surat dan data perjalanan harus ada dan jumlahnya sama.");
  }

  const settings = normalizeSignatureSettings(signatures);
  const avoidText = settings.avoidText !== false;
  const slotOn = (key) => {
    const slot = settings.slots[key];
    return slot && slot.enabled && slot.dataUrl ? slot : null;
  };
  const employeeSlot = settings.slots.employee?.enabled ? settings.slots.employee : null;

  const docx = await createCombinedDocx(items, trips);
  const decor = await readLetterDecorations();
  const rendered = await renderDocxPages(docx);

  try {
    const pdf = await PDFDocument.create();
    pdf.setTitle("SPPD ULTG Parepare");
    pdf.setProducer("Sistem Persuratan PLN (browser)");

    const imageCache = new Map();
    const order = [];
    const layouts = [];
    const warnings = [];
    let letterIndex = 0;
    let formIndex = 0;

    for (const info of rendered.pages) {
      const kind = classifyPage(info.text);
      const raster = await info.rasterize();
      const widthPt = raster.exactWidth * PX_TO_PT;
      const heightPt = raster.exactHeight * PX_TO_PT;

      const page = pdf.addPage([widthPt, heightPt]);
      const jpeg = await pdf.embedJpg(raster.jpeg);
      page.drawImage(jpeg, { x: 0, y: 0, width: widthPt, height: heightPt });

      const layout = {};

      if (kind === "letter") {
        const label = `surat ${letterIndex + 1}`;

        // Kop surat (gambar header) dan garis paraf: dibaca dari template Word.
        for (const header of decor.headerImages) {
          const image = await pdf.embedJpg(header.bytes);
          page.drawImage(image, { x: header.xPt, y: heightPt - header.yPt - header.hPt, width: header.wPt, height: header.hPt });
        }

        const parafText = toPt(info.locate("Paraf"));

        if (decor.lines.length && parafText) {
          const line = decor.lines[0];
          const x = decor.pageMarginLeftPt + line.xPt;

          page.drawLine({
            start: { x, y: heightPt - parafText.bottom },
            end: { x: x + line.wPt, y: heightPt - parafText.bottom },
            thickness: line.widthPt,
            color: rgb(...[0, 2, 4].map((i) => parseInt(line.color.slice(i, i + 2), 16) / 255)),
          });
          layout.parafLine = { left: x, width: line.wPt, bottomTop: parafText.bottom };
        }

        const managerName = String(items[letterIndex]?.namaManajer || "").toLocaleUpperCase("id-ID");
        layout.paraf = parafText;
        layout.manager = toPt(info.locate(managerName));
        layout.managerTitle = toPt(info.locate("MANAGER ULTG PAREPARE"));
        layout.page = { widthPt, heightPt };
        layout.margins = { left: decor.pageMarginLeftPt, right: decor.pageMarginRightPt };

        // Stempel digambar terakhir (di atas tanda tangan manajer) dengan opasitas yang diatur pengguna.
        for (const key of ["manager", "paraf1", "paraf2", "paraf3", "stamp"]) {
          const slot = slotOn(key);
          if (!slot) continue;

          const rect = slotRect(key, slot, layout, { avoidText, slots: settings.slots });

          if (rect) {
            drawRect(page, heightPt, await embedDataUrl(pdf, slot.dataUrl, imageCache), rect, slot.opacity);
          } else {
            warnings.push(
              key === "manager"
                ? `Nama manajer tidak ditemukan pada ${label}; tanda tangan manajer tidak ditempatkan.`
                : key === "stamp"
                  ? `Nama manajer tidak ditemukan pada ${label}; stempel tidak ditempatkan.`
                  : `Bagian "Paraf" tidak ditemukan pada ${label}; paraf tidak ditempatkan.`
            );
          }
        }

        letterIndex += 1;
      } else if (kind === "form") {
        const label = `formulir ${formIndex + 1}`;
        const name = String(trips[formIndex]?.employeeName || "").trim().toLocaleUpperCase("id-ID");

        layout.employee = toPt(info.locate(name, { last: true }));
        layout.employeeLabel = toPt(info.locate("Pelaksana Pemeliharaan"));

        const dataUrl = employeeImages[formIndex];

        if (employeeSlot && dataUrl) {
          const rect = slotRect("employee", employeeSlot, layout, { avoidText, ratio: await ratioOf(pdf, dataUrl, imageCache) });

          if (rect) {
            drawRect(page, heightPt, await embedDataUrl(pdf, dataUrl, imageCache), rect);
          } else {
            warnings.push(`Nama karyawan tidak ditemukan pada ${label}; tanda tangan karyawan tidak ditempatkan.`);
          }
        }

        formIndex += 1;
      }

      layouts.push({ kind, widthPt, heightPt, layout });
      order.push(kind);
    }

    const bytes = await pdf.save();

    return { bytes, pageCount: order.length, order, layouts, warnings, letters: letterIndex, forms: formIndex };
  } finally {
    rendered.dispose();
  }
}

async function ratioOf(pdf, dataUrl, cache) {
  const image = await embedDataUrl(pdf, dataUrl, cache);
  return image.height / image.width;
}
