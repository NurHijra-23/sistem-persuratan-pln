import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// Pratinjau dokumen Word (.docx) langsung di browser memakai pustaka docx-preview.
// Menggantikan pratinjau PDF lama yang membutuhkan LibreOffice di server.
// `src` adalah URL blob dokumen .docx yang sama dengan hasil unduhan.
export default function DocxPreview({ src, title }) {
  const bodyRef = useRef(null);
  const styleRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: "" });

  useEffect(() => {
    let cancelled = false;
    const body = bodyRef.current;

    async function render() {
      setState({ loading: true, error: "" });

      try {
        const blob = await (await fetch(src)).blob();
        const { renderAsync } = await import("docx-preview");

        if (cancelled || !body) return;

        body.innerHTML = "";

        await renderAsync(blob, body, styleRef.current, {
          className: "docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          useBase64URL: true,
        });

        if (!cancelled) setState({ loading: false, error: "" });
      } catch (error) {
        console.error("Pratinjau dokumen gagal:", error);

        if (!cancelled) {
          setState({
            loading: false,
            error: "Pratinjau tidak dapat ditampilkan. Dokumen tetap bisa diunduh dan dibuka di Word.",
          });
        }
      }
    }

    render();

    return () => {
      cancelled = true;
      if (body) body.innerHTML = "";
    };
  }, [src]);

  return (
    <div className="docx-preview-host" role="document" aria-label={title}>
      {state.loading && (
        <p className="docx-preview-status">
          <Loader2 size={16} className="spin" /> Menyiapkan pratinjau...
        </p>
      )}
      {state.error && <p className="docx-preview-status error">{state.error}</p>}
      <div ref={styleRef} />
      <div ref={bodyRef} className="docx-preview-body" />
    </div>
  );
}
