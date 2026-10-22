// Elemen surat yang tidak digambar oleh docx-preview, dibaca langsung dari template Word:
//  1. Gambar kop surat pada header (gambar jangkar relatif halaman dengan pemotongan srcRect).
//  2. Garis paraf pada kaki surat (konektor lurus "AutoShape").
// Posisi dan ukuran berasal dari XML template, jadi mengikuti bila template diganti.
import PizZip from "pizzip";

import { loadTemplate } from "../templates.js";
import { LETTER_TEMPLATE_NAME } from "../sppd/letter.js";

const EMU_PER_PT = 12700;
const NS = {
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
};

const parse = (xml) => new DOMParser().parseFromString(xml, "application/xml");
const first = (root, ns, name) => root.getElementsByTagNameNS(ns, name)[0] || null;
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function readRels(zip, partName) {
  const relPath = partName.replace("word/", "word/_rels/") + ".rels";
  const file = zip.file(relPath);
  const map = {};

  if (!file) return map;

  for (const rel of parse(file.asText()).getElementsByTagName("Relationship")) {
    map[rel.getAttribute("Id")] = rel.getAttribute("Target");
  }

  return map;
}

function anchorOffset(anchor, axis) {
  const el = first(anchor, NS.wp, axis === "h" ? "positionH" : "positionV");
  const offset = el ? first(el, NS.wp, "posOffset") : null;

  return { from: el?.getAttribute("relativeFrom") || "page", pt: num(offset?.textContent) / EMU_PER_PT };
}

// Memotong gambar sesuai srcRect (satuan 1/1000 persen) dan mengembalikannya sebagai JPEG.
async function cropImage(bytes, rect) {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const left = (num(rect.l) / 100000) * bitmap.width;
  const top = (num(rect.t) / 100000) * bitmap.height;
  const width = bitmap.width - left - (num(rect.r) / 100000) * bitmap.width;
  const height = bitmap.height - top - (num(rect.b) / 100000) * bitmap.height;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, left, top, width, height, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
  return new Uint8Array(await blob.arrayBuffer());
}

let cache = null;

// Hasil: { pageMarginLeftPt, headerImages: [{bytes, xPt, yPt, wPt, hPt}], lines: [{xPt, wPt, widthPt, color}] }
export async function readLetterDecorations() {
  if (cache) return cache;

  const zip = new PizZip(await loadTemplate(LETTER_TEMPLATE_NAME));
  const result = { pageMarginLeftPt: 56.7, headerImages: [], lines: [] };

  const pgMar = first(parse(zip.file("word/document.xml").asText()), NS.w, "pgMar");
  if (pgMar) result.pageMarginLeftPt = num(pgMar.getAttributeNS(NS.w, "left"), 1134) / 20;

  for (const part of Object.keys(zip.files).filter((name) => /^word\/(header|footer)\d*\.xml$/.test(name))) {
    const doc = parse(zip.file(part).asText());
    const rels = readRels(zip, part);

    for (const anchor of doc.getElementsByTagNameNS(NS.wp, "anchor")) {
      const extent = first(anchor, NS.wp, "extent");
      const wPt = num(extent?.getAttribute("cx")) / EMU_PER_PT;
      const hPt = num(extent?.getAttribute("cy")) / EMU_PER_PT;
      const h = anchorOffset(anchor, "h");
      const v = anchorOffset(anchor, "v");
      const blip = first(anchor, NS.a, "blip");

      if (blip) {
        const target = rels[blip.getAttributeNS(NS.r, "embed")];
        const file = target && zip.file(`word/${target}`.replace(/\/\.\//, "/"));
        if (!file || h.from !== "page" || v.from !== "page") continue;

        const crop = first(anchor, NS.a, "srcRect");
        const rect = crop
          ? { l: crop.getAttribute("l"), t: crop.getAttribute("t"), r: crop.getAttribute("r"), b: crop.getAttribute("b") }
          : {};

        result.headerImages.push({
          bytes: await cropImage(file.asUint8Array(), rect),
          xPt: h.pt,
          yPt: v.pt,
          wPt,
          hPt,
        });
      } else if (/straightConnector|line/i.test(first(anchor, NS.a, "prstGeom")?.getAttribute("prst") || "")) {
        const ln = first(anchor, NS.a, "ln");
        const color = first(ln || anchor, NS.a, "srgbClr")?.getAttribute("val") || "000000";

        result.lines.push({
          xPt: h.pt, // relatif terhadap kolom (tepi kiri area teks)
          wPt,
          widthPt: Math.max(0.5, num(ln?.getAttribute("w"), 9525) / EMU_PER_PT),
          color,
        });
      }
    }
  }

  cache = result;
  return result;
}
