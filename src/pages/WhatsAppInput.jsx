
import { useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  FileCheck,
  AlertCircle,
  Eye,
  Download,
  RotateCcw,
  Save,
  FolderOpen,
  Trash2,
  Plus,
  Loader2,
  MapPin,
  CalendarDays,
  Clock,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  FileArchive,
  X,
} from "lucide-react";
import { parseWhatsAppMessages } from "../utils/whatsappParser";
import { useFeedback } from "../components/Feedback";
import DocxPreview from "../components/DocxPreview";
import { saveBlob } from "../services/backup";
import { apiFetch, API_URL } from "../services/localApi";


function formatDate(value) {
  if (!value) return "";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function terbilangHari(value) {
  const angka = [
    "Nol", "Satu", "Dua", "Tiga", "Empat", "Lima",
    "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh",
    "Sebelas",
  ];

  if (value < 12) return angka[value] || String(value);
  if (value < 20) return `${angka[value - 10]} Belas`;
  if (value < 100) {
    const puluhan = Math.floor(value / 10);
    const satuan = value % 10;
    return `${angka[puluhan]} Puluh${satuan ? ` ${angka[satuan]}` : ""}`;
  }

  return String(value);
}

function buildSppdPayload(item, letterDate, recipient, managerName) {
  const start = new Date(`${item.startDate}T00:00:00`);
  const end = new Date(`${item.endDate}T00:00:00`);

  const durationDays =
    Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

  return {
    tanggalSurat: formatDate(letterDate),
    perihal: "Permohonan",
    subPerihal: "Pemeliharaan ULTG Parepare",
    penerima: recipient.trim() || "Manager PLN Tarakan Regional Sulawesi 2",
    namaPegawai: item.employeeName.trim(),
    maksud: item.purpose.trim(),
    tujuan: item.destination.trim(),
    durasi: String(durationDays).padStart(2, "0"),
    durasiTerbilang: terbilangHari(durationDays),
    tanggalBerangkat: formatDate(item.startDate),
    tanggalKembali: formatDate(item.endDate),
    namaManajer: managerName.trim().toLocaleUpperCase("id-ID"),
  };
}

// Bidang sementara di layar yang tidak perlu disimpan ke draft.
const RUNTIME_FIELDS = [
  "previewUrl",
  "previewLoading",
  "excelPreviewUrl",
  "excelPreviewLoading",
  "downloadLoading",
];

function stripRuntimeFields(item) {
  const cleaned = { ...item };
  RUNTIME_FIELDS.forEach((field) => delete cleaned[field]);
  return cleaned;
}

function withRuntimeFields(item, index) {
  return {
    ...item,
    key: `${Date.now()}-${index}`,
    previewUrl: "",
    previewLoading: false,
    excelPreviewUrl: "",
    excelPreviewLoading: false,
    downloadLoading: false,
  };
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WhatsAppInput({ active = true }) {
  const [message, setMessage] = useState("");
  const [employees, setEmployees] = useState([]);
  const [results, setResults] = useState([]);
  const [letterDate, setLetterDate] = useState("");
  const [recipient, setRecipient] = useState(
    "Manager PLN Tarakan Regional Sulawesi 2"
  );
  const [managerName, setManagerName] = useState("SAMSU ALAM");
  const { toast, confirm } = useFeedback();
  const [, setErrorState] = useState("");
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  // Pesan kesalahan ditampilkan sebagai notifikasi; pemanggil setError tidak berubah.
  function setError(message) {
    setErrorState(message);
    if (message) toast.error(message);
  }

  // State fitur draft.
  const [draftId, setDraftId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [, setDraftNoticeState] = useState("");
  const [draftsOpen, setDraftsOpen] = useState(true);

  // Pesan sukses draft ditampilkan sebagai notifikasi.
  function setDraftNotice(message) {
    setDraftNoticeState(message);
    if (message) toast.success(message);
  }

  useEffect(() => {
    apiFetch(`${API_URL}/employees`)
      .then((response) => {
        if (!response.ok) throw new Error("Gagal memuat karyawan.");
        return response.json();
      })
      .then(setEmployees)
      .catch(() => setError("Terjadi kesalahan pada aplikasi."))
      .finally(() => setLoadingEmployees(false));
  }, []);

  function handleParse() {
    setError("");

    if (!message.trim()) {
      setError("Tempelkan pesan WhatsApp terlebih dahulu.");
      return;
    }

    const parsed = parseWhatsAppMessages(message, employees);

    if (!parsed.length) {
      setError("Belum ada pesan yang dapat dibaca.");
      return;
    }

    setResults(
      parsed.map((item, index) => ({
        ...item,
        key: `${Date.now()}-${index}`,
        previewUrl: "",
        previewLoading: false,
        excelPreviewUrl: "",
        excelPreviewLoading: false,
        downloadLoading: false,
      }))
    );
  }

  function updateResult(index, field, value) {
    setResults((current) =>
      current.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  }

  function validateItem(item) {
    if (
      !letterDate ||
      !item.employeeName?.trim() ||
      !item.purpose?.trim() ||
      !item.destination?.trim() ||
      !item.startDate ||
      !item.endDate
    ) {
      return "Lengkapi tanggal surat, karyawan, maksud, tujuan, dan tanggal perjalanan.";
    }

    if (item.endDate < item.startDate) {
      return "Tanggal kembali tidak boleh lebih awal daripada tanggal berangkat.";
    }

    if (!managerName.trim()) {
      return "Isi nama manajer terlebih dahulu.";
    }

    return "";
  }

  async function handlePreview(index) {
    const item = results[index];
    const validationError = validateItem(item);

    if (validationError) {
      setError(`${item.employeeName || "Perjalanan ini"}: ${validationError}`);
      return;
    }

    setError("");
    updateResult(index, "previewLoading", true);

    try {
      const payload = buildSppdPayload(
        item,
        letterDate,
        recipient,
        managerName
      );

      const response = await apiFetch(`${API_URL}/sppd/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = "Gagal membuat pratinjau SPPD.";
        try {
          const data = await response.json();
          message = data.message || message;
        } catch {}
        throw new Error(message);
      }

      const blob = await response.blob();
      const newUrl = URL.createObjectURL(blob);

      setResults((current) =>
        current.map((row, i) => {
          if (i !== index) return row;
          if (row.previewUrl) URL.revokeObjectURL(row.previewUrl);
          return {
            ...row,
            previewUrl: newUrl,
            previewLoading: false,
          };
        })
      );
    } catch (err) {
      setError(err.message || "Terjadi kesalahan pada aplikasi.");
      updateResult(index, "previewLoading", false);
    }
  }

  async function handleDownload(index) {
    const item = results[index];
    const validationError = validateItem(item);

    if (validationError) {
      setError(`${item.employeeName || "Perjalanan ini"}: ${validationError}`);
      return;
    }

    setError("");
    updateResult(index, "downloadLoading", true);

    try {
      const payload = buildSppdPayload(
        item,
        letterDate,
        recipient,
        managerName
      );

      const response = await apiFetch(`${API_URL}/sppd/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = "Gagal membuat dokumen Word.";
        try {
          const data = await response.json();
          message = data.message || message;
          if (data.detail) {
            message += ` ${Array.isArray(data.detail) ? data.detail.join(", ") : data.detail}`;
          }
        } catch {}
        throw new Error(message);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = item.employeeName
        .trim()
        .replace(/[^\w.-]+/g, "_");

      link.href = objectUrl;
      link.download = `SPPD_${safeName}_${item.startDate}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    toast.success("Dokumen Word SPPD berhasil dibuat.");
    } catch (err) {
      setError(err.message || "Terjadi kesalahan pada aplikasi.");
    } finally {
      updateResult(index, "downloadLoading", false);
    }
  }

  
  // Pratinjau formulir Excel satu perjalanan (dokumen Word sementara, tidak mengunduh file).
  async function handlePreviewExcel(index) {
    const item = results[index];

    if (
      !item.employeeName?.trim() ||
      !item.destination?.trim() ||
      !item.purpose?.trim() ||
      !item.startDate ||
      !item.endDate
    ) {
      setError("Lengkapi data karyawan, tujuan, maksud, dan tanggal perjalanan.");
      return;
    }

    if (item.endDate < item.startDate) {
      setError("Tanggal kembali tidak boleh lebih awal daripada tanggal berangkat.");
      return;
    }

    setError("");
    updateResult(index, "excelPreviewLoading", true);

    try {
      // Payload sama persis dengan tombol Unduh Excel.
      const payload = {
        employeeName: item.employeeName.trim(),
        destination: item.destination.trim(),
        purpose: item.purpose.trim(),
        startDate: item.startDate,
        endDate: item.endDate,
        position: positionFor(item),
      };

      const response = await apiFetch(`${API_URL}/sppd-preview/excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Gagal membuat pratinjau Excel SPPD.");
      }

      const blob = await response.blob();
      const newUrl = URL.createObjectURL(blob);

      setResults((current) =>
        current.map((row, i) => {
          if (i !== index) return row;
          if (row.excelPreviewUrl) URL.revokeObjectURL(row.excelPreviewUrl);
          return {
            ...row,
            excelPreviewUrl: newUrl,
            excelPreviewLoading: false,
          };
        })
      );
    } catch (err) {
      setError(err.message || "Terjadi kesalahan pada aplikasi.");
      updateResult(index, "excelPreviewLoading", false);
    }
  }

  // Unduh Excel untuk satu perjalanan.
  async function handleDownloadExcel(index) {
    const item = results[index];

    if (
      !item.employeeName?.trim() ||
      !item.destination?.trim() ||
      !item.purpose?.trim() ||
      !item.startDate ||
      !item.endDate
    ) {
      setError("Lengkapi data karyawan, tujuan, maksud, dan tanggal perjalanan.");
      return;
    }

    if (item.endDate < item.startDate) {
      setError("Tanggal kembali tidak boleh lebih awal daripada tanggal berangkat.");
      return;
    }

    setError("");
    updateResult(index, "downloadLoading", true);

    try {
      const payload = {
        employeeName: item.employeeName.trim(),
        destination: item.destination.trim(),
        purpose: item.purpose.trim(),
        startDate: item.startDate,
        endDate: item.endDate,
        position: positionFor(item),
      };

      const response = await apiFetch(`${API_URL}/sppd-excel/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Gagal membuat Excel SPPD.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = item.employeeName.trim().replace(/[^\w.-]+/g, "_");

      link.href = objectUrl;
      link.download = `SPPD_${safeName}_${item.startDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    toast.success("File Excel SPPD berhasil dibuat.");
    } catch (err) {
      setError(err.message || "Terjadi kesalahan pada aplikasi.");
    } finally {
      updateResult(index, "downloadLoading", false);
    }
  }

  
async function handleDownloadAllExcel() {
  setError("");

  if (results.length === 0) {
    setError("Baca pesan WhatsApp terlebih dahulu.");
    return;
  }

  const invalidItem = results.find((item) =>
    !item.employeeName?.trim() ||
    !item.destination?.trim() ||
    !item.purpose?.trim() ||
    !item.startDate ||
    !item.endDate ||
    item.endDate < item.startDate
  );

  if (invalidItem) {
    setError(
      `Periksa kembali data SPPD ${invalidItem.employeeName || "yang belum lengkap"}.`
    );
    return;
  }

  // Kelompokkan perjalanan berdasarkan nama karyawan.
  const groups = new Map();

  for (const item of results) {
    const key = item.employeeName.trim().toLocaleLowerCase("id-ID");

    if (!groups.has(key)) {
      groups.set(key, {
        employeeName: item.employeeName.trim(),
        items: [],
      });
    }

    groups.get(key).items.push({
      employeeName: item.employeeName.trim(),
      destination: item.destination.trim(),
      purpose: item.purpose.trim(),
      startDate: item.startDate,
      endDate: item.endDate,
      position: positionFor(item),
    });
  }

  setResults((current) =>
    current.map((item) => ({ ...item, downloadLoading: true }))
  );

  try {
    // Minta satu workbook untuk setiap karyawan.
    for (const group of groups.values()) {
      const response = await apiFetch(
        `${API_URL}/sppd-excel/generate-all`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: group.items }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          `Gagal membuat Excel ${group.employeeName}: ${
            data.message || "Kesalahan server."
          }`
        );
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = group.employeeName.replace(/[^\w.-]+/g, "_");

      link.href = objectUrl;
      link.download = `SPPD_${safeName}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

      // Beri jeda agar browser lebih mudah memproses beberapa unduhan.
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  toast.success("Semua file Excel SPPD berhasil dibuat.");
    } catch (err) {
    setError(err.message || "Terjadi kesalahan pada aplikasi.");
  } finally {
    setResults((current) =>
      current.map((item) => ({ ...item, downloadLoading: false }))
    );
  }
}



  
async function handleDownloadAll() {
  setError("");

  if (results.length === 0) {
    setError("Baca pesan WhatsApp terlebih dahulu.");
    return;
  }

  if (!letterDate) {
    setError("Isi tanggal surat terlebih dahulu.");
    return;
  }

  const invalidItem = results.find((item) => {
    return (
      !item.employeeName?.trim() ||
      !item.purpose?.trim() ||
      !item.destination?.trim() ||
      !item.startDate ||
      !item.endDate ||
      item.endDate < item.startDate
    );
  });

  if (invalidItem) {
    setError(
      `Periksa kembali data SPPD ${invalidItem.employeeName || "yang belum lengkap"}.`
    );
    return;
  }

  if (!managerName.trim()) {
    setError("Isi nama manajer terlebih dahulu.");
    return;
  }

  setResults((current) =>
    current.map((item) => ({
      ...item,
      downloadLoading: true,
    }))
  );

  try {
    const items = results.map((item) =>
      buildSppdPayload(item, letterDate, recipient, managerName)
    );

    const response = await apiFetch(`${API_URL}/sppd/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
    });

    if (!response.ok) {
      let message = "Gagal membuat dokumen gabungan.";

      try {
        const data = await response.json();
        message = data.message || message;

        if (data.detail) {
          message += ` ${
            Array.isArray(data.detail)
              ? data.detail.join(", ")
              : data.detail
          }`;
        }
      } catch {}

      throw new Error(message);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = `SPPD_Hasil_WhatsApp_${items.length}_surat.docx`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  toast.success("Dokumen SPPD berhasil dibuat.");
    } catch (err) {
    setError(err.message || "Terjadi kesalahan pada aplikasi.");
  } finally {
    setResults((current) =>
      current.map((item) => ({
        ...item,
        downloadLoading: false,
      }))
    );
  }
}

  // Unduh satu file Word berisi surat dan formulir Excel secara berselang-seling.
  async function handleDownloadCombined() {
    setError("");

    if (results.length === 0) {
      setError("Baca pesan WhatsApp terlebih dahulu.");
      return;
    }

    if (!letterDate) {
      setError("Isi tanggal surat terlebih dahulu.");
      return;
    }

    if (!managerName.trim()) {
      setError("Isi nama manajer terlebih dahulu.");
      return;
    }

    const invalidItem = results.find(
      (item) =>
        !item.employeeName?.trim() ||
        !item.purpose?.trim() ||
        !item.destination?.trim() ||
        !item.startDate ||
        !item.endDate ||
        item.endDate < item.startDate
    );

    if (invalidItem) {
      setError(
        `Periksa kembali data SPPD ${invalidItem.employeeName || "yang belum lengkap"}.`
      );
      return;
    }

    setResults((current) =>
      current.map((item) => ({ ...item, downloadLoading: true }))
    );

    try {
      // Elemen ke-i pada items (surat Word) dan trips (formulir Excel) adalah perjalanan yang sama.
      const items = results.map((item) =>
        buildSppdPayload(item, letterDate, recipient, managerName)
      );

      const trips = results.map((item) => ({
        employeeName: item.employeeName.trim(),
        destination: item.destination.trim(),
        purpose: item.purpose.trim(),
        startDate: item.startDate,
        endDate: item.endDate,
        position: positionFor(item),
      }));

      const response = await apiFetch(`${API_URL}/sppd-gabungan/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, trips }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Gagal membuat dokumen gabungan.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      const names = new Set(
        results.map((item) => item.employeeName.trim().toLocaleLowerCase("id-ID"))
      );
      const label =
        names.size === 1 ? results[0].employeeName.trim() : "Beberapa_Pegawai";
      const safeName = label.replace(/[^\w.-]+/g, "_");

      link.href = objectUrl;
      link.download = `SPPD_Gabungan_${safeName}_${results.length}_perjalanan.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    toast.success("Dokumen gabungan Word + Excel berhasil dibuat.");
    } catch (err) {
      setError(err.message || "Terjadi kesalahan pada aplikasi.");
    } finally {
      setResults((current) =>
        current.map((item) => ({ ...item, downloadLoading: false }))
      );
    }
  }

  // ===== Unduh Word + Excel dari data SPPD yang sama =====

  const pause = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  async function readResponseError(response, fallback) {
    const data = await response.json().catch(() => ({}));
    let message = data.message || fallback;

    if (data.detail?.length) {
      message += ` ${Array.isArray(data.detail) ? data.detail.join(", ") : data.detail}`;
    }

    return message;
  }

  // Memeriksa seluruh perjalanan sebelum membuat Word + Excel; mengembalikan pesan kesalahan.
  function validateAllForDocuments() {
    if (results.length === 0) return "Baca pesan WhatsApp terlebih dahulu.";
    if (!letterDate) return "Isi tanggal surat terlebih dahulu.";
    if (!managerName.trim()) return "Isi nama manajer terlebih dahulu.";

    const invalidItem = results.find(
      (item) =>
        !item.employeeName?.trim() ||
        !item.purpose?.trim() ||
        !item.destination?.trim() ||
        !item.startDate ||
        !item.endDate ||
        item.endDate < item.startDate
    );

    return invalidItem
      ? `Periksa kembali data SPPD ${invalidItem.employeeName || "yang belum lengkap"}.`
      : "";
  }

  function buildExcelPayload(item) {
    return {
      employeeName: item.employeeName.trim(),
      destination: item.destination.trim(),
      purpose: item.purpose.trim(),
      startDate: item.startDate,
      endDate: item.endDate,
      position: positionFor(item),
    };
  }

  function labelFor(list) {
    const names = new Set(list.map((item) => item.employeeName.trim().toLocaleLowerCase("id-ID")));
    return names.size === 1 ? list[0].employeeName.trim().replace(/[^\w.-]+/g, "_") : "Beberapa_Pegawai";
  }

  // Satu pemanggilan membuat Word dan Excel dari daftar perjalanan yang sama.
  async function buildWordAndExcel(list) {
    const items = list.map((item) => buildSppdPayload(item, letterDate, recipient, managerName));
    const trips = list.map(buildExcelPayload);

    const wordResponse = await apiFetch(`${API_URL}/sppd/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });

    if (!wordResponse.ok) {
      throw new Error(await readResponseError(wordResponse, "Gagal membuat dokumen Word."));
    }

    const excelResponse = await apiFetch(`${API_URL}/sppd-excel/generate-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: trips }),
    });

    if (!excelResponse.ok) {
      throw new Error(await readResponseError(excelResponse, "Gagal membuat file Excel."));
    }

    return {
      items,
      trips,
      word: await wordResponse.blob(),
      excel: await excelResponse.blob(),
    };
  }

  async function runWithLoading(indexes, work) {
    setError("");
    setResults((current) =>
      current.map((item, i) => (indexes.includes(i) ? { ...item, downloadLoading: true } : item))
    );

    try {
      await work();
    } catch (err) {
      setError(err.message || "Terjadi kesalahan pada aplikasi.");
    } finally {
      setResults((current) =>
        current.map((item, i) => (indexes.includes(i) ? { ...item, downloadLoading: false } : item))
      );
    }
  }

  // Unduh Word + Excel untuk semua perjalanan: dua file, dari data yang sama.
  async function handleDownloadWordExcel() {
    const validationError = validateAllForDocuments();

    if (validationError) {
      setError(validationError);
      return;
    }

    await runWithLoading(
      results.map((_, i) => i),
      async () => {
        const { word, excel } = await buildWordAndExcel(results);
        const label = labelFor(results);

        saveBlob(word, `SPPD_${label}_${results.length}_surat.docx`);
        // Jeda agar browser tidak memblokir unduhan kedua.
        await pause(600);
        saveBlob(excel, `SPPD_Excel_${label}_${results.length}_perjalanan.xlsx`);

        toast.success("Dokumen Word dan Excel SPPD berhasil dibuat.");
      }
    );
  }

  // Alternatif: satu file ZIP berisi Word + Excel (tidak bergantung pada izin unduhan ganda).
  async function handleDownloadZip() {
    const validationError = validateAllForDocuments();

    if (validationError) {
      setError(validationError);
      return;
    }

    await runWithLoading(
      results.map((_, i) => i),
      async () => {
        const response = await apiFetch(`${API_URL}/sppd-paket/zip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: results.map((item) => buildSppdPayload(item, letterDate, recipient, managerName)),
            trips: results.map(buildExcelPayload),
          }),
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response, "Gagal membuat file ZIP."));
        }

        saveBlob(await response.blob(), `SPPD_${labelFor(results)}_${results.length}_Word_Excel.zip`);
        toast.success("File ZIP berisi Word dan Excel berhasil dibuat.");
      }
    );
  }

  // Word + Excel untuk satu perjalanan.
  async function handleDownloadWordExcelOne(index) {
    const item = results[index];
    const validationError = validateItem(item);

    if (validationError) {
      setError(`${item.employeeName || "Perjalanan ini"}: ${validationError}`);
      return;
    }

    await runWithLoading([index], async () => {
      const { word, excel } = await buildWordAndExcel([item]);
      const safeName = item.employeeName.trim().replace(/[^\w.-]+/g, "_");

      saveBlob(word, `SPPD_${safeName}_${item.startDate}.docx`);
      await pause(600);
      saveBlob(excel, `SPPD_${safeName}_${item.startDate}.xlsx`);

      toast.success("Dokumen Word dan Excel SPPD berhasil dibuat.");
    });
  }

  // Posisi selalu diambil dari data personel terbaru (berdasarkan ID); posisi tersimpan pada
  // perjalanan hanya dipakai bila personel tidak ditemukan lagi.
  function positionFor(item) {
    const employee = employees.find((person) => person.id === item.employeeId);
    return employee?.position || item.position || "";
  }

  // Muat ulang data personel setiap halaman ini dibuka kembali, lalu sinkronkan nama dan posisi
  // pada perjalanan yang sedang dikerjakan.
  const skipFirstActiveRun = useRef(true);

  useEffect(() => {
    if (skipFirstActiveRun.current) {
      skipFirstActiveRun.current = false;
      return;
    }

    if (!active) return;

    apiFetch(`${API_URL}/employees`)
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((list) => {
        setEmployees(list);
        setResults((current) =>
          current.map((item) => {
            const employee = list.find((person) => person.id === item.employeeId);
            if (!employee) return item;

            const sameName =
              String(item.employeeName || "").trim().toLocaleLowerCase("id-ID") ===
              employee.name.trim().toLocaleLowerCase("id-ID");

            return {
              ...item,
              employeeName: sameName
                ? item.employeeName
                : employee.name.toLocaleUpperCase("id-ID"),
              position: employee.position || "",
            };
          })
        );
      })
      .catch(() => setError("Data personel terbaru tidak dapat dimuat."));
  }, [active]);

  // ===== Fitur Draft =====
  async function loadDrafts() {
    try {
      const response = await apiFetch(`${API_URL}/drafts`);
      if (!response.ok) throw new Error();
      setDrafts(await response.json());
    } catch {
      setError("Daftar draft tidak dapat dimuat. Periksa penyimpanan browser.");
    } finally {
      setDraftsLoading(false);
    }
  }

  useEffect(() => {
    loadDrafts();
  }, []);

  async function handleSaveDraft() {
    setError("");
    setDraftNotice("");

    if (results.length === 0 && !message.trim()) {
      setError("Belum ada data untuk disimpan sebagai draft.");
      return;
    }

    const body = JSON.stringify({
      name: draftName,
      message,
      letterDate,
      recipient,
      managerName,
      results: results.map(stripRuntimeFields),
    });
    const headers = { "Content-Type": "application/json" };

    setSavingDraft(true);

    try {
      let response = draftId
        ? await apiFetch(`${API_URL}/drafts/${draftId}`, { method: "PUT", headers, body })
        : null;

      // Draft sudah terhapus di tempat lain: simpan sebagai draft baru.
      if (!response || response.status === 404) {
        response = await apiFetch(`${API_URL}/drafts`, { method: "POST", headers, body });
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Gagal menyimpan draft.");
      }

      setDraftId(data.draft.id);
      setDraftName(data.draft.name);
      setDraftNotice(`Draft "${data.draft.name}" tersimpan.`);
      await loadDrafts();
    } catch (err) {
      setError(err.message || "Terjadi kesalahan pada aplikasi.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleOpenDraft(id) {
    setError("");
    setDraftNotice("");

    try {
      const response = await apiFetch(`${API_URL}/drafts/${id}`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Draft tidak dapat dibuka.");
      }

      results.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        if (item.excelPreviewUrl) URL.revokeObjectURL(item.excelPreviewUrl);
      });

      setMessage(data.message || "");
      setLetterDate(data.letterDate || "");
      setRecipient(data.recipient || "Manager PLN Tarakan Regional Sulawesi 2");
      setManagerName(data.managerName || "SAMSU ALAM");
      setResults((data.results || []).map(withRuntimeFields));
      setDraftId(data.id);
      setDraftName(data.name || "");
      setDraftNotice(`Draft "${data.name}" dibuka. Perubahan akan disimpan ke draft yang sama.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message || "Terjadi kesalahan pada aplikasi.");
    }
  }

  async function handleDeleteDraft(draft) {
    const confirmed = await confirm({
      title: "Hapus draft?",
      message: `Yakin ingin menghapus draft "${draft.name}"? Draft yang dihapus tidak dapat dikembalikan.`,
      confirmLabel: "Hapus Draft",
      danger: true,
    });

    if (!confirmed) return;

    setError("");
    setDraftNotice("");

    try {
      const response = await apiFetch(`${API_URL}/drafts/${draft.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Gagal menghapus draft.");
      }

      // Bila yang dihapus sedang dibuka, formulir tetap ada tetapi tidak lagi terhubung ke draft.
      if (draft.id === draftId) {
        setDraftId(null);
        setDraftName("");
      }

      setDraftNotice("Draft berhasil dihapus.");
      await loadDrafts();
    } catch (err) {
      setError(err.message || "Terjadi kesalahan pada aplikasi.");
    }
  }

  // Tutup pratinjau yang sedang tampil dan bebaskan URL sementaranya.
  function closePreview(index, field) {
    const url = results[index]?.[field];
    if (url) URL.revokeObjectURL(url);
    updateResult(index, field, "");
  }

  // Hanya untuk tampilan lencana status; tidak memengaruhi validasi unduhan.
  function isTripComplete(item) {
    return Boolean(
      item.employeeName?.trim() &&
        item.purpose?.trim() &&
        item.destination?.trim() &&
        item.startDate &&
        item.endDate &&
        item.endDate >= item.startDate
    );
  }

  function handleAddTrip() {
    setResults((current) => [
      ...current,
      withRuntimeFields(
        {
          employeeId: "",
          employeeName: "",
          purpose: "",
          destination: "",
          transport: "",
          startDate: "",
          endDate: "",
          durationDays: null,
          status: "unmatched",
          parseWarning: "",
        },
        current.length
      ),
    ]);
  }

  async function handleRemoveTrip(index) {
    const item = results[index];
    const confirmed = await confirm({
      title: "Hapus perjalanan?",
      message: `Hapus perjalanan ${item.employeeName || `nomor ${index + 1}`} dari daftar ini? Perubahan baru tersimpan ke draft setelah Anda menekan Simpan Draft.`,
      confirmLabel: "Hapus Perjalanan",
      danger: true,
    });

    if (!confirmed) return;

    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.excelPreviewUrl) URL.revokeObjectURL(item.excelPreviewUrl);

    setResults((current) => current.filter((_, i) => i !== index));
  }

  async function resetResults() {
    // Konfirmasi hanya bila ada data yang akan hilang.
    if (results.length > 0 || message.trim()) {
      const confirmed = await confirm({
        title: "Mulai input baru?",
        message:
          "Pesan dan hasil pembacaan yang sedang dikerjakan akan dikosongkan. Draft yang sudah tersimpan tidak terhapus.",
        confirmLabel: "Mulai Input Baru",
        danger: true,
      });

      if (!confirmed) return;
    }

    setDraftId(null);
    setDraftName("");
    setDraftNotice("");
    results.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item.excelPreviewUrl) URL.revokeObjectURL(item.excelPreviewUrl);
    });
    setResults([]);
    setMessage("");
    setError("");
  }

  const anyLoading = results.some((item) => item.downloadLoading);
  const step = results.length > 0 ? 2 : 1;

  return (
    <main className="page">
      <header className="page-header">
        <h1>SURAT PERINTAH PERJALANAN DINAS</h1>
        <p>
          Masukkan informasi perjalanan melalui pesan WhatsApp, periksa hasil
          pembacaan data, lalu siapkan dokumen SPPD.
        </p>

        <ol className="steps" aria-label="Langkah pengerjaan">
          <li className={step === 1 ? "current" : "done"}>
            <span>{step > 1 ? <CheckCircle2 size={16} /> : 1}</span>
            Tempel pesan
          </li>
          <li className={step === 2 ? "current" : ""}>
            <span>2</span>
            Periksa hasil
          </li>
          <li>
            <span>3</span>
            Unduh dokumen
          </li>
        </ol>
      </header>

      <section className="card">
        <div className="card-title">
          <h2>
            <ClipboardPaste size={20} aria-hidden="true" /> Pesan WhatsApp
          </h2>
        </div>

        <div className="field">
          <label htmlFor="wa-message">Tempel pesan WhatsApp di sini</label>
          <textarea
            id="wa-message"
            className="input textarea-lg"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={`MUH ADLIM
Nama Kota atau Desa Tujuan: Parepare - Polmas
Maksud SPPD: Pengawasan pelepasan kabel ADSS
Estimasi: 3 hari
Tanggal: 2 - 4 September 2026`}
            rows={9}
          />
          <small className="hint">
            Anda dapat menempelkan beberapa pesan sekaligus. Hasilnya tetap bisa
            diperiksa dan diubah sebelum dokumen dibuat.
          </small>
        </div>

        <div className="field field-inline">
          <label htmlFor="wa-draft-name">Nama draft (opsional)</label>
          <input
            id="wa-draft-name"
            className="input"
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Kosongkan agar nama dibuat otomatis"
          />
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleParse}
            disabled={loadingEmployees}
          >
            {loadingEmployees ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <FileCheck size={18} />
            )}
            {loadingEmployees ? "Memuat data karyawan..." : "Baca Pesan"}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSaveDraft}
            disabled={savingDraft}
          >
            {savingDraft ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <Save size={18} />
            )}
            {savingDraft
              ? "Menyimpan draft..."
              : draftId
                ? "Simpan Perubahan Draft"
                : "Simpan Draft"}
          </button>

          {results.length === 0 && (
            <button
              type="button"
              className="btn btn-ghost actions-end"
              onClick={handleAddTrip}
            >
              <Plus size={18} />
              Tambah Perjalanan Manual
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <button
          type="button"
          className="card-toggle"
          onClick={() => setDraftsOpen((open) => !open)}
          aria-expanded={draftsOpen}
        >
          <h2>
            <FolderOpen size={20} aria-hidden="true" /> Draft Tersimpan
            <span className="count-badge">{drafts.length}</span>
          </h2>
          <ChevronDown
            size={20}
            className={`chevron ${draftsOpen ? "open" : ""}`}
            aria-hidden="true"
          />
        </button>

        {draftsOpen &&
          (draftsLoading ? (
            <p className="muted">Memuat draft...</p>
          ) : drafts.length === 0 ? (
            <p className="muted">
              Belum ada draft. Tekan Simpan Draft bila data perjalanan belum
              lengkap.
            </p>
          ) : (
            <div className="draft-list">
              {drafts.map((draft) => (
                <article
                  key={draft.id}
                  className={`draft-item ${draft.id === draftId ? "current" : ""}`}
                >
                  <div className="draft-info">
                    <strong>
                      {draft.name}
                      {draft.id === draftId && (
                        <span className="status-chip info">Sedang dibuka</span>
                      )}
                    </strong>
                    <div className="draft-meta">
                      {draft.tripCount} perjalanan
                      {" · "}
                      Diperbarui {formatDateTime(draft.updatedAt)}
                      {" · "}
                      <span
                        className={
                          draft.status === "Siap diproses"
                            ? "text-ok"
                            : "text-warn"
                        }
                      >
                        {draft.status}
                      </span>
                    </div>
                    {(draft.employeeNames?.length > 0 ||
                      draft.destinations?.length > 0) && (
                      <div className="draft-summary">
                        {draft.employeeNames?.join(", ")}
                        {draft.employeeNames?.length > 0 &&
                          draft.destinations?.length > 0 &&
                          " — "}
                        {draft.destinations?.join(", ")}
                      </div>
                    )}
                  </div>

                  <div className="draft-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenDraft(draft.id)}
                    >
                      <FolderOpen size={16} /> Buka
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-soft btn-sm"
                      onClick={() => handleDeleteDraft(draft)}
                      aria-label={`Hapus draft ${draft.name}`}
                    >
                      <Trash2 size={16} /> Hapus
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ))}
      </section>

      {results.length > 0 && (
        <>
          <section className="card">
            <div className="card-title">
              <h2>Informasi Surat</h2>
              <p>Berlaku untuk semua surat pada daftar di bawah.</p>
            </div>

            <div className="form-grid cols-3">
              <div className="field">
                <label htmlFor="wa-letter-date">Tanggal surat</label>
                <input
                  id="wa-letter-date"
                  className="input"
                  type="date"
                  value={letterDate}
                  onChange={(event) => setLetterDate(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="wa-recipient">Penerima surat</label>
                <input
                  id="wa-recipient"
                  className="input"
                  type="text"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="wa-manager">Nama manajer</label>
                <input
                  id="wa-manager"
                  className="input"
                  type="text"
                  value={managerName}
                  onChange={(event) => setManagerName(event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="results-section">
            <div className="section-bar">
              <div>
                <h2>Hasil Pembacaan ({results.length})</h2>
                <p>
                  Setiap kartu menghasilkan satu surat SPPD. Periksa datanya
                  sebelum mengunduh.
                </p>
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleSaveDraft}
                  disabled={savingDraft}
                >
                  {savingDraft ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  {savingDraft
                    ? "Menyimpan..."
                    : draftId
                      ? "Simpan Perubahan Draft"
                      : "Simpan Draft"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost-danger btn-sm"
                  onClick={resetResults}
                >
                  <RotateCcw size={16} />
                  Mulai Input Baru
                </button>
              </div>
            </div>

            {results.map((item, index) => {
              const duration =
                item.startDate &&
                item.endDate &&
                item.endDate >= item.startDate
                  ? Math.round(
                      (new Date(`${item.endDate}T00:00:00`) -
                        new Date(`${item.startDate}T00:00:00`)) /
                        86400000
                    ) + 1
                  : null;
              const complete = isTripComplete(item);
              const busy = item.previewLoading || item.downloadLoading;

              return (
                <article key={item.key} className="trip-card">
                  <header className="trip-card-header">
                    <span className="trip-number">{index + 1}</span>

                    <div className="trip-heading">
                      <h3>{item.employeeName || "Karyawan belum dipilih"}</h3>
                      <p>{positionFor(item) || "Jabatan belum tersedia"}</p>
                    </div>

                    <span
                      className={`status-chip ${complete ? "ok" : "warn"}`}
                    >
                      {complete ? (
                        <CheckCircle2 size={14} aria-hidden="true" />
                      ) : (
                        <AlertCircle size={14} aria-hidden="true" />
                      )}
                      {complete ? "Data lengkap" : "Perlu dilengkapi"}
                    </span>

                    <button
                      type="button"
                      className="btn btn-ghost-danger btn-sm"
                      onClick={() => handleRemoveTrip(index)}
                      aria-label={`Hapus perjalanan ${index + 1}`}
                    >
                      <Trash2 size={16} /> Hapus
                    </button>
                  </header>

                  <dl className="trip-summary">
                    <div>
                      <dt>
                        <MapPin size={15} aria-hidden="true" /> Tujuan
                      </dt>
                      <dd>{item.destination || "-"}</dd>
                    </div>
                    <div>
                      <dt>
                        <CalendarDays size={15} aria-hidden="true" /> Tanggal
                      </dt>
                      <dd>
                        {item.startDate
                          ? `${formatDate(item.startDate)}${
                              item.endDate && item.endDate !== item.startDate
                                ? ` – ${formatDate(item.endDate)}`
                                : ""
                            }`
                          : "-"}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Clock size={15} aria-hidden="true" /> Durasi
                      </dt>
                      <dd>{duration ? `${duration} hari` : "Periksa tanggal"}</dd>
                    </div>
                  </dl>

                  {item.nameWarning && (
                    <p role="alert" className="inline-alert warn">
                      <AlertCircle size={16} aria-hidden="true" />
                      {item.nameWarning}
                    </p>
                  )}

                  <div className="form-grid cols-2">
                    <div className="field span-2">
                      <label htmlFor={`wa-emp-${item.key}`}>Karyawan</label>
                      <select
                        id={`wa-emp-${item.key}`}
                        className="input"
                        value={item.employeeId || ""}
                        onChange={(event) => {
                          const employee = employees.find(
                            (person) => person.id === event.target.value
                          );

                          updateResult(index, "employeeId", event.target.value);
                          updateResult(
                            index,
                            "employeeName",
                            employee?.name || ""
                          );
                          updateResult(
                            index,
                            "position",
                            employee?.position || ""
                          );
                          updateResult(
                            index,
                            "status",
                            employee ? "matched" : "unmatched"
                          );
                          updateResult(index, "nameWarning", "");
                        }}
                      >
                        <option value="">Pilih karyawan</option>
                        {employees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {[
                      ["destination", "Tujuan", "span-1"],
                      ["transport", "Transportasi", "span-1"],
                      ["purpose", "Maksud perjalanan", "span-2"],
                      ["startDate", "Tanggal berangkat", "span-1"],
                      ["endDate", "Tanggal kembali", "span-1"],
                    ].map(([field, label, span]) => (
                      <div key={field} className={`field ${span}`}>
                        <label htmlFor={`wa-${field}-${item.key}`}>{label}</label>
                        <input
                          id={`wa-${field}-${item.key}`}
                          className="input"
                          type={
                            field === "startDate" || field === "endDate"
                              ? "date"
                              : "text"
                          }
                          value={item[field] || ""}
                          onChange={(event) =>
                            updateResult(index, field, event.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <footer className="trip-actions">
                    <div className="action-group">
                      <span className="action-group-label">Pratinjau</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handlePreview(index)}
                        disabled={busy}
                      >
                        {item.previewLoading ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <Eye size={16} />
                        )}
                        {item.previewLoading
                          ? "Membuat pratinjau..."
                          : "Pratinjau Surat"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handlePreviewExcel(index)}
                        disabled={item.excelPreviewLoading || item.downloadLoading}
                      >
                        {item.excelPreviewLoading ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <Eye size={16} />
                        )}
                        {item.excelPreviewLoading
                          ? "Membuat pratinjau..."
                          : "Pratinjau Excel"}
                      </button>
                    </div>

                    <div className="action-group">
                      <span className="action-group-label">Unduh</span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleDownload(index)}
                        disabled={item.downloadLoading || item.previewLoading}
                      >
                        {item.downloadLoading ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <FileText size={16} />
                        )}
                        {item.downloadLoading ? "Membuat..." : "Unduh Word"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleDownloadExcel(index)}
                        disabled={item.downloadLoading || item.previewLoading}
                      >
                        {item.downloadLoading ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <FileSpreadsheet size={16} />
                        )}
                        {item.downloadLoading ? "Membuat..." : "Unduh Excel"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleDownloadWordExcelOne(index)}
                        disabled={item.downloadLoading || item.previewLoading}
                      >
                        {item.downloadLoading ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <Download size={16} />
                        )}
                        {item.downloadLoading ? "Membuat..." : "Word + Excel"}
                      </button>
                    </div>
                  </footer>

                  {item.previewUrl && (
                    <div className="preview-block">
                      <div className="preview-block-header">
                        <h4>Pratinjau SPPD {item.employeeName}</h4>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => closePreview(index, "previewUrl")}
                        >
                          <X size={16} /> Tutup
                        </button>
                      </div>
                      <p className="preview-note">
                        Pratinjau dibuat di browser dari dokumen Word yang sama dengan unduhan.
                        Tampilan bisa sedikit berbeda dari Microsoft Word (font, jarak, dan
                        pemisah halaman).
                      </p>
                      <DocxPreview
                        title={`Pratinjau SPPD ${item.employeeName}`}
                        src={item.previewUrl}
                      />
                    </div>
                  )}

                  {item.excelPreviewUrl && (
                    <div className="preview-block">
                      <div className="preview-block-header">
                        <h4>Pratinjau Excel {item.employeeName}</h4>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => closePreview(index, "excelPreviewUrl")}
                        >
                          <X size={16} /> Tutup
                        </button>
                      </div>
                      <p className="preview-note">
                        Pratinjau formulir Excel ditampilkan sebagai tabel Word (isi dan
                        perhitungan sama dengan file Excel). Tata letak cetak persis hanya
                        terlihat setelah file Excel dibuka.
                      </p>
                      <DocxPreview
                        title={`Pratinjau Excel ${item.employeeName}`}
                        src={item.excelPreviewUrl}
                      />
                    </div>
                  )}
                </article>
              );
            })}

            <button
              type="button"
              className="add-trip"
              onClick={handleAddTrip}
            >
              <Plus size={18} />
              Tambah Perjalanan
            </button>
          </section>

          <section className="card bulk-card">
            <div className="card-title">
              <h2>Unduh Semua Dokumen</h2>
              <p>
                Membuat dokumen untuk seluruh {results.length} perjalanan di
                atas sekaligus.
              </p>
            </div>

            <div className="actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleDownloadWordExcel}
                disabled={results.length === 0 || anyLoading}
              >
                {anyLoading ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <Download size={18} />
                )}
                Download Word + Excel
              </button>

              <button
                type="button"
                className="btn btn-outline"
                onClick={handleDownloadZip}
                disabled={results.length === 0 || anyLoading}
              >
                {anyLoading ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <FileArchive size={18} />
                )}
                Unduh ZIP (Word + Excel)
              </button>

              <button
                type="button"
                className="btn btn-outline"
                onClick={handleDownloadAll}
                disabled={results.length === 0 || anyLoading}
              >
                {anyLoading ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <Download size={18} />
                )}
                Unduh Semua Word ({results.length} surat)
              </button>

              <button
                type="button"
                className="btn btn-outline"
                onClick={handleDownloadAllExcel}
                disabled={results.length === 0 || anyLoading}
              >
                {anyLoading ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <Download size={18} />
                )}
                Unduh Semua Excel ({results.length} perjalanan)
              </button>

              <button
                type="button"
                className="btn btn-outline"
                onClick={handleDownloadCombined}
                disabled={results.length === 0 || anyLoading}
              >
                {anyLoading ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <Download size={18} />
                )}
                Unduh Gabungan (1 file Word: surat + formulir)
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
