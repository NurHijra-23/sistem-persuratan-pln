const ExcelJS = require("exceljs");
const crypto = require("crypto");

const sppdExcelRoutes = require("./sppdExcel");

// Konversi formulir perhitungan biaya SPPD (Excel) menjadi tabel Word asli (w:tbl)
// yang teks dan angkanya dapat diedit langsung di Microsoft Word.
// Hanya logo/aset yang berupa gambar; isi formulir tidak pernah dijadikan gambar.

const LAST_COL = 13; // kolom A..M, sama dengan area cetak template
const PX_TO_PT = 0.75;
const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;

// Halaman A4 untuk formulir (satuan twips), margin 1 cm.
const FORM_PAGE = {
  width: 11906,
  height: 16838,
  marginTop: 567,
  marginBottom: 567,
  marginLeft: 567,
  marginRight: 567,
};

const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const DAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const THEME_COLORS = [
  "FFFFFF", "000000", "E7E6E6", "44546A", "4472C4",
  "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47",
];

/* ------------------------------------------------------------------ */
/* Utilitas umum                                                       */
/* ------------------------------------------------------------------ */

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // karakter kontrol yang tidak boleh ada di XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function colLettersToNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/* ------------------------------------------------------------------ */
/* Evaluator rumus sederhana (+ - * / SUM, referensi sel)              */
/* Template hanya memakai rumus jenis ini. Nilai cache rumus sengaja   */
/* dibuang oleh sppdExcel.js, jadi dihitung ulang di sini.             */
/* ------------------------------------------------------------------ */

function richTextToString(value) {
  return value.richText.map((part) => part.text).join("");
}

function createEvaluator(sheet) {
  const cache = new Map();
  const visiting = new Set();

  function cellValue(row, col) {
    const key = `${row},${col}`;

    if (cache.has(key)) return cache.get(key);

    if (visiting.has(key)) return 0; // rujukan melingkar: anggap 0

    visiting.add(key);

    let result = null;

    try {
      const cell = sheet.getCell(row, col);
      const raw = cell.value;

      if (raw && typeof raw === "object" && !(raw instanceof Date)) {
        if (raw.formula || raw.sharedFormula) {
          let formula = null;

          try {
            formula = cell.formula;
          } catch (_error) {
            formula = raw.formula || null;
          }

          if (formula) {
            try {
              result = evaluateFormula(formula);
            } catch (_error) {
              result = raw.result !== undefined ? raw.result : null;
            }
          } else {
            result = raw.result !== undefined ? raw.result : null;
          }
        } else if (raw.richText) {
          result = richTextToString(raw);
        } else if (raw.text !== undefined) {
          result = raw.text;
        } else if (raw.error) {
          result = null;
        } else {
          result = null;
        }
      } else {
        result = raw === undefined ? null : raw;
      }
    } finally {
      visiting.delete(key);
    }

    cache.set(key, result);
    return result;
  }

  function toNumber(value) {
    if (typeof value === "number") return value;
    if (value === null || value === undefined || value === "") return 0;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function evaluateFormula(formula) {
    const tokens = [];
    const pattern =
      /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"]|"")*)"|(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)|([A-Za-z][A-Za-z0-9.]*)\s*\(|([-+*/(),]))/y;

    let index = 0;

    while (index < formula.length) {
      pattern.lastIndex = index;
      const match = pattern.exec(formula);

      if (!match) {
        if (/^\s*$/.test(formula.slice(index))) break;
        throw new Error(`Rumus tidak didukung: ${formula}`);
      }

      index = pattern.lastIndex;

      if (match[1] !== undefined) tokens.push({ t: "num", v: Number(match[1]) });
      else if (match[2] !== undefined)
        tokens.push({ t: "str", v: match[2].replace(/""/g, '"') });
      else if (match[3] !== undefined) tokens.push({ t: "ref", v: match[3] });
      else if (match[4] !== undefined)
        tokens.push({ t: "fn", v: match[4].toUpperCase() });
      else tokens.push({ t: "op", v: match[5] });
    }

    let position = 0;

    const peek = () => tokens[position];
    const take = () => tokens[position++];

    function parseRef(text) {
      const cleaned = text.replace(/\$/g, "").toUpperCase();
      const [startText, endText] = cleaned.split(":");

      const parseCell = (ref) => {
        const m = ref.match(/^([A-Z]+)(\d+)$/);
        return { col: colLettersToNumber(m[1]), row: Number(m[2]) };
      };

      const start = parseCell(startText);
      const end = endText ? parseCell(endText) : start;

      return { start, end, isRange: Boolean(endText) };
    }

    function parseExpression() {
      let left = parseTerm();

      while (peek() && peek().t === "op" && ["+", "-"].includes(peek().v)) {
        const operator = take().v;
        const right = parseTerm();

        left =
          operator === "+"
            ? toNumber(left) + toNumber(right)
            : toNumber(left) - toNumber(right);
      }

      return left;
    }

    function parseTerm() {
      let left = parseUnary();

      while (peek() && peek().t === "op" && ["*", "/"].includes(peek().v)) {
        const operator = take().v;
        const right = parseUnary();

        if (operator === "*") {
          left = toNumber(left) * toNumber(right);
        } else {
          const divisor = toNumber(right);
          left = divisor === 0 ? 0 : toNumber(left) / divisor;
        }
      }

      return left;
    }

    function parseUnary() {
      const next = peek();

      if (next && next.t === "op" && (next.v === "+" || next.v === "-")) {
        take();
        const value = parseUnary();

        // "+H27" pada template dipakai untuk menyalin teks, jadi plus unary
        // meneruskan nilai apa adanya.
        return next.v === "+" ? value : -toNumber(value);
      }

      return parsePrimary();
    }

    function parsePrimary() {
      const token = take();

      if (!token) throw new Error("Rumus tidak lengkap.");

      if (token.t === "num" || token.t === "str") return token.v;

      if (token.t === "ref") {
        const { start, end, isRange } = parseRef(token.v);

        if (isRange) throw new Error("Rentang di luar fungsi.");

        // Rujukan ke sel kosong menghasilkan 0 di Excel.
        const referenced = cellValue(start.row, start.col);

        return referenced === null || referenced === undefined ? 0 : referenced;
      }

      if (token.t === "fn") {
        const args = [];

        if (!(peek() && peek().t === "op" && peek().v === ")")) {
          args.push(parseArgument());

          while (peek() && peek().t === "op" && peek().v === ",") {
            take();
            args.push(parseArgument());
          }
        }

        const closing = take();

        if (!closing || closing.v !== ")") throw new Error("Kurung tidak tertutup.");

        if (token.v === "SUM") {
          return args.flat().reduce(
            (sum, item) => (typeof item === "number" ? sum + item : sum),
            0
          );
        }

        throw new Error(`Fungsi ${token.v} tidak didukung.`);
      }

      if (token.t === "op" && token.v === "(") {
        const value = parseExpression();
        const closing = take();

        if (!closing || closing.v !== ")") throw new Error("Kurung tidak tertutup.");

        return value;
      }

      throw new Error("Rumus tidak dikenali.");
    }

    function parseArgument() {
      const next = peek();

      if (next && next.t === "ref" && next.v.includes(":")) {
        take();
        const { start, end } = parseRef(next.v);
        const values = [];

        for (let row = start.row; row <= end.row; row++) {
          for (let col = start.col; col <= end.col; col++) {
            values.push(cellValue(row, col));
          }
        }

        return values;
      }

      return parseExpression();
    }

    const value = parseExpression();

    if (position < tokens.length) throw new Error(`Rumus tidak lengkap: ${formula}`);

    return value;
  }

  return { cellValue };
}

/* ------------------------------------------------------------------ */
/* Format angka / tanggal gaya Excel (locale Indonesia)                */
/* ------------------------------------------------------------------ */

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatNumberWithPattern(absValue, pattern) {
  const percent = pattern.includes("%");
  const value = percent ? absValue * 100 : absValue;

  const [intPattern, decPattern = ""] = pattern.replace(/[^#0?,.]/g, "").split(".");
  const decimals = (decPattern.match(/[0#?]/g) || []).length;
  const requiredDecimals = (decPattern.match(/0/g) || []).length;
  const useGrouping = intPattern.includes(",");
  const minInt = (intPattern.match(/0/g) || []).length;

  const fixed = value.toFixed(decimals);
  let [intPart, decPart = ""] = fixed.split(".");

  while (decPart.length > requiredDecimals && decPart.endsWith("0")) {
    decPart = decPart.slice(0, -1);
  }

  if (Number(intPart) === 0 && minInt === 0) intPart = "";
  else if (intPart.length < minInt) intPart = intPart.padStart(minInt, "0");

  if (useGrouping) intPart = groupThousands(intPart);

  return decPart ? `${intPart},${decPart}` : intPart;
}

function applyNumberSection(section, numeric, absoluteValue) {
  let output = "";
  let numberInserted = false;
  let index = 0;

  while (index < section.length) {
    const ch = section[index];

    if (ch === "_") {
      output += " ";
      index += 2;
    } else if (ch === "*") {
      index += 2;
    } else if (ch === '"') {
      const close = section.indexOf('"', index + 1);
      const end = close < 0 ? section.length : close;
      output += section.slice(index + 1, end);
      index = end + 1;
    } else if (ch === "\\") {
      output += section[index + 1] || "";
      index += 2;
    } else if (ch === "[") {
      const close = section.indexOf("]", index);
      const end = close < 0 ? section.length : close;
      const inside = section.slice(index + 1, end);

      if (inside.startsWith("$")) {
        output += inside.slice(1).split("-")[0];
      }

      index = end + 1;
    } else if (/[#0?,.]/.test(ch)) {
      let end = index;

      while (end < section.length && /[#0?,.]/.test(section[end])) end++;

      if (!numberInserted) {
        const pattern = section.slice(index, end) + (section.includes("%") ? "%" : "");
        output += formatNumberWithPattern(absoluteValue, pattern);
        numberInserted = true;
      }

      index = end;
    } else if (ch === "@") {
      output += String(numeric);
      index += 1;
    } else {
      output += ch;
      index += 1;
    }
  }

  return output.trim();
}

function formatNumber(value, numFmt) {
  if (!numFmt || /^general$/i.test(numFmt)) {
    if (Number.isInteger(value)) return String(value);

    return String(Number(value.toPrecision(10))).replace(".", ",");
  }

  const sections = numFmt.split(";");
  let section;
  let absoluteValue = Math.abs(value);
  let prefixMinus = false;

  if (value > 0) {
    section = sections[0];
  } else if (value < 0) {
    if (sections[1]) {
      section = sections[1];
    } else {
      section = sections[0];
      prefixMinus = true;
    }
  } else {
    section = sections[2] || sections[0];
  }

  const text = applyNumberSection(section, value, absoluteValue);

  return prefixMinus ? `-${text}` : text;
}

function formatDate(date, numFmt) {
  let format = String(numFmt || "").split(";")[0];

  format = format.replace(/\[[^\]]*\]/g, "");

  if (!/[dmy]/i.test(format)) format = "dd mmmm yyyy";

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();

  return format.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d/gi, (token) => {
    switch (token.toLowerCase()) {
      case "yyyy": return String(year);
      case "yy": return String(year).slice(-2);
      case "mmmm": return MONTHS_ID[month];
      case "mmm": return MONTHS_ID[month].slice(0, 3);
      case "mm": return String(month + 1).padStart(2, "0");
      case "m": return String(month + 1);
      case "dddd": return DAYS_ID[weekday];
      case "ddd": return DAYS_ID[weekday].slice(0, 3);
      case "dd": return String(day).padStart(2, "0");
      default: return String(day);
    }
  });
}

function displayText(value, numFmt) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value, numFmt);
  if (typeof value === "number") return formatNumber(value, numFmt);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

  return String(value);
}

/* ------------------------------------------------------------------ */
/* Gaya: warna, font, border                                           */
/* ------------------------------------------------------------------ */

function applyTint(hex, tint) {
  if (!tint) return hex;

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;

    h /= 6;
  }

  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let rr;
  let gg;
  let bb;

  if (s === 0) {
    rr = gg = bb = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rr = hue2rgb(p, q, h + 1 / 3);
    gg = hue2rgb(p, q, h);
    bb = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");

  return `${toHex(rr)}${toHex(gg)}${toHex(bb)}`.toUpperCase();
}

function resolveColor(color, fallback) {
  if (!color) return fallback;

  if (color.argb) return color.argb.slice(-6).toUpperCase();

  if (color.theme !== undefined) {
    const base = THEME_COLORS[color.theme] || fallback;
    return base ? applyTint(base, color.tint) : fallback;
  }

  return fallback;
}

function fontProps(font) {
  const f = font || {};

  return {
    name: f.name || "Calibri",
    size: f.size || 11,
    bold: Boolean(f.bold),
    italic: Boolean(f.italic),
    underline: Boolean(f.underline),
    strike: Boolean(f.strike),
    color: resolveColor(f.color, "000000"),
  };
}

const BORDER_RANK = {
  thick: 5, double: 4, medium: 4, thin: 3, dashed: 2, dotted: 2, hair: 1,
};

function pickBorder(a, b) {
  if (!a || !a.style) return b && b.style ? b : null;
  if (!b || !b.style) return a;

  return (BORDER_RANK[b.style] || 0) > (BORDER_RANK[a.style] || 0) ? b : a;
}

function borderXml(side, border) {
  if (!border || !border.style) return "";

  const color = resolveColor(border.color, "000000");
  let val = "single";
  let size = 4;

  switch (border.style) {
    case "medium": size = 8; break;
    case "thick": size = 12; break;
    case "double": val = "double"; size = 6; break;
    case "dashed": case "mediumDashed": val = "dashed"; break;
    case "dotted": val = "dotted"; break;
    case "hair": size = 2; break;
    default: break;
  }

  return `<w:${side} w:val="${val}" w:sz="${size}" w:space="0" w:color="${color}"/>`;
}

/* ------------------------------------------------------------------ */
/* Estimasi lebar teks (untuk meniru teks Excel yang meluber ke kanan) */
/* ------------------------------------------------------------------ */

function charWidthEm(ch) {
  if (ch === " ") return 0.278;
  if ("ijl.,:;!|'".includes(ch)) return 0.26;
  if ("ftrI()/-[]".includes(ch)) return 0.34;
  if ("mwMW@%".includes(ch)) return 0.86;
  if (/[0-9]/.test(ch)) return 0.556;
  if (/[A-Z]/.test(ch)) return 0.69;
  if (/[a-z]/.test(ch)) return 0.54;

  return 0.56;
}

function estimateTextWidthPt(text, font) {
  let em = 0;

  for (const ch of text) em += charWidthEm(ch);

  const family = font.name.toLowerCase();
  let factor = 1;

  if (family.includes("calibri")) factor = 0.9;
  else if (family.includes("verdana")) factor = 1.18;

  return em * font.size * factor * (font.bold ? 1.07 : 1);
}

/* ------------------------------------------------------------------ */
/* Pembacaan sheet formulir                                            */
/* ------------------------------------------------------------------ */

async function loadFormSheet(trip) {
  // Workbook diisi dengan logika yang sama seperti unduhan Excel biasa,
  // sehingga data dan perhitungan biaya tidak berubah.
  const buffer = await sppdExcelRoutes.generateWorkbook([trip]);
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];

  if (!sheet) throw new Error("Sheet formulir tidak ditemukan.");

  // Baris setelah formulir terakhir disembunyikan oleh generateWorkbook.
  let lastRow = sheet.rowCount;

  while (lastRow > 1 && sheet.getRow(lastRow).hidden) lastRow--;

  return { workbook, sheet, lastRow };
}

function parseMerges(sheet, lastRow) {
  const merges = [];

  for (const range of sheet.model.merges || []) {
    const match = String(range).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);

    if (!match) continue;

    const c1 = colLettersToNumber(match[1]);
    const r1 = Number(match[2]);
    const c2 = Math.min(colLettersToNumber(match[3]), LAST_COL);
    const r2 = Math.min(Number(match[4]), lastRow);

    if (r1 > lastRow || c1 > LAST_COL) continue;
    if (r1 === r2 && c1 === c2) continue;

    merges.push({ r1, c1, r2, c2 });
  }

  return merges;
}

function rowHeightPt(sheet, rowNumber) {
  const row = sheet.getRow(rowNumber);

  return row.height || sheet.properties.defaultRowHeight || 15;
}

function columnWidthPx(sheet, col) {
  const width = sheet.getColumn(col).width || 9.140625;

  return Math.round(width * 7);
}

/* ------------------------------------------------------------------ */
/* Pembuatan tabel Word                                                */
/* ------------------------------------------------------------------ */

function createImageRegistry() {
  const byHash = new Map();
  let nextDocPr = 3000;

  return {
    items: [],
    register(buffer, extension) {
      const hash = crypto.createHash("sha1").update(buffer).digest("hex");

      if (!byHash.has(hash)) {
        const number = byHash.size + 1;
        const ext = String(extension || "png").toLowerCase();

        byHash.set(hash, {
          relId: `rIdSppdLogo${number}`,
          target: `media/sppd_logo_${number}.${ext}`,
          partName: `word/media/sppd_logo_${number}.${ext}`,
          extension: ext,
          buffer,
        });
        this.items.push(byHash.get(hash));
      }

      return byHash.get(hash);
    },
    nextDocPrId() {
      return nextDocPr++;
    },
  };
}

function anchorXml(image, docPrId, x, y, cx, cy) {
  return (
    "<w:r><w:drawing>" +
    '<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    `relativeHeight="${docPrId}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${Math.round(x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round(y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${Math.round(cx)}" cy="${Math.round(cy)}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    "<wp:wrapNone/>" +
    `<wp:docPr id="${docPrId}" name="Logo ${docPrId}" descr="Logo PLN"/>` +
    "<wp:cNvGraphicFramePr/>" +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="logo-${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${image.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    "<pic:spPr>" +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    "</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor>" +
    "</w:drawing></w:r>"
  );
}

function runXml(text, font, scale) {
  if (text === "") return "";

  const halfPoints = Math.max(6, Math.round(font.size * scale * 2));
  const name = escapeXml(font.name);

  const props =
    `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:cs="${name}" w:eastAsia="${name}"/>` +
    (font.bold ? "<w:b/>" : "") +
    (font.italic ? "<w:i/>" : "") +
    (font.strike ? "<w:strike/>" : "") +
    (font.color !== "000000" ? `<w:color w:val="${font.color}"/>` : "") +
    `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>` +
    (font.underline ? '<w:u w:val="single"/>' : "");

  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraphMarkXml(font, scale) {
  const halfPoints = Math.max(6, Math.round(font.size * scale * 2));
  const name = escapeXml(font.name);

  return (
    `<w:rPr><w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:cs="${name}"/>` +
    `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr>`
  );
}

function buildBlocks(sheet, lastRow, evaluator) {
  const merges = parseMerges(sheet, lastRow);
  const owner = Array.from({ length: lastRow + 2 }, () => new Array(LAST_COL + 2).fill(null));
  const blocks = [];

  for (const merge of merges) {
    const block = { ...merge };

    blocks.push(block);

    for (let r = block.r1; r <= block.r2; r++) {
      for (let c = block.c1; c <= block.c2; c++) owner[r][c] = block;
    }
  }

  for (let r = 1; r <= lastRow; r++) {
    for (let c = 1; c <= LAST_COL; c++) {
      if (!owner[r][c]) {
        const block = { r1: r, c1: c, r2: r, c2: c };

        owner[r][c] = block;
        blocks.push(block);
      }
    }
  }

  // Siapkan nilai, teks, dan gaya tiap blok dari sel utamanya.
  for (const block of blocks) {
    const cell = sheet.getCell(block.r1, block.c1);
    const value = evaluator.cellValue(block.r1, block.c1);
    const alignment = cell.alignment || {};

    block.cell = cell;
    block.value = value;
    block.font = fontProps(cell.font);
    block.alignment = alignment;
    block.richText =
      cell.value && typeof cell.value === "object" && cell.value.richText
        ? cell.value.richText
        : null;
    block.text = block.richText
      ? richTextToString(cell.value)
      : displayText(value, cell.numFmt);
    block.isNumeric = typeof value === "number" || value instanceof Date;
    // Format akuntansi Excel memakai "* " (isi spasi) sehingga angka selalu rata kanan.
    block.fillRight = typeof value === "number" && /\*/.test(cell.numFmt || "");
    block.hasContent = value !== null && value !== undefined && value !== "";
  }

  return { blocks, owner };
}

// Teks Excel yang tidak dibungkus meluber ke sel kosong di kanannya. Tabel Word tidak
// bisa meluber, sehingga sel dilebarkan (gridSpan) ke sel kosong di kanan bila teks
// diperkirakan tidak muat.
function extendOverflowingText(sheet, blocks, owner, columnPx) {
  for (const block of blocks) {
    if (block.r1 !== block.r2 || block.c1 !== block.c2) continue;
    if (!block.text || block.isNumeric || block.alignment.wrapText) continue;

    const horizontal = block.alignment.horizontal;

    if (horizontal && horizontal !== "general" && horizontal !== "left") continue;

    const needed =
      (estimateTextWidthPt(block.text, block.font) +
        6 +
        (block.alignment.indent || 0) * 6) *
      1.06;

    const widthOf = (from, to) => {
      let px = 0;

      for (let c = from; c <= to; c++) px += columnPx[c];

      return px * PX_TO_PT;
    };

    while (widthOf(block.c1, block.c2) < needed && block.c2 < LAST_COL) {
      const next = owner[block.r1][block.c2 + 1];

      if (!next || next === block) break;
      if (next.r1 !== next.r2 || next.c1 !== next.c2) break; // bagian sel gabungan
      if (next.hasContent) break;

      owner[block.r1][block.c2 + 1] = block;
      next.absorbed = true;
      block.c2 += 1;
    }
  }
}

function buildTable(sheet, lastRow, owner, columnPx, scale, registry) {
  const columnTwips = columnPx
    .slice(1)
    .map((px) => Math.max(1, Math.round(px * PX_TO_PT * scale * 20)));
  const tableWidth = columnTwips.reduce((sum, w) => sum + w, 0);

  const border = (r, c, side) => {
    if (r < 1 || c < 1 || r > lastRow || c > LAST_COL) return null;

    const value = sheet.getCell(r, c).border;

    return value ? value[side] : null;
  };

  const edge = {
    top: (r, c) => pickBorder(border(r, c, "top"), border(r - 1, c, "bottom")),
    bottom: (r, c) => pickBorder(border(r, c, "bottom"), border(r + 1, c, "top")),
    left: (r, c) => pickBorder(border(r, c, "left"), border(r, c - 1, "right")),
    right: (r, c) => pickBorder(border(r, c, "right"), border(r, c + 1, "left")),
  };

  function blockBorders(block) {
    let top = null;
    let bottom = null;
    let left = null;
    let right = null;

    for (let c = block.c1; c <= block.c2; c++) {
      top = pickBorder(top, edge.top(block.r1, c));
      bottom = pickBorder(bottom, edge.bottom(block.r2, c));
    }

    for (let r = block.r1; r <= block.r2; r++) {
      left = pickBorder(left, edge.left(r, block.c1));
      right = pickBorder(right, edge.right(r, block.c2));
    }

    return { top, left, bottom, right };
  }

  function blockFill(block) {
    const fill = block.cell.fill;

    if (!fill || fill.type !== "pattern" || fill.pattern !== "solid") return null;

    const color = resolveColor(fill.fgColor, null);

    return color && color !== "FFFFFF" ? color : null;
  }

  function paragraphXml(block, extraRuns) {
    const alignment = block.alignment;
    let horizontal = alignment.horizontal;

    if (!horizontal || horizontal === "general" || block.fillRight) {
      horizontal = block.isNumeric ? "right" : "left";
    }

    const jc =
      { left: "left", center: "center", right: "right", justify: "both", fill: "left" }[
        horizontal
      ] || "left";

    const indent = alignment.indent
      ? `<w:ind w:left="${Math.round(alignment.indent * 135 * scale)}"/>`
      : "";

    const lines = block.richText ? [null] : String(block.text).split(/\r?\n/);

    return lines
      .map((line, lineIndex) => {
        let runs;

        if (line === null) {
          runs = block.richText
            .map((part) => runXml(part.text, fontProps({ ...block.cell.font, ...part.font }), scale))
            .join("");
        } else {
          runs = runXml(line, block.font, scale);
        }

        return (
          "<w:p><w:pPr>" +
          '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' +
          indent +
          `<w:jc w:val="${jc}"/>` +
          paragraphMarkXml(block.font, scale) +
          "</w:pPr>" +
          (lineIndex === 0 ? extraRuns || "" : "") +
          runs +
          "</w:p>"
        );
      })
      .join("");
  }

  // Posisi logo dan gambar lain pada sheet, relatif terhadap sudut kiri atas tabel.
  const rowTopPt = [0];

  for (let r = 1; r <= lastRow; r++) {
    rowTopPt[r] = rowTopPt[r - 1] + rowHeightPt(sheet, r);
  }

  const colLeftPx = [0];

  for (let c = 1; c <= LAST_COL; c++) {
    colLeftPx[c] = colLeftPx[c - 1] + columnPx[c];
  }

  function emuAt(anchor) {
    const col = Math.min(anchor.nativeCol, LAST_COL);
    const row = Math.min(anchor.nativeRow, lastRow);

    return {
      x: colLeftPx[col] * EMU_PER_PX + (anchor.nativeColOff || 0),
      y: rowTopPt[row] * EMU_PER_PT + (anchor.nativeRowOff || 0),
    };
  }

  const pictures = [];

  for (const picture of sheet.getImages()) {
    const range = picture.range;
    const tl = range && range.tl;

    if (!tl || tl.nativeRow >= lastRow || tl.nativeCol >= LAST_COL) continue;

    const media = sheet.workbook.getImage(picture.imageId);

    if (!media || !media.buffer) continue;

    const start = emuAt(tl);
    let width;
    let height;

    if (range.br) {
      const end = emuAt(range.br);

      width = end.x - start.x;
      height = end.y - start.y;
    } else if (range.ext) {
      width = range.ext.width * EMU_PER_PX;
      height = range.ext.height * EMU_PER_PX;
    } else {
      continue;
    }

    if (width <= 0 || height <= 0) continue;

    pictures.push({
      image: registry.register(Buffer.from(media.buffer), media.extension),
      x: start.x * scale,
      y: start.y * scale,
      cx: width * scale,
      cy: height * scale,
    });
  }

  const rowsXml = [];

  for (let r = 1; r <= lastRow; r++) {
    const heightTwips = Math.max(20, Math.round(rowHeightPt(sheet, r) * scale * 20));
    let cellsXml = "";
    let c = 1;

    while (c <= LAST_COL) {
      const block = owner[r][c];
      const span = block.c2 - block.c1 + 1;
      let width = 0;

      for (let k = block.c1; k <= block.c2; k++) width += columnTwips[k - 1];

      const isFirstRow = block.r1 === r;
      const verticalMerge =
        block.r2 > block.r1
          ? isFirstRow
            ? '<w:vMerge w:val="restart"/>'
            : "<w:vMerge/>"
          : "";

      let content;
      let tcExtras = "";

      const borders = blockBorders(block);
      const bordersXml =
        borderXml("top", borders.top) +
        borderXml("left", borders.left) +
        borderXml("bottom", borders.bottom) +
        borderXml("right", borders.right);

      if (bordersXml) tcExtras += `<w:tcBorders>${bordersXml}</w:tcBorders>`;

      const fill = blockFill(block);

      if (fill) tcExtras += `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;

      const vertical = block.alignment.vertical;
      const vAlign =
        vertical === "top"
          ? "top"
          : vertical === "middle" || vertical === "center"
            ? "center"
            : "bottom";

      tcExtras += `<w:vAlign w:val="${vAlign}"/>`;

      if (isFirstRow) {
        let drawings = "";

        if (r === 1 && c === 1) {
          drawings = pictures
            .map((p) =>
              anchorXml(p.image, registry.nextDocPrId(), p.x, p.y, p.cx, p.cy)
            )
            .join("");
        }

        content = paragraphXml(block, drawings);
      } else {
        // Baris lanjutan sel gabungan vertikal: kosong, tetapi border dan warna sama.
        content = paragraphXml({ ...block, text: "", richText: null, isNumeric: false }, "");
      }

      cellsXml +=
        `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
        (span > 1 ? `<w:gridSpan w:val="${span}"/>` : "") +
        verticalMerge +
        tcExtras +
        `</w:tcPr>${content}</w:tc>`;

      c = block.c2 + 1;
    }

    rowsXml.push(
      `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${heightTwips}" w:hRule="exact"/></w:trPr>${cellsXml}</w:tr>`
    );
  }

  const tableXml =
    "<w:tbl><w:tblPr>" +
    `<w:tblW w:w="${tableWidth}" w:type="dxa"/>` +
    '<w:jc w:val="center"/>' +
    '<w:tblInd w:w="0" w:type="dxa"/>' +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="25" w:type="dxa"/>' +
    '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="25" w:type="dxa"/></w:tblCellMar>' +
    '<w:tblLook w:val="0000"/>' +
    "</w:tblPr>" +
    `<w:tblGrid>${columnTwips.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
    rowsXml.join("") +
    "</w:tbl>";

  return tableXml;
}

/**
 * Mengubah formulir biaya satu perjalanan menjadi tabel Word (w:tbl) yang bisa diedit.
 * `registry` dipakai bersama oleh semua formulir agar logo hanya tersimpan satu kali.
 * Hasilnya hanya berisi tabel; paragraf penutup halaman dibuat oleh pemanggil.
 */
async function convertTripToWordTable(trip, registry) {
  const { sheet, lastRow } = await loadFormSheet(trip);
  const evaluator = createEvaluator(sheet);
  const { blocks, owner } = buildBlocks(sheet, lastRow, evaluator);

  const columnPx = [0];

  for (let c = 1; c <= LAST_COL; c++) columnPx[c] = columnWidthPx(sheet, c);

  extendOverflowingText(sheet, blocks, owner, columnPx);

  // Skala agar seluruh formulir muat dalam satu halaman A4 (seperti skala cetak template).
  const totalWidthPt = columnPx.slice(1).reduce((sum, px) => sum + px, 0) * PX_TO_PT;
  let totalHeightPt = 0;

  for (let r = 1; r <= lastRow; r++) totalHeightPt += rowHeightPt(sheet, r);

  const availableWidthPt = (FORM_PAGE.width - FORM_PAGE.marginLeft - FORM_PAGE.marginRight) / 20;
  const availableHeightPt =
    (FORM_PAGE.height - FORM_PAGE.marginTop - FORM_PAGE.marginBottom) / 20 - 4;

  const scale = Math.min(
    1,
    availableWidthPt / totalWidthPt,
    (availableHeightPt / totalHeightPt) * 0.99
  );

  return buildTable(sheet, lastRow, owner, columnPx, scale, registry);
}

module.exports = {
  FORM_PAGE,
  createImageRegistry,
  convertTripToWordTable,
  // Diekspor untuk pengujian.
  createEvaluator,
  formatNumber,
  formatDate,
};
