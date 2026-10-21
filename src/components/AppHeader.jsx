import {
  ClipboardPaste,
  Database,
  LayoutDashboard,
  Route,
  Users,
} from "lucide-react";
import BrandMark from "./BrandMark";

// Halaman Data Perjalanan sudah ada (pages/Trips.jsx) tetapi tidak tersambung ke
// navigasi sebelumnya. Ubah menjadi true di App.jsx bila ingin menampilkannya.
export function buildNavItems(showTrips) {
  return [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "input", label: "Input SPPD", icon: ClipboardPaste },
    ...(showTrips
      ? [{ id: "trips", label: "Data Perjalanan", icon: Route }]
      : []),
    { id: "employees", label: "Data Personel", icon: Users },
    { id: "backup", label: "Cadangan", icon: Database },
  ];
}

export default function AppHeader({ activePage, onNavigate, showTrips = false }) {
  const items = buildNavItems(showTrips);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <button
          type="button"
          className="app-brand"
          onClick={() => onNavigate("dashboard")}
          aria-label="Kembali ke Dashboard"
        >
          <BrandMark size={36} />
          <span className="app-brand-text">
            <strong>Sistem Persuratan PLN</strong>
            <small>Layanan SPPD</small>
          </span>
        </button>

        <nav className="app-nav" aria-label="Navigasi layanan SPPD">
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`app-nav-item ${activePage === id ? "active" : ""}`}
              aria-current={activePage === id ? "page" : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
