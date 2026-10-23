// Uji mesin penghapusan latar (src/services/imageBackground.js) dengan gambar sintetis yang
// kebenaran dasarnya (area tinta vs latar) diketahui. Jalankan: npm run test:latar
import assert from "node:assert/strict";
import { analyzeImage, removeBackground } from "../src/services/imageBackground.js";

// ---- Pembuat gambar uji (deterministik) ----
let seed = 12345;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const noise = (amplitude) => (random() - 0.5) * 2 * amplitude;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function createCanvas(width, height, backgroundAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = backgroundAt(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height, coverage: new Float32Array(width * height) };
}

// Menggambar dengan cakupan anti-alias: piksel = latar*(1-c) + tinta*c. coverageAt(x,y) -> 0..1
function paint(canvas, coverageAt, ink) {
  const { data, width, height, coverage } = canvas;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = coverageAt(x, y);
      if (c <= 0) continue;
      const i = (y * width + x) * 4;
      const p = y * width + x;
      const previous = coverage[p];
      const next = 1 - (1 - previous) * (1 - c);
      coverage[p] = next;
      for (let k = 0; k < 3; k++) data[i + k] = data[i + k] * (1 - c) + ink[k] * c;
    }
  }
}

const distanceToPolyline = (x, y, points) => {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const t = clamp(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
};

const strokeCoverage = (points, width) => (x, y) => clamp(width / 2 + 0.5 - distanceToPolyline(x, y, points), 0, 1);
const ringCoverage = (cx, cy, radius, width) => (x, y) => clamp(width / 2 + 0.5 - Math.abs(Math.hypot(x - cx, y - cy) - radius), 0, 1);

function addJpegNoise(canvas, amplitude) {
  for (let i = 0; i < canvas.data.length; i += 4) {
    const n = noise(amplitude);
    for (let k = 0; k < 3; k++) canvas.data[i + k] = clamp(canvas.data[i + k] + n + noise(amplitude / 2), 0, 255);
  }
}

const signaturePoints = (w, h) => Array.from({ length: 60 }, (_, i) => [20 + (i * (w - 40)) / 59, h / 2 + Math.sin(i * 0.5) * (h * 0.3) * Math.cos(i * 0.09)]);

// ---- Metrik terhadap kebenaran dasar ----
// Menyusun ulang gambar hasil ke atas kertas putih lalu membandingkannya dengan gambar ideal (tinta saja).
function evaluate(canvas, result, { inkColor }) {
  const { width, height, coverage } = canvas;
  const out = result.image;
  assert.equal(out.width * out.height * 4, out.data.length);
  return { width, height, coverage, out, inkColor };
}

const results = [];
const record = (name, metrics) => {
  results.push({ name, ...metrics });
  console.log(`  ${name}: ${Object.entries(metrics).map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(3) : v}`).join("  ")}`);
};

// Sisa latar = piksel yang kebenaran dasarnya latar (cakupan ~0) tetapi hasil masih buram.
// Tinta hilang = piksel yang kebenaran dasarnya tinta (cakupan >= batas) tetapi hasil nyaris transparan.
function groundTruthMetrics(canvas, result, { inkThreshold, backgroundMask = null }) {
  assert.equal(result.image.width, canvas.width, "uji ini memakai trim=false");
  const { coverage, width, height } = canvas;
  const out = result.image.data;
  let bg = 0, bgLeft = 0, ink = 0, inkLost = 0, inkFaint = 0, inkFaintLost = 0, errorSum = 0;

  for (let p = 0; p < width * height; p++) {
    const alpha = out[p * 4 + 3] / 255;
    const isBackground = backgroundMask ? backgroundMask[p] === 1 && coverage[p] < 0.02 : coverage[p] < 0.02;

    if (isBackground) {
      bg += 1;
      if (alpha > 0.08) bgLeft += 1;
    }
    if (coverage[p] >= inkThreshold) {
      ink += 1;
      if (alpha < 0.8) inkLost += 1;
    } else if (coverage[p] >= 0.25) {
      inkFaint += 1;
      if (alpha < 0.1) inkFaintLost += 1;
    }
    errorSum += Math.abs(alpha - coverage[p]);
  }

  return {
    bgLeftover: bg ? bgLeft / bg : 0,
    inkLost: ink ? inkLost / ink : 0,
    thinLost: inkFaint ? inkFaintLost / inkFaint : 0,
    meanAlphaError: errorSum / (width * height),
  };
}

function colorError(canvas, result, ink, { minCoverage = 0.95, region = () => true } = {}) {
  const { coverage, width, height } = canvas;
  const out = result.image.data;
  let sum = 0, count = 0;
  for (let p = 0; p < width * height; p++) {
    if (coverage[p] < minCoverage) continue;
    if (!region(p % width, Math.floor(p / width))) continue;
    const i = p * 4;
    if (out[i + 3] < 200) continue;
    sum += Math.max(Math.abs(out[i] - ink[0]), Math.abs(out[i + 1] - ink[1]), Math.abs(out[i + 2] - ink[2]));
    count += 1;
  }
  return count ? sum / count : NaN;
}

console.log("Uji penghapusan latar");

// 1) PNG yang sudah transparan -> tidak diubah
{
  const w = 300, h = 120;
  const canvas = createCanvas(w, h, () => [255, 255, 255]);
  paint(canvas, strokeCoverage(signaturePoints(w, h), 3), [10, 40, 160]);
  for (let p = 0; p < w * h; p++) canvas.data[p * 4 + 3] = Math.round(255 * canvas.coverage[p]);
  const result = removeBackground(canvas, { trim: false });
  assert.equal(result.method, "none");
  assert.equal(result.image, canvas, "gambar transparan tidak boleh diubah");
  assert.ok(result.warnings.some((text) => /sudah memiliki latar transparan/.test(text)));
  record("PNG sudah transparan", { method: result.method, diubah: "tidak" });
}

// 2) JPG berlatar putih (kertas agak kekuningan + derau JPEG) dengan tanda tangan dan garis TIPIS
{
  const w = 420, h = 160;
  const ink = [15, 35, 150];
  const canvas = createCanvas(w, h, () => [252, 250, 246]);
  paint(canvas, strokeCoverage(signaturePoints(w, h), 3.2), ink);                         // goresan biasa
  paint(canvas, strokeCoverage([[30, 140], [390, 128]], 1.1), ink);                         // garis tipis (~1 px)
  paint(canvas, strokeCoverage([[40, 20], [380, 30]], 0.8), ink);                           // garis sangat tipis (<1 px)
  addJpegNoise(canvas, 3);
  const info = analyzeImage(canvas);
  assert.ok(info.uniform, "latar putih harus terdeteksi seragam");
  const result = removeBackground(canvas, { trim: false });
  assert.equal(result.method, "plain");
  const m = groundTruthMetrics(canvas, result, { inkThreshold: 0.9 });
  const colorDelta = colorError(canvas, result, ink);
  record("JPG putih + garis tipis", { sisaLatar: m.bgLeftover, tintaHilang: m.inkLost, garisTipisHilang: m.thinLost, errAlpha: m.meanAlphaError, selisihWarna: colorDelta, transparan: result.stats.transparentRatio });
  assert.ok(m.bgLeftover < 0.01, "sisa latar harus < 1%");
  assert.ok(m.inkLost < 0.02, "tinta pekat tidak boleh hilang");
  assert.ok(m.thinLost < 0.15, "garis tipis (cakupan >= 25%) harus sebagian besar bertahan");
  assert.ok(colorDelta < 25, "warna tinta harus tetap");
}

// 3) Stempel berwarna (cincin merah + teks + cincin dalam biru) di atas kertas putih
{
  const w = 300, h = 300;
  const red = [200, 30, 40];
  const blue = [30, 60, 170];
  const canvas = createCanvas(w, h, () => [255, 255, 255]);
  paint(canvas, ringCoverage(150, 150, 130, 5), red);
  paint(canvas, ringCoverage(150, 150, 118, 1.5), red);
  paint(canvas, ringCoverage(150, 150, 70, 3), blue);
  for (let k = 0; k < 5; k++) paint(canvas, strokeCoverage([[95, 120 + k * 16], [205, 120 + k * 16]], 2.5), red);
  addJpegNoise(canvas, 2);
  const result = removeBackground(canvas, { trim: false });
  assert.equal(result.method, "plain");
  const m = groundTruthMetrics(canvas, result, { inkThreshold: 0.9 });
  const insideAlpha = result.image.data[(150 * w + 100) * 4 + 3]; // bagian dalam cincin (tanpa tinta)
  record("Stempel berwarna", { sisaLatar: m.bgLeftover, tintaHilang: m.inkLost, garisTipisHilang: m.thinLost, selisihWarnaMerah: colorError(canvas, result, red, { minCoverage: 0.99, region: (x, y) => Math.hypot(x - 150, y - 150) > 100 }), alphaDalamCincin: insideAlpha });
  assert.ok(m.bgLeftover < 0.01);
  assert.ok(m.inkLost < 0.02);
  assert.equal(insideAlpha, 0, "bagian dalam stempel harus transparan pada metode latar polos");
}

// 4) Latar berwarna/tidak rata (gradasi krem-abu + tekstur) -> metode dari tepi
{
  const w = 360, h = 220;
  const red = [190, 25, 35];
  const ink = [20, 30, 120];
  const gradient = (x, y) => [238 - (x / w) * 95 + (y / h) * 20, 226 - (x / w) * 90 + (y / h) * 18, 196 - (x / w) * 70 + (y / h) * 20];
  const canvas = createCanvas(w, h, gradient);
  paint(canvas, ringCoverage(250, 110, 80, 4), red);
  paint(canvas, strokeCoverage(signaturePoints(w, h).map(([x, y]) => [x * 0.6 + 10, y]), 3), ink);
  addJpegNoise(canvas, 4);
  assert.equal(analyzeImage(canvas).uniform, false, "gradasi tidak boleh dianggap seragam");
  const result = removeBackground(canvas, { trim: false, tolerance: 45 });
  assert.equal(result.method, "edge");
  // Hanya latar yang tersambung ke tepi yang dihitung; bagian dalam cincin stempel sengaja dipertahankan.
  const outside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 250, y - 110) > 90) outside[y * w + x] = 1;
  const m = groundTruthMetrics(canvas, result, { inkThreshold: 0.9, backgroundMask: outside });
  record("Latar gradasi (dari tepi)", { sisaLatarLuar: m.bgLeftover, tintaHilang: m.inkLost, transparan: result.stats.transparentRatio });
  assert.ok(m.bgLeftover < 0.03, "sisa latar luar harus < 3%");
  assert.ok(m.inkLost < 0.05, "tinta tidak boleh hilang");
  assert.ok(result.warnings.some((text) => /Area tertutup/.test(text)), "keterbatasan area tertutup harus diberitahukan");

  // Dengan "hapus area tertutup", bagian dalam cincin pun ikut transparan.
  const enclosed = removeBackground(canvas, { trim: false, tolerance: 45, method: "edge", includeEnclosed: true });
  const inside = enclosed.image.data[(110 * w + 250) * 4 + 3];
  record("  + area tertutup", { alphaDalamCincin: inside });
  assert.ok(inside < 40);
}

// 5) Toleransi: makin tinggi makin banyak yang terhapus, dan garis sangat pucat hilang lebih dulu
{
  const w = 300, h = 100;
  const canvas = createCanvas(w, h, () => [255, 255, 255]);
  paint(canvas, strokeCoverage([[20, 50], [280, 50]], 2), [195, 195, 195]); // pensil pucat (jarak ~60)
  paint(canvas, strokeCoverage([[20, 80], [280, 80]], 2), [20, 20, 20]);
  const low = removeBackground(canvas, { trim: false, tolerance: 20 });
  const high = removeBackground(canvas, { trim: false, tolerance: 90 });
  const alphaAt = (result, y) => result.image.data[(y * w + 150) * 4 + 3];
  record("Toleransi", { pensilToleransi20: alphaAt(low, 50), pensilToleransi90: alphaAt(high, 50), tintaPekat90: alphaAt(high, 80) });
  assert.ok(alphaAt(low, 50) > 100, "pada toleransi rendah goresan pensil pucat bertahan");
  assert.ok(alphaAt(high, 50) < alphaAt(low, 50), "toleransi tinggi menghapus lebih banyak");
  assert.equal(alphaAt(high, 80), 255, "tinta pekat tidak pernah hilang");
}

// 6) Pangkas tepi kosong
{
  const w = 300, h = 200;
  const canvas = createCanvas(w, h, () => [255, 255, 255]);
  paint(canvas, strokeCoverage([[100, 90], [200, 110]], 4), [0, 0, 0]);
  const trimmed = removeBackground(canvas, { trim: true });
  assert.ok(trimmed.trimmed && trimmed.image.width < 130 && trimmed.image.height < 40, `pangkas gagal: ${trimmed.image.width}x${trimmed.image.height}`);
  record("Pangkas tepi", { lebar: trimmed.image.width, tinggi: trimmed.image.height });
}

// 7) Gambar tanpa latar yang bisa dihapus (foto penuh warna) -> peringatan, bukan klaim berhasil
{
  const w = 120, h = 120;
  const canvas = createCanvas(w, h, (x, y) => [(x * 2) % 256, (y * 2) % 256, ((x + y) * 3) % 256]);
  const result = removeBackground(canvas, { trim: false });
  record("Gambar penuh warna", { metode: result.method, transparan: result.stats.transparentRatio, peringatan: result.warnings.length });
  assert.ok(result.warnings.length > 0, "harus ada peringatan untuk gambar yang tidak cocok");
}

// 8) Pengubah tidak merusak gambar asli (immutability)
{
  const w = 100, h = 60;
  const canvas = createCanvas(w, h, () => [255, 255, 255]);
  paint(canvas, strokeCoverage([[10, 30], [90, 30]], 3), [0, 0, 0]);
  const before = Uint8ClampedArray.from(canvas.data);
  removeBackground(canvas, { trim: false });
  assert.deepEqual(Array.from(canvas.data), Array.from(before), "gambar asli tidak boleh berubah");
  record("Gambar asli tidak diubah", { ok: "ya" });
}

console.log(`\n${results.length} skenario lulus.`);
