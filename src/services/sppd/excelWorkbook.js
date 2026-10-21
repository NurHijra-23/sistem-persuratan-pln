// Pembuatan formulir Excel SPPD (dijalankan di browser).
// Logika disalin dari backend/routes/sppdExcel.js; hanya sumber template dan data personel
// yang diganti (template diambil dari public/templates, personel dari IndexedDB).
import ExcelJS from "exceljs";

import { loadTemplate } from "../templates.js";
import { listEmployees } from "../db.js";

const TEMPLATE_NAME = "Form Perhitungan SPPD TAD Har3.xlsx";

const RATES = {
  consumption: 190000,
  laundry: 50000,
  lodging: 250000,
};

// Pemetaan nama karyawan ke sheet template. Tetap dipakai lebih dulu agar perilaku lama tidak berubah.
const SHEET_ALIASES = {
  "muh. adlim najiib amnur": "Adlim",
  "muh adlim najiib amnur": "Adlim",
  "muhammad adlim": "Adlim",
  "adlim": "Adlim",
  "akram assidik": "Akram",
  "akram": "Akram",
  "anugrah": "Anugrah",
  "muh. ardi": "Muh Ardi",
  "muh ardi": "Muh Ardi",
  "ardi": "Muh Ardi",
  "operator os": "Operator OS",
};

function normalizeSheetKey(value) {
  return String(value || "")
    .toLocaleLowerCase("id-ID")
    .replace(/\s+/g, " ")
    .trim();
}

// Ambil personel aktif yang punya sheetName dari IndexedDB (store employees).
// Dipanggil sekali per pembuatan Excel, lalu hasilnya dipakai oleh fungsi pencarian di bawah.
async function loadSheetEmployees() {
  const rows = await listEmployees();

  return rows
    .filter((row) => row.sheetName && row.active !== false)
    .map((row) => ({
      name: row.name,
      nickname: row.nickname,
      aliases: Array.isArray(row.aliases) ? row.aliases : [],
      sheetName: row.sheetName,
    }));
}

// Cadangan: cari sheet dari data personel (field sheetName) agar personel yang namanya
// diubah lewat fitur Edit Personel tetap terhubung ke sheet yang benar.
// `employees` berasal dari loadSheetEmployees(); tanpa daftar itu, hanya SHEET_ALIASES yang berlaku.
function findSheetByEmployeeRecord(employeeName, employees = []) {
  const key = normalizeSheetKey(employeeName);
  if (!key) return undefined;

  const found = employees.find(
    (employee) =>
      employee.sheetName &&
      [employee.name, employee.nickname, ...(employee.aliases || [])].some(
        (value) => normalizeSheetKey(value) === key
      )
  );

  return found?.sheetName;
}

// Nama sheet untuk satu nama karyawan (tabel bawaan dahulu, lalu data personel).
function resolveSheetName(employeeName, employees = []) {
  return (
    SHEET_ALIASES[normalizeSheetKey(employeeName)] ||
    findSheetByEmployeeRecord(employeeName, employees)
  );
}

// Baris judul masing-masing blok pada template.
// Posisi akan diperiksa berdasarkan judul yang ada di Excel.
function findBlockStarts(sheet) {
  const starts = [];

  for (let row = 1; row <= sheet.rowCount; row++) {
    const value = sheet.getCell(row, 1).value;

    if (
      String(value || "").trim().toUpperCase() ===
      "BIAYA PERJALANAN DINAS DALAM / LUAR NEGERI"
    ) {
      starts.push(row);
    }
  }

  return starts;
}


function copyCellValue(value, offset) {
  if (value && typeof value === "object" && value.formula) {
    return {
      ...value,
      formula: value.formula.replace(
        /([A-Z]{1,3})(\d+)/g,
        (match, col, row) => `${col}${Number(row) + offset}`
      ),
    };
  }

  return value;
}

function copyFormRows(sheet, sourceStart, sourceEnd, targetStart) {
  const rowCount = sourceEnd - sourceStart + 1;
  const rowOffset = targetStart - sourceStart;

  // Salin tinggi baris, nilai, rumus, dan format sel.
  for (let i = 0; i < rowCount; i++) {
    const sourceRow = sheet.getRow(sourceStart + i);
    const targetRow = sheet.getRow(targetStart + i);

    targetRow.height = sourceRow.height;
    targetRow.hidden = sourceRow.hidden;
    targetRow.outlineLevel = sourceRow.outlineLevel;

    sourceRow.eachCell({ includeEmpty: true }, (sourceCell, col) => {
  const targetCell = targetRow.getCell(col);

  targetCell.value = copyCellValue(sourceCell.value, rowOffset);

  // Salin seluruh format asli sel.
  targetCell.style = structuredClone(sourceCell.style);

  // Salin border secara eksplisit.
  targetCell.border = structuredClone(sourceCell.border);

  targetCell.numFmt = sourceCell.numFmt;
  targetCell.alignment = structuredClone(sourceCell.alignment);
  targetCell.protection = structuredClone(sourceCell.protection);
});
  }

  // Salin sel gabungan yang seluruhnya berada dalam blok sumber.
  const mergedRanges = [...sheet.model.merges];

  for (const range of mergedRanges) {
    const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!match) continue;

    const [, startCol, startRow, endCol, endRow] = match;
    const firstRow = Number(startRow);
    const lastRow = Number(endRow);

    if (firstRow < sourceStart || lastRow > sourceEnd) continue;

    const targetRange =
      `${startCol}${firstRow + rowOffset}:` +
      `${endCol}${lastRow + rowOffset}`;

    if (!sheet.model.merges.includes(targetRange)) {
      sheet.mergeCells(targetRange);
    }
  }
}


function numberToWords(value) {
  const words = [
    "Nol", "Satu", "Dua", "Tiga", "Empat", "Lima",
    "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh",
    "Sebelas",
  ];

  if (value < 12) return words[value] || String(value);

  if (value < 20) {
    return `${words[value - 10]} Belas`;
  }

  if (value < 100) {
    const tens = Math.floor(value / 10);
    const units = value % 10;

    return `${words[tens]} Puluh${units ? ` ${words[units]}` : ""}`;
  }

  return String(value);
}

function calculateDuration(item) {
  const start = new Date(`${item.startDate}T00:00:00`);
  const end = new Date(`${item.endDate}T00:00:00`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  ) {
    throw new Error(
      `Tanggal perjalanan ${item.employeeName || ""} tidak valid.`
    );
  }

  return Math.round((end - start) / 86400000) + 1;
}

function setIfMergedAnchor(sheet, address, value) {
  const cell = sheet.getCell(address);

  // Sel harus menjadi sel utama jika berada dalam area gabungan.
  // Penulisan dilakukan pada alamat yang ditentukan template.
  cell.value = value;
}


function fillTrip(sheet, blockHeaderRow, item) {
  const duration = calculateDuration(item);

  // Posisi relatif terhadap baris judul blok.
  const dateRow = blockHeaderRow + 3;
  const destinationRow = blockHeaderRow + 4;
  const purposeRow = blockHeaderRow + 5;
  const durationRow = blockHeaderRow + 7;
  const employeeRow = blockHeaderRow + 8;
  const start = parseLocalDate(item.startDate);
const end = parseLocalDate(item.endDate);

 function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}
  setIfMergedAnchor(
    sheet,
    `E${dateRow}`,
    start
  );

  setIfMergedAnchor(
    sheet,
    `G${dateRow}`,
    end
  );

  setIfMergedAnchor(
    sheet,
    `E${destinationRow}`,
    item.destination.trim()
  );

  setIfMergedAnchor(
    sheet,
    `E${purposeRow}`,
    item.purpose.trim()
  );

  setIfMergedAnchor(
    sheet,
    `E${purposeRow + 1}`,
    item.purpose.trim()
  );

  setIfMergedAnchor(
    sheet,
    `E${durationRow}`,
    `${duration} (${numberToWords(duration)}) Hari`
  );

  setIfMergedAnchor(
    sheet,
    `E${employeeRow}`,
    item.employeeName.trim().toLocaleUpperCase("id-ID")
  );

  // Jabatan (baris tepat di bawah nama). Hanya nilai yang diganti, format sel tetap milik template.
  // Bila posisi kosong, teks bawaan template dipertahankan.
  const position = String(item.position || "").trim();

  if (position) {
    setIfMergedAnchor(sheet, `E${blockHeaderRow + 9}`, position);
  }

  // Durasi dan tarif pada bagian perhitungan biaya.
  const consumptionRow = blockHeaderRow + 20;
  const laundryRow = blockHeaderRow + 21;
  const lodgingRow = blockHeaderRow + 22;

  sheet.getCell(`E${consumptionRow}`).value = duration;
  sheet.getCell(`G${consumptionRow}`).value = 1;
  sheet.getCell(`I${consumptionRow}`).value = RATES.consumption;

  sheet.getCell(`E${laundryRow}`).value = Math.max(duration - 1, 0);
  sheet.getCell(`G${laundryRow}`).value = 1;
  sheet.getCell(`I${laundryRow}`).value = RATES.laundry;

  sheet.getCell(`E${lodgingRow}`).value = 0;
  sheet.getCell(`G${lodgingRow}`).value = 1;
  sheet.getCell(`I${lodgingRow}`).value = RATES.lodging;
}



function addTripSeparator(sheet, rowNumber) {
  for (let col = 1; col <= 13; col++) {
    const cell = sheet.getCell(rowNumber, col);

    cell.border = {
      ...cell.border,
      bottom: {
        style: "thin",
        color: { argb: "FF000000" },
      },
    };
  }
}

// Akhir setiap blok formulir = baris tanda tangan (baris "......" pada kolom B/C).
// Bila baris itu tidak ditemukan, pakai pola template: 7 baris sebelum judul blok berikutnya.
function findBlockEnds(sheet, starts) {
  return starts.map((titleRow, index) => {
    const limit =
      index + 1 < starts.length ? starts[index + 1] - 1 : sheet.rowCount;

    for (let row = titleRow + 1; row <= limit; row++) {
      for (const col of [2, 3]) {
        const raw = sheet.getCell(row, col).value;
        const text = String(
          raw && typeof raw === "object" && raw.richText
            ? raw.richText.map((part) => part.text).join("")
            : raw || ""
        ).trim();

        if (/^(\u2026|\.){3,}/.test(text)) return row;
      }
    }

    return index + 1 < starts.length ? starts[index + 1] - 7 : sheet.rowCount;
  });
}

// Tinggi baris tanpa nilai eksplisit dianggap 15.75 pt (konservatif), karena Excel
// bisa menampilkannya lebih tinggi daripada 14.4 pt bawaan template.
function rowHeightPoints(sheet, rowNumber) {
  return sheet.getRow(rowNumber).height || 15.75;
}

// Nilai cache rumus bawaan template dibuang supaya Excel, LibreOffice, dan aplikasi
// pratinjau lain menghitung ulang total dari data perjalanan yang baru diisi.
function clearFormulaCache(sheet, lastRow) {
  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber++) {
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value;

      if (
        value &&
        typeof value === "object" &&
        (value.formula || value.sharedFormula) &&
        value.result !== undefined
      ) {
        cell.value = { ...value, result: undefined };
      }
    });
  }
}

// ExcelJS tidak membaca page break manual dari template, jadi dipasang ulang di sini.
function applyFormPageBreaks(sheet, starts, ends, usedCount) {
  const PAPER_HEIGHT_POINTS = { 1: 792, 9: 841.9 };
  const paperHeight = PAPER_HEIGHT_POINTS[sheet.pageSetup.paperSize] || 841.9;
  const margins = sheet.pageSetup.margins || {};
  const printable =
    paperHeight - ((margins.top ?? 0.75) + (margins.bottom ?? 0.75)) * 72;

  // Blok pertama dimulai di baris 1, blok berikutnya tepat setelah blok sebelumnya.
  let tallest = 0;
  for (let i = 0; i < usedCount; i++) {
    const first = i === 0 ? 1 : ends[i - 1] + 1;
    let height = 0;
    for (let row = first; row <= ends[i]; row++) {
      height += rowHeightPoints(sheet, row);
    }
    tallest = Math.max(tallest, height);
  }

  // Skala bawaan template dipertahankan, hanya diturunkan bila blok tertinggi tidak muat.
  const templateScale = sheet.pageSetup.scale || 100;
  const fitScale = Math.floor((printable / tallest) * 100 * 0.97);
  const scale = Math.max(10, Math.min(templateScale, fitScale));

  sheet.pageSetup.fitToPage = false;
  sheet.pageSetup.scale = scale;

  // Satu page break setelah baris terakhir setiap formulir, kecuali formulir terakhir.
  sheet.rowBreaks.length = 0;
  for (let i = 0; i < usedCount - 1; i++) {
    sheet.getRow(ends[i]).addPageBreak();
  }
}



function validateItem(item) {
  const required = [
    "employeeName",
    "destination",
    "purpose",
    "startDate",
    "endDate",
  ];

  const missing = required.filter(
    (field) => !String(item[field] || "").trim()
  );

  if (missing.length) {
    throw new Error(
      `Data SPPD ${item.employeeName || ""} belum lengkap: ${missing.join(", ")}`
    );
  }
}

// ---------------------------------------------------------------------------
// Kapasitas blok formulir dinamis
// Template hanya menyediakan beberapa blok per sheet. Bila perjalanan lebih banyak,
// blok tambahan digandakan dari blok template yang utuh (blok ke-2, atau blok ke-1
// bila sheet hanya punya satu blok) tepat di bawah blok terakhir pada sheet yang sama.
// ---------------------------------------------------------------------------

// Menggeser nomor baris referensi relatif (mis. L23 -> L98) pada satu rumus.
// Teks di dalam tanda kutip dan nama fungsi (mis. LOG10) tidak disentuh.
// Baris absolut ($) tidak digeser, sama seperti salin-tempel di Excel.
function shiftFormulaRows(formula, offset) {
  return String(formula)
    .split(/("(?:[^"]|"")*")/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(
            /(?<![A-Za-z0-9_.!])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g,
            (match, col, absoluteRow, row) =>
              absoluteRow ? match : `${col}${Number(row) + offset}`
          )
    )
    .join("");
}

function imageTopRow(image) {
  const tl = image.range && image.range.tl;
  if (!tl) return undefined;
  return (tl.nativeRow ?? Math.floor(tl.row ?? 0)) + 1;
}

function shiftImagePosition(position, offset) {
  if (!position) return position;

  return {
    nativeCol: position.nativeCol ?? Math.floor(position.col ?? 0),
    nativeColOff: position.nativeColOff ?? 0,
    nativeRow: (position.nativeRow ?? Math.floor(position.row ?? 0)) + offset,
    nativeRowOff: position.nativeRowOff ?? 0,
  };
}

// Menyalin satu wilayah blok (source.start..source.end) ke baris targetStart.
// Urutan penting: nilai/rumus -> merge -> style (mergeCells menimpa style sel turunan,
// jadi style harus disalin terakhir agar border tepi sel gabungan tetap utuh).
function cloneBlockRegion(sheet, source, targetStart) {
  const offset = targetStart - source.start;
  const rowCount = source.end - source.start + 1;

  // 1. Tinggi baris, nilai, dan rumus.
  for (let i = 0; i < rowCount; i++) {
    const sourceRow = sheet.getRow(source.start + i);
    const targetRow = sheet.getRow(targetStart + i);

    targetRow.height = sourceRow.height;
    targetRow.hidden = sourceRow.hidden;
    targetRow.outlineLevel = sourceRow.outlineLevel;

    sourceRow.eachCell({ includeEmpty: true }, (sourceCell, col) => {
      // Sel turunan dari sel gabungan tidak punya nilai sendiri.
      if (sourceCell.type === ExcelJS.ValueType.Merge) return;

      const targetCell = targetRow.getCell(col);

      if (sourceCell.type === ExcelJS.ValueType.Formula) {
        // cell.formula sudah menerjemahkan rumus bersama (shared formula)
        // menjadi rumus utuh untuk alamat sel ini.
        const formula = sourceCell.formula;

        targetCell.value = formula
          ? { formula: shiftFormulaRows(formula, offset) }
          : null;
        return;
      }

      const value = sourceCell.value;

      targetCell.value =
        value && typeof value === "object" ? structuredClone(value) : value;
    });
  }

  // 2. Sel gabungan yang seluruhnya berada di dalam blok sumber.
  for (const range of source.merges) {
    const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!match) continue;

    const [, startCol, startRow, endCol, endRow] = match;

    sheet.mergeCells(
      `${startCol}${Number(startRow) + offset}:${endCol}${Number(endRow) + offset}`
    );
  }

  // 3. Style sel (font, warna, border, format angka/tanggal, perataan).
  for (let i = 0; i < rowCount; i++) {
    const sourceRow = sheet.getRow(source.start + i);
    const targetRow = sheet.getRow(targetStart + i);

    sourceRow.eachCell({ includeEmpty: true }, (sourceCell, col) => {
      targetRow.getCell(col).style = structuredClone(sourceCell.style);
    });
  }

  // 4. Logo/gambar milik blok (satu gambar per blok pada template).
  for (const image of source.images) {
    const range = { tl: shiftImagePosition(image.range.tl, offset) };

    if (image.range.br) range.br = shiftImagePosition(image.range.br, offset);
    if (image.range.ext) range.ext = { ...image.range.ext };
    if (image.range.editAs) range.editAs = image.range.editAs;

    sheet.addImage(image.imageId, range);
  }
}

// Pastikan sheet punya sedikitnya `needed` blok formulir. Blok tambahan digandakan
// dari template; bila hasilnya tetap kurang, error dilempar (tidak diam-diam dilewati).
function ensureBlockCapacity(sheet, needed) {
  const starts = findBlockStarts(sheet);

  if (starts.length === 0) {
    throw new Error(`Sheet ${sheet.name} tidak memiliki blok formulir.`);
  }

  if (needed <= starts.length) return;

  const ends = findBlockEnds(sheet, starts);
  const sourceIndex = starts.length > 1 ? 1 : 0;
  const sourceStart = sourceIndex === 0 ? 1 : ends[sourceIndex - 1] + 1;
  const sourceEnd = ends[sourceIndex];
  const length = sourceEnd - sourceStart + 1;

  const source = {
    start: sourceStart,
    end: sourceEnd,
    merges: [...sheet.model.merges].filter((range) => {
      const match = String(range).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      return (
        match &&
        Number(match[2]) >= sourceStart &&
        Number(match[4]) <= sourceEnd
      );
    }),
    images: sheet.getImages().filter((image) => {
      const top = imageTopRow(image);
      return top !== undefined && top >= sourceStart && top <= sourceEnd;
    }),
  };

  let targetStart = ends[ends.length - 1] + 1;

  for (let count = starts.length; count < needed; count++) {
    cloneBlockRegion(sheet, source, targetStart);
    targetStart += length;
  }

  const after = findBlockStarts(sheet);

  if (after.length < needed) {
    throw new Error(
      `Gagal menambah blok formulir pada sheet ${sheet.name}: ` +
        `dibutuhkan ${needed}, tersedia ${after.length}.`
    );
  }
}

function safeSheetName(workbook, rawName) {
  const base =
    String(rawName || "Personel")
      .replace(/[\\/?*[\]:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || "Personel";

  let name = base;
  let n = 2;
  while (workbook.getWorksheet(name)) {
    const suffix = ` ${n++}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  return name;
}

// Menyalin satu sheet template (nilai, rumus, style, merge, lebar kolom, logo) ke sheet baru.
function createSheetFromTemplate(workbook, newName) {
  const source =
    workbook.getWorksheet("Adlim") ||
    workbook.worksheets.find((ws) => findBlockStarts(ws).length > 0);

  if (!source) {
    throw new Error("Template tidak memiliki sheet formulir yang bisa disalin.");
  }

  const copy = workbook.addWorksheet(safeSheetName(workbook, newName));

  copy.properties = structuredClone(source.properties);
  copy.pageSetup = structuredClone(source.pageSetup);
  copy.views = structuredClone(source.views);

  for (let c = 1; c <= source.columnCount; c++) {
    const sc = source.getColumn(c);
    const tc = copy.getColumn(c);
    tc.width = sc.width;
    tc.hidden = sc.hidden;
  }

  // 1. Tinggi baris, nilai, rumus.
  for (let r = 1; r <= source.rowCount; r++) {
    const sRow = source.getRow(r);
    const tRow = copy.getRow(r);
    tRow.height = sRow.height;
    tRow.hidden = sRow.hidden;

    sRow.eachCell({ includeEmpty: true }, (sCell, col) => {
      if (sCell.type === ExcelJS.ValueType.Merge) return;
      const tCell = tRow.getCell(col);

      if (sCell.type === ExcelJS.ValueType.Formula) {
        tCell.value = sCell.formula ? { formula: sCell.formula } : null;
        return;
      }

      const v = sCell.value;
      tCell.value = v && typeof v === "object" ? structuredClone(v) : v;
    });
  }

  // 2. Merge, lalu 3. style (style terakhir agar border sel gabungan utuh).
  for (const range of source.model.merges || []) {
    copy.mergeCells(range);
  }

  for (let r = 1; r <= source.rowCount; r++) {
    source.getRow(r).eachCell({ includeEmpty: true }, (sCell, col) => {
      copy.getRow(r).getCell(col).style = structuredClone(sCell.style);
    });
  }

  // 4. Logo/gambar.
  for (const image of source.getImages()) {
    const range = { tl: shiftImagePosition(image.range.tl, 0) };
    if (image.range.br) range.br = shiftImagePosition(image.range.br, 0);
    if (image.range.ext) range.ext = { ...image.range.ext };
    if (image.range.editAs) range.editAs = image.range.editAs;
    copy.addImage(image.imageId, range);
  }

  return copy;
}

async function generateWorkbook(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Tidak ada perjalanan untuk dibuatkan Excel.");
  }

  if (items.length > 100) {
    throw new Error("Maksimal 100 perjalanan dalam satu permintaan.");
  }

  items.forEach(validateItem);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await loadTemplate(TEMPLATE_NAME));

  // Data personel (sheet_name) dibaca sekali dari Supabase untuk seluruh proses ini.
  const sheetEmployees = await loadSheetEmployees();

  // Kelompokkan perjalanan berdasarkan sheet template (nama berbeda yang menunjuk
  // sheet yang sama, mis. "Adlim" dan "Muh. Adlim Najiib Amnur", masuk satu kelompok
  // agar tidak saling menimpa blok). Bila sheet belum dipetakan, pakai nama karyawan.
  const groups = new Map();

  for (const item of items) {
    const key =
      resolveSheetName(item.employeeName, sheetEmployees) ||
      String(item.employeeName).trim().toLocaleLowerCase("id-ID");

    if (!groups.has(key)) {
      groups.set(key, {
        employeeName: item.employeeName.trim(),
        items: [],
      });
    }

    groups.get(key).items.push(item);
  }

    const usedSheets = new Set();

  // Pass 1: tentukan/buat sheet untuk tiap kelompok SEBELUM ada sheet yang diisi,
  // supaya salinan template selalu berasal dari sheet yang masih bersih.
  const groupSheets = new Map();

  for (const group of groups.values()) {
    let sheetName = resolveSheetName(group.employeeName, sheetEmployees);
    let sheet = sheetName ? workbook.getWorksheet(sheetName) : undefined;

    if (!sheet) {
      sheet = createSheetFromTemplate(workbook, group.employeeName);
    }

    groupSheets.set(group, sheet);
  }

  // Pass 2: isi.
  for (const group of groups.values()) {
    const sheet = groupSheets.get(group);
    const sheetName = sheet.name;

    // Tambah blok formulir bila perjalanan melebihi blok bawaan template.
    ensureBlockCapacity(sheet, group.items.length);

    // Tambah blok formulir bila perjalanan melebihi blok bawaan template.
    ensureBlockCapacity(sheet, group.items.length);

    const starts = findBlockStarts(sheet);

group.items.forEach((item, index) => {
  fillTrip(sheet, starts[index], item);

  // Tambahkan garis pembatas di akhir setiap formulir.
 
});



    
        const usedCount = group.items.length;
    const ends = findBlockEnds(sheet, starts);

    // Batas akhir cetak = baris tanda tangan formulir terakhir yang dipakai.
    const lastUsedRow = ends[usedCount - 1];

    // Sembunyikan baris setelah formulir terakhir.
    for (let row = lastUsedRow + 1; row <= sheet.rowCount; row++) {
      sheet.getRow(row).hidden = true;
    }

    sheet.pageSetup = {
      ...sheet.pageSetup,
      paperSize: 9,
      orientation: "portrait",
      horizontalCentered: false,
      verticalCentered: false,
    };

    clearFormulaCache(sheet, lastUsedRow);
    applyFormPageBreaks(sheet, starts, ends, usedCount);

    // ExcelJS menambahkan "$" di depan tiap ujung rentang, sehingga "A$1:M$n" menjadi
    // "$A$1:$M$n". Format absolut penuh ini yang dibaca benar oleh Excel dan LibreOffice.
    sheet.pageSetup.printArea = `A$1:M$${lastUsedRow}`;

// Tandai sheet sebagai sheet yang digunakan.
usedSheets.add(sheetName);



  }

  // Hapus sheet karyawan yang tidak mempunyai perjalanan pada input terbaru.
  for (const sheet of [...workbook.worksheets]) {
    if (!usedSheets.has(sheet.name)) {
      workbook.removeWorksheet(sheet.id);
    }
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export { generateWorkbook, resolveSheetName, shiftFormulaRows, findBlockStarts, findBlockEnds };
