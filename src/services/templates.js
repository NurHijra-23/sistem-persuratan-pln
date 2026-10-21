// Pemuat template dokumen. Template disimpan sebagai aset statis di public/templates
// dan diambil lewat fetch; hasilnya di-cache agar tidak diunduh berulang.
// Nama file template sengaja tidak diubah (termasuk spasi pada nama file Excel).

const cache = new Map();
let customLoader = null;

// Dipakai pengujian (Node) untuk membaca template dari disk.
export function setTemplateLoader(loader) {
  customLoader = loader;
  cache.clear();
}

export async function loadTemplate(name) {
  if (cache.has(name)) return cache.get(name);

  let bytes;

  if (customLoader) {
    bytes = await customLoader(name);
  } else {
    const base = import.meta.env?.BASE_URL || "/";
    const response = await fetch(`${base}templates/${encodeURIComponent(name)}`);

    if (!response.ok) {
      throw new Error(`Template "${name}" tidak dapat dimuat (status ${response.status}).`);
    }

    bytes = new Uint8Array(await response.arrayBuffer());
  }

  cache.set(name, bytes);
  return bytes;
}
