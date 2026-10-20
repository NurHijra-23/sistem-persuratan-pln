import { useEffect, useState } from "react";
import { Plus, Users, Search, Pencil, Trash2, Save, X, Loader2 } from "lucide-react";
import { useFeedback } from "../components/Feedback";

const API_URL = "http://localhost:3000/api";

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [position, setPosition] = useState(
    "Tenaga Pemeliharaan ULTG Parepare"
  );
  const [aliases, setAliases] = useState("");
  const [search, setSearch] = useState("");
  const { toast, confirm } = useFeedback();

  // Pesan kesalahan dan keberhasilan ditampilkan sebagai notifikasi.
  function setError(message) {
    if (message) toast.error(message);
  }

  function setNotice(message) {
    if (message) toast.success(message);
  }
  const [loading, setLoading] = useState(false);

  // State edit dan hapus personel.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "",
    nickname: "",
    aliases: "",
    position: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  async function loadEmployees() {
    try {
      const response = await fetch(`${API_URL}/employees`);
      if (!response.ok) throw new Error("Gagal mengambil data karyawan.");
      setEmployees(await response.json());
      setError("");
    } catch {
      setError("Backend tidak dapat dihubungi. Pastikan server berjalan.");
    }
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    // Cegah simpan ganda saat permintaan masih berjalan.
    if (loading) return;

    setError("");
    setNotice("");

    if (!name.trim() || !position.trim()) {
      setError("Nama lengkap dan jabatan wajib diisi.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, nickname, aliases, position }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Gagal menyimpan karyawan.");
      }

      setName("");
      setNickname("");
      setAliases("");
      setNotice(`Personel "${result.name}" berhasil ditambahkan.`);
      await loadEmployees();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(employee) {
    setError("");
    setNotice("");
    setEditingId(employee.id);
    setEditForm({
      name: employee.name || "",
      nickname: employee.nickname || "",
      aliases: (employee.aliases || []).join(", "),
      position: employee.position || "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleSaveEdit(employee) {
    if (savingEdit) return;

    setError("");
    setNotice("");

    if (!editForm.name.trim() || !editForm.position.trim()) {
      setError("Nama lengkap dan jabatan wajib diisi.");
      return;
    }

    setSavingEdit(true);

    try {
      const response = await fetch(`${API_URL}/employees/${employee.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || "Gagal memperbarui personel.");
      }

      setEditingId(null);
      setNotice(`Data ${result.data.name} berhasil diperbarui.`);
      await loadEmployees();
    } catch (err) {
      setError(err.message || "Backend tidak dapat dihubungi.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(employee) {
    if (deletingId) return;

    const confirmed = await confirm({
      title: "Hapus personel?",
      message: `Yakin ingin menghapus personel ${employee.name}? Riwayat perjalanan yang sudah ada tidak akan dihapus.`,
      confirmLabel: "Hapus Personel",
      danger: true,
    });

    if (!confirmed) return;

    setError("");
    setNotice("");
    setDeletingId(employee.id);

    try {
      const response = await fetch(`${API_URL}/employees/${employee.id}`, {
        method: "DELETE",
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || "Gagal menghapus personel.");
      }

      if (editingId === employee.id) setEditingId(null);
      setNotice(result.message || "Personel berhasil dihapus.");
      await loadEmployees();
    } catch (err) {
      setError(err.message || "Backend tidak dapat dihubungi.");
    } finally {
      setDeletingId(null);
    }
  }

  const filteredEmployees = employees.filter((employee) =>
    `${employee.name} ${employee.nickname} ${(employee.aliases || []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <main className="page page-employees">
      <header className="page-header">
        <h1>Data Personel</h1>
        <p>Kelola identitas karyawan TAD untuk pembuatan SPPD.</p>
      </header>

      <form onSubmit={handleSubmit} className="card form-stack">
        <div className="card-title">
          <h2>Tambah Karyawan</h2>
        </div>

        <label>
          Nama lengkap *
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: MUH. ADLIM NAJIIB AMNUR"
          />
        </label>

        <label>
          Nama singkat dari WhatsApp
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Contoh: MUH ADLIM"
          />
        </label>

        <label>
          Nama lain di WhatsApp (pisahkan dengan koma)
          <input
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="Contoh: Adlim, Muh Adlim"
          />
        </label>

        <label>
          Jabatan
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            required
          />
        </label>

        <div className="actions">
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
            {loading ? "Menyimpan..." : "Tambah Personel"}
          </button>
        </div>
      </form>

      <section className="card">
        <div className="card-title">
          <h2>
            <Users size={19} aria-hidden="true" /> Daftar Karyawan
            <span className="count-badge">{employees.length}</span>
          </h2>
        </div>

        <div className="search-box">
          <Search size={18} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama karyawan..."
            aria-label="Cari nama karyawan"
          />
        </div>

        {filteredEmployees.length === 0 ? (
          <p className="muted">Belum ada karyawan yang sesuai.</p>
        ) : (
          filteredEmployees.map((employee) =>
            editingId === employee.id ? (
              <div key={employee.id} className="employee-row editing form-stack">
                <label>
                  Nama lengkap *
                  <input
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                  />
                </label>

                <label>
                  Nama singkat dari WhatsApp
                  <input
                    value={editForm.nickname}
                    onChange={(e) =>
                      setEditForm({ ...editForm, nickname: e.target.value })
                    }
                  />
                </label>

                <label>
                  Nama lain di WhatsApp (pisahkan dengan koma)
                  <input
                    value={editForm.aliases}
                    onChange={(e) =>
                      setEditForm({ ...editForm, aliases: e.target.value })
                    }
                  />
                </label>

                <label>
                  Jabatan *
                  <input
                    value={editForm.position}
                    onChange={(e) =>
                      setEditForm({ ...editForm, position: e.target.value })
                    }
                  />
                </label>

                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleSaveEdit(employee)}
                    disabled={savingEdit}
                  >
                    {savingEdit ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                    {savingEdit ? "Menyimpan..." : "Simpan Perubahan"}
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={cancelEdit}
                    disabled={savingEdit}
                  >
                    <X size={16} /> Batal
                  </button>
                </div>
              </div>
            ) : (
              <div key={employee.id} className="employee-row">
                <div className="employee-info">
                  <strong>{employee.name}</strong>
                  <p>{employee.position}</p>
                  <p className="employee-meta">
                    Nama singkat: {employee.nickname || "-"}
                    {employee.aliases?.length > 0 &&
                      ` · Nama lain: ${employee.aliases.join(", ")}`}
                  </p>
                  <p className="employee-meta">
                    Sheet Excel:{" "}
                    {employee.sheetName || "belum ada sheet pada template"}
                  </p>
                </div>

                <div className="draft-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => startEdit(employee)}
                    disabled={Boolean(deletingId)}
                  >
                    <Pencil size={15} /> Edit
                  </button>

                  <button
                    type="button"
                    className="btn btn-danger-soft btn-sm"
                    onClick={() => handleDelete(employee)}
                    disabled={Boolean(deletingId)}
                  >
                    {deletingId === employee.id ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <Trash2 size={15} />
                    )}
                    {deletingId === employee.id ? "Menghapus..." : "Hapus"}
                  </button>
                </div>
              </div>
            )
          )
        )}
      </section>
    </main>
  );
}
