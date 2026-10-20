
import { useEffect, useState } from "react";
import {
  RefreshCw,
  MapPin,
  CalendarDays,
  UserRound,
  Clock,
  AlertCircle,
  Trash2,
  Eye,
  Pencil,
  X,
  Save,
} from "lucide-react";

const API_URL = "http://localhost:3000/api";

const emptyForm = {
  employeeId: "",
  purpose: "",
  destination: "",
  startDate: "",
  endDate: "",
  transport: "",
};

export default function Trips() {
  const [trips, setTrips] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editMode, setEditMode] = useState(false);

  async function loadTrips() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/trips`);

      if (!response.ok) {
        throw new Error("Gagal mengambil data perjalanan.");
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error("Format data perjalanan tidak valid.");
      }

      setTrips(data);
    } catch (err) {
      setError(err.message || "Backend tidak dapat dihubungi.");
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployees() {
    try {
      const response = await fetch(`${API_URL}/employees`);

      if (!response.ok) {
        throw new Error("Gagal memuat data karyawan.");
      }

      const data = await response.json();
      setEmployees(data);
    } catch (err) {
      setError(err.message || "Gagal memuat data karyawan.");
    }
  }

  useEffect(() => {
    loadTrips();
    loadEmployees();
  }, []);

  function formatDate(date) {
    if (!date) return "-";

    return new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function openDetail(trip) {
    setSelectedTrip(trip);
    setEditMode(false);
    setError("");
    setNotice("");
  }

  function openEdit() {
    if (!selectedTrip) return;

    setEditForm({
      employeeId: selectedTrip.employeeId || "",
      purpose: selectedTrip.purpose || "",
      destination: selectedTrip.destination || "",
      startDate: selectedTrip.startDate || "",
      endDate: selectedTrip.endDate || "",
      transport: selectedTrip.transport || "",
    });

    setEditMode(true);
    setError("");
    setNotice("");
  }

  function closeDetail() {
    setSelectedTrip(null);
    setEditMode(false);
    setError("");
    setNotice("");
  }

  function updateForm(field, value) {
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleUpdate(event) {
    event.preventDefault();
    if (!selectedTrip) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (
        !editForm.employeeId ||
        !editForm.destination.trim() ||
        !editForm.purpose.trim() ||
        !editForm.startDate ||
        !editForm.endDate
      ) {
        throw new Error("Lengkapi semua data perjalanan yang wajib diisi.");
      }

      if (editForm.endDate < editForm.startDate) {
        throw new Error(
          "Tanggal kembali tidak boleh sebelum tanggal berangkat."
        );
      }

      const response = await fetch(
        `${API_URL}/trips/${encodeURIComponent(selectedTrip.id)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(editForm),
        }
      );

      const responseText = await response.text();
      let data = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          `Respons backend tidak valid. Status: ${response.status}.`
        );
      }

      if (!response.ok) {
        throw new Error(data.message || "Gagal menyimpan perubahan.");
      }

      const updatedTrip = data.data;

      setTrips((current) =>
        current.map((trip) =>
          trip.id === updatedTrip.id ? updatedTrip : trip
        )
      );

      setSelectedTrip(updatedTrip);
      setEditMode(false);
      setNotice("Perubahan perjalanan berhasil disimpan.");
    } catch (err) {
      setError(err.message || "Terjadi kesalahan saat memperbarui data.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(trip) {
    const confirmed = window.confirm(
      `Yakin ingin menghapus perjalanan ${trip.employeeName} ke ${trip.destination}?`
    );

    if (!confirmed) return;

    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API_URL}/trips/${encodeURIComponent(trip.id)}`,
        { method: "DELETE" }
      );

      const responseText = await response.text();
      let data = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error("Respons backend tidak valid.");
      }

      if (!response.ok) {
        throw new Error(data.message || "Gagal menghapus perjalanan.");
      }

      setTrips((current) =>
        current.filter((item) => item.id !== trip.id)
      );

      if (selectedTrip?.id === trip.id) {
        closeDetail();
      }

      setNotice("Perjalanan berhasil dihapus.");
    } catch (err) {
      setError(err.message || "Terjadi kesalahan saat menghapus data.");
    }
  }

  return (
    <main
      style={{
        maxWidth: 1300,
        margin: "0 auto",
        padding: 28,
        color: "#17243b",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ marginBottom: 8 }}>Daftar Perjalanan Dinas</h1>
          <p style={{ color: "#8791a4", marginTop: 0 }}>
            Kelola data perjalanan dinas TAD yang telah disimpan.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={loadTrips}
          disabled={loading}
        >
          <RefreshCw size={17} />
          {loading ? "Memuat..." : "Muat Ulang"}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ color: "#c62828", marginTop: 16 }}>
          <AlertCircle size={17} /> {error}
        </p>
      )}

      {notice && (
        <p role="status" style={{ color: "#16804a", marginTop: 16 }}>
          {notice}
        </p>
      )}

      <section
        className="content-card"
        style={{ marginTop: 24, overflowX: "auto" }}
      >
        <h2>Total Perjalanan: {trips.length}</h2>

        {loading && <p>Memuat data perjalanan...</p>}

        {!loading && !error && trips.length === 0 && (
          <p>Belum ada data perjalanan dinas yang tersimpan.</p>
        )}

        {!loading && trips.length > 0 && (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 1000,
              marginTop: 16,
            }}
          >
            <thead>
              <tr style={{ background: "#f4f7fc", textAlign: "left" }}>
                {[
                  "No.",
                  "Nama Karyawan",
                  "Tujuan",
                  "Maksud Perjalanan",
                  "Tanggal Berangkat",
                  "Tanggal Kembali",
                  "Durasi",
                  "Aksi",
                ].map((heading) => (
                  <th key={heading} style={cellStyle}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {trips.map((trip, index) => (
                <tr key={trip.id}>
                  <td style={cellStyle}>{index + 1}</td>
                  <td style={cellStyle}>
                    <UserRound size={15} /> {trip.employeeName || "-"}
                  </td>
                  <td style={cellStyle}>
                    <MapPin size={15} /> {trip.destination || "-"}
                  </td>
                  <td style={{ ...cellStyle, minWidth: 200 }}>
                    {trip.purpose || "-"}
                  </td>
                  <td style={cellStyle}>
                    <CalendarDays size={15} /> {formatDate(trip.startDate)}
                  </td>
                  <td style={cellStyle}>{formatDate(trip.endDate)}</td>
                  <td style={cellStyle}>
                    <Clock size={15} /> {trip.durationDays ?? "-"} hari
                  </td>
                  <td style={cellStyle}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => openDetail(trip)}
                        style={detailButtonStyle}
                      >
                        <Eye size={15} /> Detail
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(trip)}
                        style={deleteButtonStyle}
                      >
                        <Trash2 size={15} /> Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedTrip && (
        <div style={overlayStyle}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-title"
            className="content-card"
            style={{
              width: "100%",
              maxWidth: 650,
              maxHeight: "90vh",
              overflowY: "auto",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <h2 id="detail-title" style={{ marginTop: 0 }}>
                {editMode ? "Edit Perjalanan Dinas" : "Detail Perjalanan Dinas"}
              </h2>

              <button
                type="button"
                onClick={closeDetail}
                aria-label="Tutup detail"
                style={iconButtonStyle}
              >
                <X size={20} />
              </button>
            </div>

            {error && (
              <p role="alert" style={{ color: "#c62828" }}>
                <AlertCircle size={17} /> {error}
              </p>
            )}

            {notice && (
              <p role="status" style={{ color: "#16804a" }}>
                {notice}
              </p>
            )}

            {editMode ? (
              <form onSubmit={handleUpdate} style={{ display: "grid", gap: 14 }}>
                <label>
                  Nama Karyawan *
                  <select
                    required
                    value={editForm.employeeId}
                    onChange={(event) =>
                      updateForm("employeeId", event.target.value)
                    }
                    style={fieldStyle}
                  >
                    <option value="">Pilih karyawan</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Tujuan *
                  <input
                    required
                    value={editForm.destination}
                    onChange={(event) =>
                      updateForm("destination", event.target.value)
                    }
                    style={fieldStyle}
                  />
                </label>

                <label>
                  Maksud Perjalanan *
                  <textarea
                    required
                    value={editForm.purpose}
                    onChange={(event) =>
                      updateForm("purpose", event.target.value)
                    }
                    rows={3}
                    style={fieldStyle}
                  />
                </label>

                <label>
                  Tanggal Berangkat *
                  <input
                    required
                    type="date"
                    value={editForm.startDate}
                    onChange={(event) =>
                      updateForm("startDate", event.target.value)
                    }
                    style={fieldStyle}
                  />
                </label>

                <label>
                  Tanggal Kembali *
                  <input
                    required
                    type="date"
                    value={editForm.endDate}
                    onChange={(event) =>
                      updateForm("endDate", event.target.value)
                    }
                    style={fieldStyle}
                  />
                </label>

                <label>
                  Transportasi
                  <input
                    value={editForm.transport}
                    onChange={(event) =>
                      updateForm("transport", event.target.value)
                    }
                    style={fieldStyle}
                  />
                </label>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode(false);
                      setError("");
                      setNotice("");
                    }}
                    disabled={saving}
                    style={secondaryButtonStyle}
                  >
                    Batal
                  </button>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={saving}
                  >
                    <Save size={17} />
                    {saving ? "Menyimpan..." : "Simpan Perubahan"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                {[
                  ["Nama Karyawan", selectedTrip.employeeName],
                  ["Tujuan", selectedTrip.destination],
                  ["Maksud Perjalanan", selectedTrip.purpose],
                  ["Tanggal Berangkat", formatDate(selectedTrip.startDate)],
                  ["Tanggal Kembali", formatDate(selectedTrip.endDate)],
                  ["Durasi", `${selectedTrip.durationDays ?? "-"} hari`],
                  ["Transportasi", selectedTrip.transport || "-"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      padding: "12px 0",
                      borderBottom: "1px solid #edf0f5",
                    }}
                  >
                    <div style={{ color: "#8791a4", fontSize: 13 }}>
                      {label}
                    </div>
                    <div style={{ marginTop: 5, overflowWrap: "anywhere" }}>
                      {value || "-"}
                    </div>
                  </div>
                ))}

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    marginTop: 20,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={openEdit}
                    className="primary-button"
                  >
                    <Pencil size={17} /> Edit Perjalanan
                  </button>

                  <button
                    type="button"
                    onClick={closeDetail}
                    style={secondaryButtonStyle}
                  >
                    Tutup
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

const cellStyle = {
  padding: 12,
  borderBottom: "1px solid #edf0f5",
  verticalAlign: "top",
};

const fieldStyle = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: 6,
  padding: 11,
  border: "1px solid #dce2ed",
  borderRadius: 8,
  font: "inherit",
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(15, 23, 42, 0.55)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: 16,
};

const detailButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  background: "#dbeafe",
  color: "#1d4ed8",
  cursor: "pointer",
};

const deleteButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  background: "#fee2e2",
  color: "#b91c1c",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: "1px solid #dce2ed",
  borderRadius: 8,
  padding: "10px 14px",
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
};

const iconButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  borderRadius: 8,
  padding: 8,
  background: "#f1f5f9",
  color: "#334155",
  cursor: "pointer",
};
