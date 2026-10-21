
function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/\u00a0/g, " ")
    .trim();
}

const MONTHS = {
  januari: "01",
  februari: "02",
  maret: "03",
  april: "04",
  mei: "05",
  juni: "06",
  juli: "07",
  agustus: "08",
  september: "09",
  oktober: "10",
  november: "11",
  desember: "12",
};

const MONTH_PATTERN = Object.keys(MONTHS).join("|");

function makeISODate(day, monthName, year) {
  const month = MONTHS[String(monthName).toLowerCase()];
  const d = Number(day);
  const y = Number(year);

  if (!month || !Number.isInteger(d) || !Number.isInteger(y)) {
    return "";
  }

  const date = new Date(Date.UTC(y, Number(month) - 1, d));

  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== d
  ) {
    return "";
  }

  return `${y}-${month}-${String(d).padStart(2, "0")}`;
}

function parseDateRange(text) {
  const value = String(text || "")
    .replace(
      /\b(?:hari\s+)?(?:senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  const rangeRegex = new RegExp(
    `(\\d{1,2})\\s*-\\s*(\\d{1,2})\\s*(${MONTH_PATTERN})\\s+(\\d{4})`,
    "i"
  );

  let match = value.match(rangeRegex);

  if (match) {
    const [, startDay, endDay, month, year] = match;
    const startDate = makeISODate(startDay, month, year);
    const endDate = makeISODate(endDay, month, year);

    if (startDate && endDate && endDate >= startDate) {
      return { startDate, endDate };
    }
  }

  const singleRegex = new RegExp(
    `(\\d{1,2})\\s*(${MONTH_PATTERN})\\s+(\\d{4})`,
    "i"
  );

  match = value.match(singleRegex);

  if (match) {
    const [, day, month, year] = match;
    const date = makeISODate(day, month, year);

    if (date) {
      return { startDate: date, endDate: date };
    }
  }

  // Mendukung format angka, misalnya 17-18/09/2026.
  const numericRange = value.match(
    /(\d{1,2})\s*-\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/
  );

  if (numericRange) {
    const [, startDay, endDay, month, year] = numericRange;
    const monthName = Object.keys(MONTHS).find(
      (name) => MONTHS[name] === String(month).padStart(2, "0")
    );

    const startDate = makeISODate(startDay, monthName, year);
    const endDate = makeISODate(endDay, monthName, year);

    if (startDate && endDate && endDate >= startDate) {
      return { startDate, endDate };
    }
  }

  return { startDate: "", endDate: "" };
}

function inclusiveDays(startDate, endDate) {
  if (!startDate || !endDate) return "";

  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "";
  }

  return Math.floor((end - start) / 86400000) + 1;
}

function normalizeName(value) {
  return String(value || "")
    .toLocaleLowerCase("id-ID")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Kata pembuka nama yang terlalu umum untuk dijadikan satu-satunya dasar pencocokan.
const GENERIC_NAME_TOKENS = new Set(["muh", "muhammad", "moh", "mohammad", "m"]);

function nameTokens(value) {
  return String(value || "")
    .toLocaleLowerCase("id-ID")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Semua nama yang boleh dipakai untuk mengenali satu personel (data dari backend).
function employeeNames(employee) {
  return [
    employee.name,
    employee.nickname,
    ...(Array.isArray(employee.aliases) ? employee.aliases : []),
  ].filter(Boolean);
}

// Pencocokan terkontrol nama dari pesan WhatsApp dengan data personel:
// 1) sama persis setelah huruf besar/kecil, titik, dan spasi diabaikan (nama, nama singkat, alias);
// 2) bila tidak ada, semua kata pada pesan harus ada pada satu nama personel (kata umum seperti
//    "Muh" tidak cukup sebagai dasar).
// Bila lebih dari satu personel cocok, tidak ada yang dipilih otomatis (ambiguous).
function matchEmployee(nameLine, employees = []) {
  const input = normalizeName(nameLine);
  if (!input) return { employee: null, candidates: [], partial: false };

  const exact = employees.filter((employee) =>
    employeeNames(employee).some((value) => normalizeName(value) === input)
  );

  if (exact.length === 1) {
    return { employee: exact[0], candidates: exact, partial: false };
  }

  if (exact.length > 1) {
    return { employee: null, candidates: exact, partial: false };
  }

  const tokens = nameTokens(nameLine);

  if (!tokens.some((token) => !GENERIC_NAME_TOKENS.has(token))) {
    return { employee: null, candidates: [], partial: false };
  }

  const partial = employees.filter((employee) =>
    employeeNames(employee).some((value) => {
      const personTokens = nameTokens(value);
      return tokens.every((token) => personTokens.includes(token));
    })
  );

  if (partial.length === 1) {
    return { employee: partial[0], candidates: partial, partial: true };
  }

  return { employee: null, candidates: partial, partial: false };
}

function getField(lines, pattern) {
  const line = lines.find((item) => pattern.test(item));
  if (!line) return "";

  const colonIndex = line.indexOf(":");
  if (colonIndex >= 0) return line.slice(colonIndex + 1).trim();

  return line.replace(/^\s*[-•*]\s*/, "").trim();
}


function splitIntoBlocks(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks = [];
  let current = [];

  const hasTripFields = (blockLines) =>
    blockLines.some((line) =>
      /^(?:[-•*]\s*)?(?:nama\s+kota|kota\s+atau\s+desa|desa\s+tujuan|destinasi(?:\s+sppd)?|tujuan|maksud|estimasi|tanggal|transportasi)\b/i.test(
        line.trim()
      )
    );

  const isHeaderLine = (line) => {
    const value = line
      .replace(/^\s*[-•*]\s*/, "")
      .trim();

    if (!value || value.includes(":")) return false;

    // Baris "Form SPPD:" ditangani tersendiri.
    if (/^form\s+sppd$/i.test(value)) return false;

    // Baris nama seperti MUH ADLIM atau Akram Assidik.
    if (!/^[\p{L}][\p{L}\s.'-]{1,59}$/u.test(value)) {
      return false;
    }

    if (
      /^(personil|destinasi|tujuan|maksud|estimasi|tanggal|transportasi|nama kota|desa tujuan)$/i.test(
        value
      )
    ) {
      return false;
    }

    return true;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Format pertama: setiap perjalanan diawali "Form SPPD:"
    if (/^form\s+sppd\s*:/i.test(line)) {
      if (current.length && hasTripFields(current)) {
        blocks.push(current.join("\n"));
      }

      current = [line];
      continue;
    }

    // Format kedua: setiap perjalanan diawali nama personil.
    if (
      isHeaderLine(line) &&
      current.length > 0 &&
      hasTripFields(current)
    ) {
      blocks.push(current.join("\n"));
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length && hasTripFields(current)) {
    blocks.push(current.join("\n"));
  }

  return blocks;
}


function parseBlock(block, employees = []) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  // Ambil nama dari "Personil: 1. Akram" atau baris "1. Akram".
  let nameLine = "";
  const personIndex = lines.findIndex((line) => /^personil\s*:/i.test(line));

  if (personIndex >= 0) {
    const sameLineName = lines[personIndex]
      .replace(/^personil\s*:/i, "")
      .trim();

    if (sameLineName) nameLine = sameLineName;

    if (!nameLine) {
      for (let i = personIndex + 1; i < lines.length; i++) {
        const candidate = lines[i]
          .replace(/^\s*\d+\s*[.)]\s*/, "")
          .trim();

        if (candidate && !/^(?:[-•*]\s*)?(?:destinasi|maksud|estimasi|tanggal|transportasi)\b/i.test(candidate)) {
          nameLine = candidate;
          break;
        }
      }
    }
  }

  if (!nameLine) {
    nameLine = lines.find((line) =>
      /^\s*\d+\s*[.)]\s*[\p{L}]/u.test(line)
    )?.replace(/^\s*\d+\s*[.)]\s*/, "").trim() || "";
  }

  if (!nameLine) {
    nameLine = lines.find((line) =>
      /^[\p{L}][\p{L}\s.'-]{1,59}$/u.test(line) &&
      !/^(form sppd|personil|destinasi|maksud|estimasi|tanggal|transportasi)$/i.test(line)
    ) || "";
  }

  if (!nameLine) return null;

  const cleanFieldLine = (line) =>
    line.replace(/^\s*[-•*]\s*/, "").trim();

  const fields = lines.map(cleanFieldLine);

  const destination = getField(
    fields,
    /^(?:destinasi\s+sppd|destinasi|nama\s+kota(?:\s+atau\s+desa)?\s+tujuan|kota\s+atau\s+desa\s+tujuan|desa\s+tujuan|tujuan)\s*:/i
  );

  const purpose = getField(
    fields,
    /^maksud(?:\s+sppd|\s+perjalanan\s+dinas)?\s*:/i
  );

  const transport = getField(fields, /^transportasi\s*:/i);
  const dateText = getField(fields, /^tanggal(?:\s+sppd)?\s*:/i);
  const estimateText = getField(fields, /^estimasi\s*:/i);

  const dates = parseDateRange(dateText);
  const estimateMatch = estimateText.match(/(\d+)\s*hari/i);
  const calculatedDays = inclusiveDays(dates.startDate, dates.endDate);

  const match = matchEmployee(nameLine, employees);
  const matchedEmployee = match.employee;
  const isAmbiguous = !matchedEmployee && match.candidates.length > 1;

  const nameWarning = isAmbiguous
    ? `Nama "${nameLine}" cocok dengan beberapa personel (${match.candidates
        .map((employee) => employee.name)
        .join(", ")}). Pilih karyawan yang benar.`
    : match.partial
      ? `Nama "${nameLine}" dicocokkan sebagian dengan ${matchedEmployee.name}. Pastikan sudah benar.`
      : "";

  return {
    employeeId: matchedEmployee?.id || "",
    // Nama dikosongkan bila ambigu agar validasi yang sudah ada meminta pengguna memilih karyawan.
    employeeName: isAmbiguous
      ? ""
      : String(matchedEmployee?.name || nameLine).toLocaleUpperCase("id-ID"),
    position: matchedEmployee?.position || "",
    purpose,
    destination,
    transport,
    startDate: dates.startDate,
    endDate: dates.endDate,
    durationDays: estimateMatch
      ? Number(estimateMatch[1])
      : calculatedDays,
    status: matchedEmployee ? "matched" : isAmbiguous ? "ambiguous" : "unmatched",
    parseWarning: !dates.startDate
      ? "Tanggal belum dikenali. Periksa format tanggal."
      : "",
    nameWarning,
  };
}

export function parseWhatsAppMessages(text, employees = []) {
  return splitIntoBlocks(text)
    .map((block) => parseBlock(block, employees))
    .filter(Boolean);
}
