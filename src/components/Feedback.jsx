import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

/*
 * Penyedia notifikasi (toast) dan dialog konfirmasi yang konsisten dengan UI.
 * Menggantikan window.confirm bawaan browser. Tidak mengubah logika proses apa pun:
 * halaman hanya memanggil toast.success / toast.error / await confirm(...).
 */

const FeedbackContext = createContext(null);

const TOAST_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const TOAST_DURATION = {
  success: 4000,
  info: 4000,
  error: 8000,
};

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const idRef = useRef(0);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (type, message) => {
      if (!message) return;
      const id = ++idRef.current;

      // Batasi jumlah toast agar layar tidak penuh.
      setToasts((current) => [...current.slice(-3), { id, type, message }]);

      const timer = window.setTimeout(() => dismiss(id), TOAST_DURATION[type]);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push]
  );

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        setDialog({ ...options, resolve });
      }),
    []
  );

  function closeDialog(result) {
    if (!dialog) return;
    dialog.resolve(result);
    setDialog(null);
  }

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => {
          const Icon = TOAST_ICONS[item.type];
          return (
            <div
              key={item.id}
              className={`toast toast-${item.type}`}
              role={item.type === "error" ? "alert" : "status"}
            >
              <Icon size={20} className="toast-icon" aria-hidden="true" />
              <p>{item.message}</p>
              <button
                type="button"
                className="toast-close"
                onClick={() => dismiss(item.id)}
                aria-label="Tutup notifikasi"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>

      {dialog && <ConfirmDialog dialog={dialog} onClose={closeDialog} />}
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({ dialog, onClose }) {
  const cancelRef = useRef(null);
  const {
    title = "Konfirmasi",
    message,
    confirmLabel = "Ya, lanjutkan",
    cancelLabel = "Batal",
    danger = false,
  } = dialog;

  useEffect(() => {
    cancelRef.current?.focus();

    function handleKey(event) {
      if (event.key === "Escape") onClose(false);
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose(false);
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
      >
        <div className={`dialog-icon ${danger ? "danger" : ""}`}>
          <AlertTriangle size={22} aria-hidden="true" />
        </div>
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-secondary"
            onClick={() => onClose(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => onClose(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback harus dipakai di dalam FeedbackProvider.");
  }
  return context;
}
