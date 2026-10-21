import { ArrowRight, Clock, ExternalLink, FileText, Plane } from "lucide-react";
import BrandMark from "../components/BrandMark";

// Alamat sistem Lembur (dikelola terpisah). Dibuka lewat tautan biasa.
const LEMBUR_URL = "https://persuratanadmin-gi.github.io/persuratan/";

export default function Dashboard({ onOpenSppd }) {
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <div className="app-brand static">
            <BrandMark size={40} />
            <span className="app-brand-text">
              <strong>Sistem Persuratan PLN</strong>
              <small>Administrasi perjalanan dinas dan lembur</small>
            </span>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-welcome">
          <span className="accent-bar" aria-hidden="true" />
          <h1>Selamat Datang di Sistem Persuratan PLN</h1>
          <p>
            Kelola kebutuhan persuratan perjalanan dinas dan lembur melalui satu
            platform yang terintegrasi.
          </p>
        </section>

        <section className="service-grid" aria-label="Pilih layanan">
          <article className="service-card">
            <div className="service-icon">
              <Plane size={26} aria-hidden="true" />
            </div>
            <span className="service-tag">SPPD</span>
            <h2>Surat Perintah Perjalanan Dinas</h2>
            <p>
              Pengelolaan data perjalanan dinas dan pembuatan dokumen SPPD.
            </p>
            <ul className="service-points">
              <li>
                <FileText size={15} aria-hidden="true" />
                Surat Word dan formulir Excel
              </li>
            </ul>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onOpenSppd}
            >
              Buka Sistem SPPD
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </article>

          <article className="service-card">
            <div className="service-icon">
              <Clock size={26} aria-hidden="true" />
            </div>
            <span className="service-tag">LEMBUR</span>
            <h2>Sistem Persuratan Lembur</h2>
            <p>Akses layanan persuratan lembur yang sudah tersedia.</p>
            <ul className="service-points">
              <li>
                <ExternalLink size={15} aria-hidden="true" />
                Dibuka di tab baru
              </li>
            </ul>
            <a
              className="btn btn-primary btn-lg"
              href={LEMBUR_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Buka Sistem Lembur
              <ExternalLink size={18} aria-hidden="true" />
            </a>
          </article>
        </section>
      </main>
    </div>
  );
}
