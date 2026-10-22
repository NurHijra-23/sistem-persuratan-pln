// Perhitungan posisi tanda tangan/paraf. Dipakai bersama oleh pembuat PDF dan editor posisi langsung,
// sehingga yang terlihat di editor sama dengan yang tertulis di PDF.
// Semua ukuran dalam pt dengan titik nol di kiri-atas halaman.

export const MM_TO_PT = 72 / 25.4;
const GAP_PT = 2; // jarak aman antara gambar dan teks di sekitarnya

// Anchor (kotak teks) per jenis halaman:
//  letter: { manager, managerTitle, paraf, parafLine:{left,width,bottomTop} }
//  form  : { employee, employeeLabel }
// Setiap kotak: { left, right, top, bottom } (pt).

function fitHeight(slot, ratio, maxHeightPt, avoidText) {
  let width = Math.max(1, Number(slot.widthMm) || 1) * MM_TO_PT;
  let capped = false;

  if (avoidText && maxHeightPt > 4 && width * ratio > maxHeightPt) {
    width = maxHeightPt / ratio;
    capped = true;
  }

  return { width, height: width * ratio, capped };
}

// Mengembalikan { left, top, width, height, capped } atau null bila anchor tidak ditemukan.
// ratio = tinggi/lebar gambar (dipakai juga untuk kotak placeholder di editor).
export function slotRect(key, slot, layout, { avoidText = true, ratio } = {}) {
  if (!layout || !slot) return null;

  const r = Number(ratio) > 0 ? Number(ratio) : Number(slot.ratio) > 0 ? Number(slot.ratio) : 0.4;
  const offX = (Number(slot.offsetXMm) || 0) * MM_TO_PT;
  const offY = (Number(slot.offsetYMm) || 0) * MM_TO_PT;

  if (key === "manager" || key === "employee") {
    const name = key === "manager" ? layout.manager : layout.employee;
    const label = key === "manager" ? layout.managerTitle : layout.employeeLabel;

    if (!name) return null;

    // Gambar berdiri tepat di atas nama; tingginya dibatasi oleh ruang kosong di bawah teks di atasnya.
    const bottom = name.top - GAP_PT;
    const free = label ? bottom - (label.bottom + GAP_PT) : Infinity;
    const size = fitHeight(slot, r, free, avoidText);
    const cx = (name.left + name.right) / 2;

    return {
      left: cx - size.width / 2 + offX,
      top: bottom - size.height + offY,
      width: size.width,
      height: size.height,
      capped: size.capped,
    };
  }

  const index = Number(String(key).replace("paraf", "")) - 1;

  if (!(index >= 0 && index <= 2)) return null;

  const line = layout.parafLine;
  const text = layout.paraf;

  if (!line && !text) return null;

  // Slot paraf dibagi rata di atas garis paraf (di sebelah kanan kata "Paraf", tidak menutupinya).
  const cellWidth = line ? line.width / 3 : 12 * MM_TO_PT;
  const bottom = (line ? line.bottomTop : text.top) - 1.5;
  const size = fitHeight(slot, r, Infinity, false);
  let { width, height } = size;
  let capped = false;

  if (avoidText && width > cellWidth - 1) {
    width = Math.max(4, cellWidth - 1);
    height = width * r;
    capped = true;
  }

  const cx = line ? line.left + (index + 0.5) * cellWidth : text.right + (9 + index * 12.5) * MM_TO_PT;

  return { left: cx - width / 2 + offX, top: bottom - height + offY, width, height, capped };
}

export const SLOT_PAGE = { manager: "letter", paraf1: "letter", paraf2: "letter", paraf3: "letter", employee: "form" };
