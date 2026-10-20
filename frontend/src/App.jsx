import { useCallback, useEffect, useState } from "react";
import WhatsAppInput from "./pages/WhatsAppInput";
import Employees from "./pages/Employees";
import Trips from "./pages/Trips";
import Dashboard from "./pages/Dashboard";
import AppHeader from "./components/AppHeader";
import Footer from "./components/Footer";
import { FeedbackProvider } from "./components/Feedback";

// Halaman Data Perjalanan (Trips.jsx) tidak ada di navigasi sebelumnya.
// Ubah ke true bila ingin menampilkannya kembali.
const SHOW_TRIPS_PAGE = false;

const PAGES = ["dashboard", "input", "employees", "trips"];

// Alamat halaman memakai hash (#/input, dst.) agar tombol Kembali browser berfungsi.
// Tanpa hash, aplikasi selalu membuka Dashboard.
function readPageFromHash() {
  const page = window.location.hash.replace(/^#\/?/, "");
  if (page === "trips" && !SHOW_TRIPS_PAGE) return "dashboard";
  return PAGES.includes(page) ? page : "dashboard";
}

export default function App() {
  const [activePage, setActivePage] = useState(readPageFromHash);
  // Halaman Input SPPD tetap terpasang setelah dibuka agar data yang belum disimpan
  // tidak hilang ketika pengguna berpindah ke halaman lain.
  const [inputOpened, setInputOpened] = useState(
    () => readPageFromHash() === "input"
  );

  useEffect(() => {
    function handleHashChange() {
      const page = readPageFromHash();
      if (page === "input") setInputOpened(true);
      setActivePage(page);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = useCallback((page) => {
    if (page === "input") setInputOpened(true);
    setActivePage(page);
    window.location.hash = page === "dashboard" ? "" : `/${page}`;
    window.scrollTo({ top: 0 });
  }, []);

  const isDashboard = activePage === "dashboard";

  return (
    <FeedbackProvider>
      <div className="app-shell">
        {isDashboard ? (
          <Dashboard onOpenSppd={() => navigate("input")} />
        ) : (
          <>
            <AppHeader
              activePage={activePage}
              onNavigate={navigate}
              showTrips={SHOW_TRIPS_PAGE}
            />

            <div className="app-content">
              {activePage === "employees" && <Employees />}

              {activePage === "trips" && SHOW_TRIPS_PAGE && <Trips />}

              {inputOpened && (
                <div hidden={activePage !== "input"}>
                  <WhatsAppInput active={activePage === "input"} />
                </div>
              )}
            </div>
          </>
        )}

        <Footer />
      </div>
    </FeedbackProvider>
  );
}
