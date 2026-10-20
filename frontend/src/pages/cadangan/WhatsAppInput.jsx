
import { useEffect, useState } from "react";
import {
  ClipboardPaste,
  FileCheck,
  AlertCircle,
  Eye,
  Download,
  RotateCcw,
} from "lucide-react";
import { parseWhatsAppMessages } from "../utils/whatsappParser";

const API_URL = "http://localhost:3000/api";

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

export default function WhatsAppInput() {
  const [message, setMessage] = useState("");
  const [employees, setEmployees] = useState([]);
  const [results, setResults] = useState([]);
  const [letterDate, setLetterDate] = useState("");
  const [recipient, setRecipient] = useState(
    "Manager PLN Tarakan Regional Sulawesi 2"
  );
  const [managerName, setManagerName] = useState("SAMSU ALAM");
  const [error, setError] = useState("");
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/employees`)
      .then((response) => {
        if (!response.ok) throw new Error("Gagal memuat karyawan.");
        return response.json();
      })
      .then(setEmployees)
      .catch(() => setError("Backend tidak dapat dihubungi."))
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

      const response = await fetch(`${API_URL}/sppd/preview`, {
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
      setError(err.message || "Backend tidak dapat dihubungi.");
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

      const response = await fetch(`${API_URL}/sppd/generate`, {
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
    } catch (err) {
      setError(err.message || "Backend tidak dapat dihubungi.");
    } finally {
      updateResult(index, "downloadLoading", false);
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
        position: item.position || "",
      };

      const response = await fetch(`${API_URL}/sppd-excel/generate`, {
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
    } catch (err) {
      setError(err.message || "Backend tidak dapat dihubungi.");
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
      position: item.position || "",
    });
  }

  setResults((current) =>
    current.map((item) => ({ ...item, downloadLoading: true }))
  );

  try {
    // Minta satu workbook untuk setiap karyawan.
    for (const group of groups.values()) {
      const response = await fetch(
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
  } catch (err) {
    setError(err.message || "Backend tidak dapat dihubungi.");
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

    const response = await fetch(`${API_URL}/sppd/generate`, {
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
  } catch (err) {
    setError(err.message || "Backend tidak dapat dihubungi.");
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
        position: item.position || "",
      }));

      const response = await fetch(`${API_URL}/sppd-gabungan/generate`, {
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
    } catch (err) {
      setError(err.message || "Backend tidak dapat dihubungi.");
    } finally {
      setResults((current) =>
        current.map((item) => ({ ...item, downloadLoading: false }))
      );
    }
  }

  function resetResults() {
    results.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setResults([]);
    setMessage("");
    setError("");
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 28 }}>
      <h1>Input SPPD dari WhatsApp</h1>
      <p style={{ color: "#8791a4" }}>
        Tempel pesan WhatsApp, periksa hasil pembacaan, lalu buat surat
        SPPD masing-masing karyawan tanpa menyimpan perjalanan terlebih dahulu.
      </p>

      <section className="content-card" style={{ marginTop: 24 }}>
        <h2>
          <ClipboardPaste size={20} /> Pesan WhatsApp
        </h2>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={`MUH ADLIM
Nama Kota atau Desa Tujuan: Parepare - Polmas
Maksud SPPD: Pengawasan pelepasan kabel ADSS
Estimasi: 3 hari
Tanggal: 2 - 4 September 2026`}
          rows={10}
          style={{
            width: "100%",
            padding: 14,
            border: "1px solid #dce2ed",
            borderRadius: 10,
            resize: "vertical",
            font: "inherit",
            marginTop: 12,
          }}
        />

        <button
          type="button"
          className="primary-button"
          onClick={handleParse}
          disabled={loadingEmployees}
          style={{ marginTop: 14 }}
        >
          <FileCheck size={18} />
          {loadingEmployees ? "Memuat data karyawan..." : "Baca Pesan"}
        </button>
      </section>

      {error && (
        <p role="alert" style={{ color: "#c62828", marginTop: 16 }}>
          <AlertCircle size={17} /> {error}
        </p>
      )}

      {results.length > 0 && (
        <>
          <section className="content-card" style={{ marginTop: 24 }}>
            <h2>Informasi Surat</h2>

            <label style={{ display: "block", marginTop: 12 }}>
              Tanggal surat
              <input
                type="date"
                value={letterDate}
                onChange={(event) => setLetterDate(event.target.value)}
                style={{ display: "block", width: "100%", padding: 10 }}
              />
            </label>

            <label style={{ display: "block", marginTop: 12 }}>
              Penerima surat
              <input
                type="text"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                style={{ display: "block", width: "100%", padding: 10 }}
              />
            </label>

            <label style={{ display: "block", marginTop: 12 }}>
              Nama manajer
              <input
                type="text"
                value={managerName}
                onChange={(event) => setManagerName(event.target.value)}
                style={{ display: "block", width: "100%", padding: 10 }}
              />
            </label>
          </section>

          <section className="content-card" style={{ marginTop: 24 }}>
            <h2>Surat SPPD Individual ({results.length})</h2>
            <p style={{ color: "#8791a4" }}>
              Setiap kartu menghasilkan satu file SPPD untuk satu perjalanan.
              Periksa datanya sebelum mengunduh.
            </p>

            {results.map((item, index) => {
              const duration =
                item.startDate &&
                item.endDate &&
                item.endDate >= item.startDate
                  ? Math.round(
                      (
                        new Date(`${item.endDate}T00:00:00`) -
                        new Date(`${item.startDate}T00:00:00`)
                      ) / 86400000
                    ) + 1
                  : null;

              return (
                <article
                  key={item.key}
                  style={{
                    border: "1px solid #e1e6ef",
                    borderRadius: 12,
                    padding: 18,
                    marginTop: 16,
                    display: "grid",
                    gap: 12,
                  }}
                >
                  <h3 style={{ margin: 0 }}>
                    SPPD {index + 1}: {item.employeeName || "Karyawan belum dipilih"}
                  </h3>

                  <label>
                    Karyawan
                    <select
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
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: 10,
                      }}
                    >
                      <option value="">Pilih karyawan</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {[
                    ["destination", "Tujuan"],
                    ["purpose", "Maksud perjalanan"],
                    ["startDate", "Tanggal berangkat"],
                    ["endDate", "Tanggal kembali"],
                    ["transport", "Transportasi"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        type={
                          field === "startDate" || field === "endDate"
                            ? "date"
                            : "text"
                        }
                        value={item[field] || ""}
                        onChange={(event) =>
                          updateResult(index, field, event.target.value)
                        }
                        style={{
                          display: "block",
                          width: "100%",
                          padding: 10,
                        }}
                      />
                    </label>
                  ))}

                  <small style={{ color: "#8791a4" }}>
                    Durasi perjalanan: {duration ? `${duration} hari` : "Periksa tanggal"}
                  </small>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => handlePreview(index)}
                      disabled={item.previewLoading || item.downloadLoading}
                    >
                      <Eye size={17} />
                      {item.previewLoading
                        ? "Membuat pratinjau..."
                        : "Pratinjau Surat"}
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => handleDownload(index)}
                      disabled={item.downloadLoading || item.previewLoading}
                    >
                      <Download size={17} />
                      {item.downloadLoading
                        ? "Membuat Word..."
                        : "Unduh Word"}
                    </button>

                    
<button
  type="button"
  className="primary-button"
  onClick={() => handleDownloadExcel(index)}
  disabled={item.downloadLoading || item.previewLoading}
>
  <Download size={17} />
  {item.downloadLoading ? "Membuat Excel..." : "Unduh Excel"}
</button>

                  </div>

                  {item.previewUrl && (
                    <div style={{ marginTop: 8 }}>
                      <h4>Pratinjau SPPD {item.employeeName}</h4>
                      <iframe
                        title={`Pratinjau SPPD ${item.employeeName}`}
                        src={item.previewUrl}
                        style={{
                          width: "100%",
                          height: 650,
                          border: "1px solid #dce2ed",
                          borderRadius: 8,
                        }}
                      />
                    </div>
                  )}
                </article>
              );
            })}

            
<button
  type="button"
  className="primary-button"
  onClick={handleDownloadAll}
  disabled={results.length === 0}
  style={{ marginTop: 20 }}
>
  <Download size={18} />
  Unduh Semua SPPD ({results.length} surat)
</button>


<button
  type="button"
  className="primary-button"
  onClick={handleDownloadAllExcel}
  disabled={results.length === 0 || results.some((item) => item.downloadLoading)}
  style={{ marginTop: 12 }}
>
  <Download size={18} />
  Unduh Semua Excel ({results.length} perjalanan)
</button>

<button
  type="button"
  className="primary-button"
  onClick={handleDownloadCombined}
  disabled={results.length === 0 || results.some((item) => item.downloadLoading)}
  style={{ marginTop: 12 }}
>
  <Download size={18} />
  Unduh Gabungan Word + Excel ({results.length} perjalanan)
</button>



            <button
              type="button"
              className="primary-button"
              onClick={resetResults}
              style={{ marginTop: 20 }}
            >
              <RotateCcw size={17} />
              Mulai Input Baru
            </button>
          </section>
        </>
      )}
    </main>
  );
}
