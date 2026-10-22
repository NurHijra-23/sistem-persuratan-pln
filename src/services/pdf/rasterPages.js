// Konversi dokumen Word (.docx) menjadi gambar halaman di browser, tanpa server/LibreOffice.
// Langkah: docx-preview merender .docx menjadi HTML per halaman (section.docx) -> setiap halaman
// diubah menjadi gambar lewat SVG <foreignObject> + canvas -> gambar dikemas menjadi PDF (pdf-lib).
// Teks pada PDF hasilnya berupa gambar resolusi tinggi (tidak dapat diseleksi/dicari).

const XHTML = "http://www.w3.org/1999/xhtml";

export const RENDER_SCALE = 2.5; // 2.5 x 96 dpi = 240 dpi
export const JPEG_QUALITY = 0.92;

const RENDER_OPTIONS = {
  className: "sppd-pdf",
  inWrapper: false, // tanpa pembungkus abu-abu: hanya halaman
  ignoreWidth: false,
  ignoreHeight: false,
  breakPages: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: false,
  renderEndnotes: false,
  useBase64URL: true, // gambar disematkan sebagai data URI agar bisa digambar ke canvas
};

function canvasToJpegBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error("Gagal membuat gambar halaman."));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

async function rasterizeSection(section, styleNodes, scale) {
  const rect = section.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);

  const holder = document.createElementNS(XHTML, "div");
  holder.setAttribute("style", `width:${width}px;height:${height}px;background:#fff;overflow:hidden;position:relative;`);

  for (const node of styleNodes) holder.appendChild(node.cloneNode(true));

  const clone = section.cloneNode(true);
  clone.style.margin = "0";
  clone.style.boxShadow = "none";
  clone.style.position = "relative";
  holder.appendChild(clone);

  const xml = new XMLSerializer().serializeToString(holder);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${xml}</foreignObject></svg>`;

  const image = new Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  try {
    await image.decode();
  } catch {
    throw new Error("Browser tidak dapat mengubah halaman dokumen menjadi gambar.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return { jpeg: await canvasToJpegBytes(canvas), width, height, exactWidth: rect.width, exactHeight: rect.height };
}

const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

// Mencari teks pada halaman; mengembalikan kotak (px, relatif terhadap halaman) atau null.
function locateText(section, needle, { last = true } = {}) {
  const target = normalize(needle);
  if (!target) return null;

  const doc = section.ownerDocument;
  const walker = doc.createTreeWalker(section, 4);
  const base = section.getBoundingClientRect();
  let found = null;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue;
    const index = text.indexOf(target);

    if (index < 0 && normalize(text) !== target) continue;

    const start = index >= 0 ? index : 0;
    const end = index >= 0 ? index + target.length : text.length;
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);

    const box = range.getBoundingClientRect();
    if (!box.width && !box.height) continue;

    found = {
      left: box.left - base.left,
      right: box.right - base.left,
      top: box.top - base.top,
      bottom: box.bottom - base.top,
    };

    if (!last) break;
  }

  return found;
}

// Merender .docx menjadi daftar halaman. Setiap halaman: { text, locate(needle), rasterize() }.
// Panggil dispose() setelah selesai agar DOM sementara dibersihkan.
export async function renderDocxPages(docxBytes, { scale = RENDER_SCALE } = {}) {
  let renderAsync;

  try {
    ({ renderAsync } = await import("docx-preview"));
  } catch {
    throw new Error("Pustaka render dokumen (docx-preview) tidak dapat dimuat.");
  }

  // Render dan ukur di dalam iframe kosong: CSS aplikasi tidak ikut memengaruhi tata letak, sehingga
  // posisi yang diukur sama persis dengan tata letak saat halaman diubah menjadi gambar.
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-30000px;top:0;width:1300px;height:1700px;border:0;visibility:hidden;";
  document.body.appendChild(frame);

  const frameDoc = frame.contentDocument;
  frameDoc.open();
  frameDoc.write('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>');
  frameDoc.close();

  const styleHost = frameDoc.createElement("div");
  const bodyHost = frameDoc.createElement("div");
  frameDoc.body.append(styleHost, bodyHost);

  const dispose = () => frame.remove();

  try {
    await renderAsync(new Blob([docxBytes]), bodyHost, styleHost, RENDER_OPTIONS);

    // Pastikan gambar (logo kop surat) sudah selesai dimuat sebelum diubah menjadi gambar halaman.
    await Promise.all(
      [...bodyHost.querySelectorAll("img")].map((img) => (img.complete ? null : img.decode().catch(() => null)))
    );

    if (frameDoc.fonts?.ready) await frameDoc.fonts.ready;

    const sections = [...bodyHost.querySelectorAll("section")];

    if (sections.length === 0) throw new Error("Dokumen tidak menghasilkan halaman.");

    const styleNodes = [...styleHost.querySelectorAll("style")];

    const pages = sections.map((section) => ({
      text: section.textContent || "",
      locate: (needle, options) => locateText(section, needle, options),
      rasterize: () => rasterizeSection(section, styleNodes, scale),
    }));

    return { pages, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
