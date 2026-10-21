import { useState } from "react";
import { Zap } from "lucide-react";

/*
 * Identitas visual berbasis teks. Jika file logo resmi diletakkan di
 * public/logo-pln.png, logo tersebut otomatis dipakai; jika tidak ada,
 * tampil ikon sederhana (bukan tiruan logo PLN).
 */
export default function BrandMark({ size = 40 }) {
  const [hasLogo, setHasLogo] = useState(true);

  if (hasLogo) {
    return (
      <img
        src="/logo-pln.png"
        alt="Logo PLN"
        height={size}
        style={{ height: size, width: "auto", display: "block" }}
        onError={() => setHasLogo(false)}
      />
    );
  }

  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Zap size={Math.round(size * 0.55)} strokeWidth={2.4} />
    </span>
  );
}
