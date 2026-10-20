const express = require("express");
const PizZip = require("pizzip");

const sppdDocumentRoutes = require("./sppdDocument");
const sppdExcelToWord = require("./sppdExcelToWord");

const router = express.Router();

const FORM_PAGE = sppdExcelToWord.FORM_PAGE;

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_IMAGE = `${NS_R}/image`;
const REL_HEADER = `${NS_R}/header`;
const REL_FOOTER = `${NS_R}/footer`;

const BLANK_HEADER_PART = "word/sppdBlankHeader.xml";
const BLANK_FOOTER_PART = "word/sppdBlankFooter.xml";
const BLANK_HEADER_REL = "rIdSppdBlankHeader";
const BLANK_FOOTER_REL = "rIdSppdBlankFooter";

function readBody(zip) {
  const xml = zip.file("word/document.xml").asText();
  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const sectStart = xml.lastIndexOf("<w:sectPr");
  const sectEnd = xml.indexOf("</w:sectPr>", sectStart) + "</w:sectPr>".length;

  if (bodyStart < 8 || sectStart < 0 || sectEnd < sectStart) {
    throw new Error("Struktur surat Word tidak dikenali.");
  }

  return {
    head: xml.slice(0, bodyStart),
    body: xml.slice(bodyStart, sectStart),
    sectPr: xml.slice(sectStart, sectEnd),
  };
}

// sectPr ditempel pada paragraf terakhir agar tidak muncul paragraf kosong baru
// yang bisa mendorong halaman kosong bila surat penuh satu halaman.
function attachSectPr(bodyXml, sectPrXml) {
  const closeIndex = bodyXml.lastIndexOf("</w:p>");

  if (closeIndex < 0) {
    return `${bodyXml}<w:p><w:pPr>${sectPrXml}</w:pPr></w:p>`;
  }

  const openIndex = Math.max(
    bodyXml.lastIndexOf("<w:p ", closeIndex),
    bodyXml.lastIndexOf("<w:p>", closeIndex)
  );

  const paragraph = bodyXml.slice(openIndex, closeIndex);
  const pPrClose = paragraph.indexOf("</w:pPr>");
  let patched;

  if (pPrClose >= 0) {
    patched =
      paragraph.slice(0, pPrClose) + sectPrXml + paragraph.slice(pPrClose);
  } else {
    const openTagEnd = paragraph.indexOf(">") + 1;
    patched =
      paragraph.slice(0, openTagEnd) +
      `<w:pPr>${sectPrXml}</w:pPr>` +
      paragraph.slice(openTagEnd);
  }

  return bodyXml.slice(0, openIndex) + patched + bodyXml.slice(closeIndex);
}

// Section halaman formulir: A4, margin 1 cm, header/footer kosong agar kop surat
// tidak ikut tercetak pada halaman formulir.
function formSectPr() {
  return (
    "<w:sectPr>" +
    `<w:headerReference w:type="default" r:id="${BLANK_HEADER_REL}"/>` +
    `<w:footerReference w:type="default" r:id="${BLANK_FOOTER_REL}"/>` +
    `<w:pgSz w:w="${FORM_PAGE.width}" w:h="${FORM_PAGE.height}"/>` +
    `<w:pgMar w:top="${FORM_PAGE.marginTop}" w:right="${FORM_PAGE.marginRight}" ` +
    `w:bottom="${FORM_PAGE.marginBottom}" w:left="${FORM_PAGE.marginLeft}" ` +
    'w:header="0" w:footer="0" w:gutter="0"/>' +
    '<w:cols w:space="720"/>' +
    "</w:sectPr>"
  );
}

// Setelah tabel, Word wajib memiliki paragraf. Paragraf ini dibuat setinggi 1 pt
// agar tidak mendorong halaman kosong; sectPr pemisah halaman ditempel di sini.
function formClosingParagraph(sectPrXml) {
  return (
    "<w:p><w:pPr>" +
    '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
    '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>' +
    sectPrXml +
    "</w:pPr></w:p>"
  );
}

function blankPart(rootName) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:${rootName} xmlns:w="${NS_W}" xmlns:r="${NS_R}">` +
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>' +
    `</w:${rootName}>`
  );
}

function insertBefore(text, marker, addition) {
  const index = text.lastIndexOf(marker);

  if (index < 0) {
    throw new Error(`Penanda ${marker} tidak ditemukan pada paket DOCX.`);
  }

  return text.slice(0, index) + addition + text.slice(index);
}

// letterBuffers[i] = surat Word perjalanan ke-i, formTables[i] = tabel Word (w:tbl)
// hasil konversi formulir Excel perjalanan ke-i. images = daftar logo yang dipakai.
// Urutan hasil: surat 1, formulir 1, surat 2, formulir 2, dan seterusnya.
function buildCombinedDocx(letterBuffers, formTables, images = []) {
  if (!letterBuffers.length || letterBuffers.length !== formTables.length) {
    throw new Error("Jumlah surat dan formulir Excel tidak sama.");
  }

  const zips = letterBuffers.map((buffer) => new PizZip(buffer));
  const base = zips[0];
  const first = readBody(base);

  const letterSectPr = first.sectPr.replace(/<w:type\b[^>]*\/>/, "");
  const formSect = formSectPr();
  const lastIndex = letterBuffers.length - 1;
  const parts = [];

  zips.forEach((zip, index) => {
    let { body } = readBody(zip);

    // Buang ID paragraf Word pada surat kedua dan seterusnya agar tidak ada ID ganda.
    if (index > 0) {
      body = body.replace(/\sw14:(?:paraId|textId)="[0-9A-Fa-f]+"/g, "");
    }

    parts.push(attachSectPr(body, letterSectPr));
    parts.push(formTables[index]);
    parts.push(formClosingParagraph(index === lastIndex ? "" : formSect));
  });

  const documentXml = `${first.head}${parts.join("")}${formSect}</w:body></w:document>`;
  base.file("word/document.xml", documentXml);

  base.file(BLANK_HEADER_PART, blankPart("hdr"));
  base.file(BLANK_FOOTER_PART, blankPart("ftr"));

  images.forEach((image) => {
    base.file(image.partName, image.buffer);
  });

  const relFile = "word/_rels/document.xml.rels";
  let relXml = base.file(relFile).asText();
  let relAdd =
    `<Relationship Id="${BLANK_HEADER_REL}" Type="${REL_HEADER}" Target="sppdBlankHeader.xml"/>` +
    `<Relationship Id="${BLANK_FOOTER_REL}" Type="${REL_FOOTER}" Target="sppdBlankFooter.xml"/>`;

  images.forEach((image) => {
    relAdd += `<Relationship Id="${image.relId}" Type="${REL_IMAGE}" Target="${image.target}"/>`;
  });

  relXml = insertBefore(relXml, "</Relationships>", relAdd);
  base.file(relFile, relXml);

  let typesXml = base.file("[Content_Types].xml").asText();
  let typesAdd = "";
  const imageTypes = {
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    gif: "image/gif",
  };

  new Set(images.map((image) => image.extension)).forEach((extension) => {
    const pattern = new RegExp(`Extension="${extension}"`, "i");

    if (imageTypes[extension] && !pattern.test(typesXml)) {
      typesAdd += `<Default Extension="${extension}" ContentType="${imageTypes[extension]}"/>`;
    }
  });

  typesAdd +=
    `<Override PartName="/${BLANK_HEADER_PART}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>` +
    `<Override PartName="/${BLANK_FOOTER_PART}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`;

  typesXml = insertBefore(typesXml, "</Types>", typesAdd);
  base.file("[Content_Types].xml", typesXml);

  return base.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function groupKey(name) {
  return String(name || "")
    .trim()
    .toLocaleLowerCase("id-ID")
    .replace(/\s+/g, " ");
}

// Satu tabel Word per perjalanan, urutannya sama dengan trips. Tiap perjalanan dibuat
// sebagai workbook sendiri (memakai blok pertama template), sehingga jumlah perjalanan
// tidak dibatasi jumlah blok pada sheet template.
async function createCombinedDocx(items, trips) {
  const letters = items.map((item) => sppdDocumentRoutes.createDocx(item));
  const registry = sppdExcelToWord.createImageRegistry();
  const tables = [];

  for (let index = 0; index < trips.length; index++) {
    tables.push(await sppdExcelToWord.convertTripToWordTable(trips[index], registry));
  }

  return buildCombinedDocx(letters, tables, registry.items);
}

// Body: { items: [payload surat Word, ...], trips: [payload Excel, ...] }
// Elemen ke-i pada items dan trips adalah perjalanan yang sama.
router.post("/generate", async (req, res) => {
  try {
    const { items, trips } = req.body || {};

    if (!Array.isArray(items) || !Array.isArray(trips) || items.length === 0) {
      return res.status(400).json({
        message: "Data surat dan data perjalanan wajib dikirim.",
      });
    }

    if (items.length !== trips.length) {
      return res.status(400).json({
        message: "Jumlah data surat dan data perjalanan harus sama.",
      });
    }

    if (items.length > 100) {
      return res.status(400).json({
        message: "Maksimal 100 perjalanan dalam satu dokumen.",
      });
    }

    const buffer = await createCombinedDocx(items, trips);

    const names = [...new Set(items.map((item) => groupKey(item.namaPegawai)))];
    const label =
      names.length === 1
        ? String(items[0].namaPegawai || "Karyawan")
        : "Beberapa_Pegawai";
    const safeName = label
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "");

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="SPPD_Gabungan_${safeName}_${items.length}_perjalanan.docx"`
    );

    return res.send(buffer);
  } catch (error) {
    console.error("SPPD gabungan error:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Gagal membuat dokumen gabungan.",
      fields: error.fields || [],
    });
  }
});

module.exports = router;
module.exports.buildCombinedDocx = buildCombinedDocx;
module.exports.createCombinedDocx = createCombinedDocx;