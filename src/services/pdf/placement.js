// Perhitungan posisi tanda tangan/paraf. Dipakai bersama oleh pembuat PDF dan editor posisi langsung,
// sehingga yang terlihat di editor sama dengan yang tertulis di PDF.
// Semua ukuran dalam pt dengan titik nol di kiri-atas halaman.

export const MM_TO_PT = 72 / 25.4;
const GAP_PT = 2; // jarak aman antara gambar dan teks di sekitarnya

// Anchor (kotak teks) per jenis halaman:
//  letter: { manager, managerTitle, paraf, parafLine:{left,width,bottomTop}, page:{widthPt,heightPt},
//            margins:{left,right} }
//  form  : { employee, employeeLabel }
// Setiap kotak: { left, right, top, bottom } (pt).

function fitHeight(slot, ratio, maxHeightPt, avoidText) {
  let width = Math.max(1, Number(slot.widthMm) || 1) * MM_TO_PT;
  let capped = false;

  // Ukuran manual (diatur pengguna) dipakai persis; pembatasan tinggi hanya untuk ukuran otomatis.
  if (avoidText && !slot.sizeManual && maxHeightPt > 4 && width * ratio > maxHeightPt) {
    width = maxHeightPt / ratio;
    capped = true;
  }

  return { width, height: width * ratio, capped };
}


// ---- Stempel ----
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const boxOf = (rect) => ({ left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height });
const grow = (box, amount) => ({ left: box.left - amount, top: box.top - amount, right: box.right + amount, bottom: box.bottom + amount });
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function shrinkAboutCenter(rect, factor) {
  const width = rect.width * factor;
  const height = rect.height * factor;

  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

// Menjaga persegi tetap di dalam `bounds` dan tidak menimpa `obstacles` (kotak teks). Bila menimpa,
// geser ke arah terdekat yang bebas (atas/bawah/kiri/kanan); bila tidak ada ruang, kecilkan bertahap.
// Mengembalikan rect + capped=true bila posisi/ukuran harus disesuaikan.
export function confineRect(rect, { bounds, obstacles = [], gap = GAP_PT, shrink = true }) {
  let current = { ...rect };
  let changed = false;

  const scale = Math.min(1, (bounds.right - bounds.left) / current.width, (bounds.bottom - bounds.top) / current.height);

  if (scale < 1 && shrink) {
    current = shrinkAboutCenter(current, scale);
    changed = true;
  }

  const clampInside = (r) => ({
    ...r,
    left: clamp(r.left, bounds.left, Math.max(bounds.left, bounds.right - r.width)),
    top: clamp(r.top, bounds.top, Math.max(bounds.top, bounds.bottom - r.height)),
  });

  const clamped = clampInside(current);

  if (Math.abs(clamped.left - current.left) > 0.01 || Math.abs(clamped.top - current.top) > 0.01) changed = true;
  current = clamped;

  const inside = (r) => r.left >= bounds.left - 0.01 && r.top >= bounds.top - 0.01 && r.left + r.width <= bounds.right + 0.01 && r.top + r.height <= bounds.bottom + 0.01;
  const free = (r) => !obstacles.some((o) => intersects(boxOf(r), grow(o, gap)));

  for (let attempt = 0; attempt < 30; attempt++) {
    const hit = obstacles.find((o) => intersects(boxOf(current), grow(o, gap)));

    if (!hit) break;

    changed = true;

    const g = grow(hit, gap);
    const candidates = [
      { ...current, top: g.top - current.height }, // naik
      { ...current, top: g.bottom }, // turun
      { ...current, left: g.left - current.width }, // ke kiri
      { ...current, left: g.right }, // ke kanan
    ]
      .filter((candidate) => inside(candidate) && free(candidate))
      .sort((a, b) => Math.abs(a.left - current.left) + Math.abs(a.top - current.top) - (Math.abs(b.left - current.left) + Math.abs(b.top - current.top)));

    if (candidates.length) {
      current = candidates[0];
    } else if (shrink) {
      current = clampInside(shrinkAboutCenter(current, 0.92));
    } else {
      break; // ukuran manual tidak diperkecil; posisi dibiarkan sesuai pilihan pengguna
    }
  }

  return { ...current, capped: changed };
}

// Posisi stempel: berdiri di samping tanda tangan manajer (default di kiri) dengan sebagian menimpa
// tanda tangan, tinggi sejajar tanda tangan. Dengan avoidText, stempel dijaga agar tidak menimpa
// judul "MANAGER ULTG PAREPARE" maupun nama manajer, dan tetap di area tanda tangan (di antara
// margin surat dan di atas kaki surat).
function stampRect(slot, layout, { avoidText, ratio, slots }) {
  const name = layout?.manager;

  if (!name) return null;

  const title = layout.managerTitle;
  const managerSlot = slots?.manager;
  const stampRatio = Number(ratio) > 0 ? Number(ratio) : Number(slot.ratio) > 0 ? Number(slot.ratio) : 1;

  const width = Math.max(1, Number(slot.widthMm) || 1) * MM_TO_PT;
  const height = width * stampRatio;

  // Kotak tanda tangan manajer (bila slot diketahui) sebagai patokan; tanpa itu pakai perkiraan di atas nama.
  const signature = managerSlot
    ? slotRect("manager", managerSlot, layout, { avoidText, ratio: managerSlot.dataUrl ? managerSlot.ratio : 0.4 })
    : null;
  const sigLeft = signature ? signature.left : name.left - 10;
  const sigRight = signature ? signature.left + signature.width : name.right + 10;
  const sigTop = signature ? signature.top : name.top - 40;
  const sigHeight = signature ? signature.height : 40;
  const sigWidth = sigRight - sigLeft;

  // Sebagian stempel (??30%, maksimal 40% lebar tanda tangan) menimpa ujung tanda tangan.
  const overlap = Math.min(width * 0.3, sigWidth * 0.4);
  const left = slot.side === "right" ? sigRight - overlap : sigLeft + overlap - width;
  const top = sigTop + sigHeight / 2 - height / 2;

  const rect = {
    left: left + (Number(slot.offsetXMm) || 0) * MM_TO_PT,
    top: top + (Number(slot.offsetYMm) || 0) * MM_TO_PT,
    width,
    height,
  };

  const page = layout.page;
  const margins = layout.margins || { left: 0, right: 0 };

  if (!avoidText) {
    // Tanpa penjagaan teks, stempel tetap tidak boleh keluar dari halaman.
    if (!page) return { ...rect, capped: false };
    return { ...confineRect(rect, { bounds: { left: 0, top: 0, right: page.widthPt, bottom: page.heightPt }, obstacles: [], shrink: !slot.sizeManual }) };
  }

  const bounds = {
    left: margins.left,
    right: page ? page.widthPt - margins.right : name.right + 80,
    top: title ? title.bottom + GAP_PT : name.top - 90,
    bottom: layout.paraf ? layout.paraf.top - 14 : page ? page.heightPt - 40 : name.bottom + 160,
  };

  return confineRect(rect, { bounds, obstacles: [title, name].filter(Boolean), shrink: !slot.sizeManual });
}

// Mengembalikan { left, top, width, height, capped } atau null bila anchor tidak ditemukan.
// ratio = tinggi/lebar gambar (dipakai juga untuk kotak placeholder di editor).
export function slotRect(key, slot, layout, { avoidText = true, ratio, slots } = {}) {
  if (!layout || !slot) return null;

  if (key === "stamp") return stampRect(slot, layout, { avoidText, ratio, slots });

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

  // Paraf ukuran otomatis dimuat dalam selnya; ukuran manual dipakai persis.
  if (avoidText && !slot.sizeManual && width > cellWidth - 1) {
    width = Math.max(4, cellWidth - 1);
    height = width * r;
    capped = true;
  }

  const cx = line ? line.left + (index + 0.5) * cellWidth : text.right + (9 + index * 12.5) * MM_TO_PT;

  return { left: cx - width / 2 + offX, top: bottom - height + offY, width, height, capped };
}

export const SLOT_PAGE = { manager: "letter", paraf1: "letter", paraf2: "letter", paraf3: "letter", stamp: "letter", employee: "form" };
