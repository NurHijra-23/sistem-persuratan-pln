// Penghapusan latar belakang gambar tanda tangan, paraf, dan stempel.
//
// Modul ini murni piksel (tanpa DOM) sehingga dapat diuji di Node maupun dipakai di browser.
// Semua gambar berformat RGBA: { data: Uint8ClampedArray, width, height }.
//
// Dua metode:
//  - "plain"  : latar polos/seragam (kertas putih, scan, foto di kertas). Semua piksel yang warnanya
//               dekat dengan warna latar dijadikan transparan, termasuk bagian tertutup (mis. bagian
//               dalam lingkaran stempel). Piksel tepi (anti-alias) dihitung ulang: warna tinta
//               dipulihkan dan hanya transparansinya yang diatur, sehingga garis tipis tidak
//               menjadi abu-abu atau bergerigi.
//  - "edge"   : latar berwarna/tidak rata. Warna latar dipelajari dari tepi gambar (k-means kecil),
//               lalu hanya area latar yang tersambung ke tepi yang dihapus. Area tertutup di dalam
//               gambar dipertahankan kecuali "includeEnclosed" dinyalakan.
//
// Penghapusan latar tidak dapat dijamin sempurna untuk semua gambar (latar bergradasi kuat, tekstur,
// tanda tangan yang warnanya mirip latar). Karena itu hasil selalu disertai statistik dan peringatan,
// dan pengguna dapat memakai gambar asli.

export const DEFAULT_TOLERANCE = 30;
export const METHODS = ["auto", "plain", "edge", "none"];

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

function chebyshev(r1, g1, b1, r2, g2, b2) {
  const dr = r1 > r2 ? r1 - r2 : r2 - r1;
  const dg = g1 > g2 ? g1 - g2 : g2 - g1;
  const db = b1 > b2 ? b1 - b2 : b2 - b1;
  return dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
}

function median(values) {
  if (values.length === 0) return 255;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

// Piksel buram di sepanjang tepi gambar (ring 2 px). Hanya piksel yang cukup tidak transparan.
function borderSamples(image) {
  const { data, width, height } = image;
  const ring = Math.max(1, Math.min(2, (Math.min(width, height) >> 1) - 1));
  const samples = [];

  const take = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] >= 128) samples.push([data[i], data[i + 1], data[i + 2]]);
  };

  for (let y = 0; y < height; y++) {
    const edgeRow = y < ring || y >= height - ring;

    if (edgeRow) {
      for (let x = 0; x < width; x++) take(x, y);
    } else {
      for (let x = 0; x < ring; x++) take(x, y);
      for (let x = width - ring; x < width; x++) take(x, y);
    }
  }

  return samples;
}

// Ringkasan gambar: apakah sudah transparan, warna latar, dan seberapa seragam latarnya.
export function analyzeImage(image) {
  const { data, width, height } = image;
  const total = width * height;
  let translucent = 0;

  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) translucent += 1;

  const transparentRatio = translucent / total;
  const samples = borderSamples(image);
  const bg = [0, 1, 2].map((channel) => median(samples.map((sample) => sample[channel])));
  let near = 0;

  for (const [r, g, b] of samples) if (chebyshev(r, g, b, bg[0], bg[1], bg[2]) <= 28) near += 1;

  const uniformRatio = samples.length ? near / samples.length : 0;

  return {
    hasAlpha: transparentRatio > 0.02,
    transparentRatio,
    bg,
    uniformRatio,
    uniform: uniformRatio >= 0.85,
  };
}

// k-means kecil pada warna tepi untuk mempelajari beberapa warna latar (mis. gradasi atau bayangan).
function learnPalette(samples, k = 3) {
  if (samples.length === 0) return [[255, 255, 255]];

  // Subsampel merata agar cepat dan deterministik.
  const step = Math.max(1, Math.floor(samples.length / 1500));
  const points = samples.filter((_, index) => index % step === 0);
  const luminance = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  const sorted = [...points].sort((a, b) => luminance(a) - luminance(b));
  let centers = Array.from({ length: Math.min(k, sorted.length) }, (_, index) => [
    ...sorted[Math.floor(((index + 0.5) * sorted.length) / Math.min(k, sorted.length))],
  ]);

  for (let iteration = 0; iteration < 8; iteration++) {
    const sums = centers.map(() => [0, 0, 0, 0]);

    for (const p of points) {
      let best = 0;
      let bestDistance = Infinity;

      centers.forEach((c, index) => {
        const distance = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });

      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      sums[best][3] += 1;
    }

    centers = centers.map((c, index) =>
      sums[index][3] ? [sums[index][0] / sums[index][3], sums[index][1] / sums[index][3], sums[index][2] / sums[index][3]] : c
    );
  }

  return centers;
}

// Jarak terkecil piksel ke palet latar beserta warna latar terdekatnya.
function nearestBackground(r, g, b, palette) {
  let best = 0;
  let bestDistance = 1000;

  for (let index = 0; index < palette.length; index++) {
    const c = palette[index];
    const distance = chebyshev(r, g, b, c[0], c[1], c[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }

  return { distance: bestDistance, color: palette[best] };
}

// Peta jarak setiap piksel ke latar terdekat, serta nilai maksimumnya di lingkungan (2 px).
// Nilai maksimum lokal = "kontras tinta" di sekitar piksel itu. Memakai kontras lokal (bukan satu
// angka untuk seluruh gambar) membuat inti goresan selalu buram penuh walaupun latarnya bergradasi,
// sementara tepi anti-alias dihitung proporsional terhadap tinta di dekatnya.
function distanceMaps(data, width, height, palette) {
  const total = width * height;
  const distance = new Uint8Array(total);
  const nearest = new Uint8Array(total);

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (data[i + 3] < 8) continue; // piksel sudah transparan tidak dihitung
    const best = nearestBackground(data[i], data[i + 1], data[i + 2], palette);
    distance[p] = best.distance;
    nearest[p] = palette.indexOf(best.color);
  }

  const horizontal = new Uint8Array(total);
  const local = new Uint8Array(total);
  const radius = 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++) {
        const value = distance[y * width + k];
        if (value > max) max = value;
      }
      horizontal[y * width + x] = max;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k++) {
        const value = horizontal[k * width + x];
        if (value > max) max = value;
      }
      local[y * width + x] = max;
    }
  }

  return { distance, nearest, local };
}

// Hitung ulang satu piksel yang bercampur dengan latar: transparansi proporsional terhadap jaraknya
// dari latar (dibandingkan dengan tinta terdekat), dan warna tinta dipulihkan agar tepi tidak
// memudar menjadi abu-abu atau berhalo. `reference` = kontras tinta lokal.
function unmixPixel(data, i, distance, reference, bgColor, low) {
  const top = Math.max(reference, low + 20);
  const alpha = clamp((distance - low) / (top - low), 0, 1);

  if (alpha <= 0.02) {
    data[i + 3] = 0;
    return;
  }

  const coverage = clamp(distance / Math.max(reference, 1), 0.2, 1);

  for (let channel = 0; channel < 3; channel++) {
    data[i + channel] = clamp(Math.round(bgColor[channel] + (data[i + channel] - bgColor[channel]) / coverage), 0, 255);
  }

  data[i + 3] = Math.round(data[i + 3] * alpha);
}

function applyPlain(data, width, height, palette, tolerance) {
  const low = clamp(tolerance, 4, 140);
  const { distance, nearest, local } = distanceMaps(data, width, height, palette);

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (data[i + 3] === 0) continue;

    if (distance[p] <= low) {
      data[i + 3] = 0;
    } else if (distance[p] < local[p]) {
      unmixPixel(data, i, distance[p], local[p], palette[nearest[p]], low);
    }
    // distance === local: inti tinta, tetap buram penuh dengan warna aslinya.
  }
}

function applyEdge(data, width, height, palette, tolerance, includeEnclosed) {
  const total = width * height;
  const tol = clamp(tolerance, 4, 140);
  const bgLike = new Uint8Array(total);

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (data[i + 3] < 8) {
      bgLike[p] = 1; // sudah transparan
    } else if (nearestBackground(data[i], data[i + 1], data[i + 2], palette).distance <= tol) {
      bgLike[p] = 1;
    }
  }

  const background = new Uint8Array(total);

  if (includeEnclosed) {
    background.set(bgLike);
  } else {
    // Isi banjir dari seluruh tepi gambar (tetangga 4 arah).
    const stack = [];
    const seed = (x, y) => {
      const p = y * width + x;
      if (bgLike[p] && !background[p]) {
        background[p] = 1;
        stack.push(p);
      }
    };

    for (let x = 0; x < width; x++) {
      seed(x, 0);
      seed(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      seed(0, y);
      seed(width - 1, y);
    }

    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p - x) / width;

      if (x > 0) seed(x - 1, y);
      if (x < width - 1) seed(x + 1, y);
      if (y > 0) seed(x, y - 1);
      if (y < height - 1) seed(x, y + 1);
    }
  }

  const low = tol * 0.5;
  const { distance, nearest, local } = distanceMaps(data, width, height, palette);
  const result = new Uint8ClampedArray(data);

  for (let p = 0; p < total; p++) {
    const i = p * 4;

    if (background[p]) {
      result[i + 3] = 0;
      continue;
    }

    // Piksel pinggir objek (bertetangga dengan latar): hitung ulang agar tepi halus tanpa halo.
    const x = p % width;
    const y = (p - x) / width;
    let edge = false;

    for (let dy = -1; dy <= 1 && !edge; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && background[ny * width + nx]) {
          edge = true;
          break;
        }
      }
    }

    if (edge && distance[p] < local[p]) {
      unmixPixel(result, i, distance[p], local[p], palette[nearest[p]], low);
    }
  }

  data.set(result);
}

function trimTransparent(image, padding = 2) {
  const { data, width, height } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return { image, trimmed: false };

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const newWidth = maxX - minX + 1;
  const newHeight = maxY - minY + 1;

  if (newWidth === width && newHeight === height) return { image, trimmed: false };

  const cropped = new Uint8ClampedArray(newWidth * newHeight * 4);

  for (let y = 0; y < newHeight; y++) {
    const from = ((minY + y) * width + minX) * 4;
    cropped.set(data.subarray(from, from + newWidth * 4), y * newWidth * 4);
  }

  return { image: { data: cropped, width: newWidth, height: newHeight }, trimmed: true };
}

// Statistik kualitas hasil terhadap gambar asli.
// "Inti tinta" = piksel yang jelas berbeda dari latar (jarak >= 60) dan hampir sekuat piksel tertinggi
// di sekitarnya (>= 90%). Piksel tepi anti-alias sengaja semi-transparan, jadi tidak dihitung sebagai
// kehilangan. Inti tinta yang menjadi transparan berarti tinta ikut terhapus (mis. toleransi terlalu tinggi).
function measure(original, output, palette) {
  const total = original.width * original.height;
  const { distance, local } = distanceMaps(original.data, original.width, original.height, palette);
  let transparent = 0;
  let core = 0;
  let kept = 0;

  for (let p = 0; p < total; p++) {
    if (output.data[p * 4 + 3] < 16) transparent += 1;

    if (original.data[p * 4 + 3] < 128) continue;

    if (distance[p] >= 60 && distance[p] >= local[p] * 0.9) {
      core += 1;
      if (output.data[p * 4 + 3] >= 204) kept += 1;
    }
  }

  return { transparentRatio: transparent / total, inkRetention: core ? kept / core : null, strongInkPixels: core };
}

/**
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {{method?:"auto"|"plain"|"edge"|"none", tolerance?:number, includeEnclosed?:boolean, trim?:boolean}} options
 * @returns {{ image, method, info, stats, warnings, trimmed }}
 */
export function removeBackground(image, options = {}) {
  const { method = "auto", tolerance = DEFAULT_TOLERANCE, includeEnclosed = false, trim = true } = options;
  const info = analyzeImage(image);
  const warnings = [];

  let used = method;

  if (method === "auto") used = info.hasAlpha ? "none" : info.uniform ? "plain" : "edge";

  if (used === "none") {
    if (info.hasAlpha) warnings.push("Gambar ini sudah memiliki latar transparan; penghapusan latar tidak diperlukan.");

    return {
      image,
      method: "none",
      info,
      stats: { transparentRatio: info.transparentRatio, inkRetention: null, strongInkPixels: 0 },
      warnings,
      trimmed: false,
    };
  }

  const work = { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
  const samples = borderSamples(image);
  const palette = used === "plain" && !includeEnclosed ? [info.bg] : learnPalette(samples);

  if (used === "plain") {
    applyPlain(work.data, work.width, work.height, palette, tolerance);
  } else {
    applyEdge(work.data, work.width, work.height, palette, tolerance, includeEnclosed);
  }

  const stats = measure(image, work, used === "plain" ? [info.bg] : palette);

  if (stats.transparentRatio > 0.97) {
    warnings.push("Hampir seluruh gambar terhapus. Turunkan toleransi, ganti metode, atau pakai gambar asli.");
  } else if (stats.transparentRatio < 0.02) {
    warnings.push("Latar hampir tidak terhapus. Naikkan toleransi atau coba metode lain.");
  }

  if (stats.inkRetention !== null && stats.inkRetention < 0.92) {
    warnings.push(
      `Hanya ${(stats.inkRetention * 100).toFixed(0)}% bagian tinta/gambar yang jelas yang tetap utuh. Garis tipis mungkin ikut terhapus; turunkan toleransi.`
    );
  }

  if (used === "plain" && !info.uniform) {
    warnings.push("Latar tidak seragam; metode latar polos dapat meninggalkan sisa latar. Coba metode latar kompleks.");
  }

  if (used === "edge" && !includeEnclosed) {
    warnings.push("Area tertutup di dalam gambar (mis. bagian dalam lingkaran stempel) tidak dihapus pada metode ini.");
  }

  let output = work;
  let trimmed = false;

  if (trim) {
    const result = trimTransparent(work);
    output = result.image;
    trimmed = result.trimmed;
  }

  return { image: output, method: used, info, stats, warnings, trimmed };
}
