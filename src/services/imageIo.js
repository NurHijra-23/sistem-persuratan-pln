// Konversi gambar <-> piksel RGBA di browser (dipakai dialog penghapusan latar).

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Gambar tidak dapat dibaca."));
    image.src = src;
  });
}

// Membaca data URL menjadi piksel RGBA; sisi terpanjang dibatasi agar pemrosesan tetap cepat.
export async function dataUrlToPixels(dataUrl, maxSide = 900) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);

  const frame = context.getImageData(0, 0, width, height);

  return { data: frame.data, width, height };
}

export function drawPixels(canvas, image) {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
}

// PNG (mempertahankan transparansi).
export function pixelsToDataUrl(image) {
  const canvas = document.createElement("canvas");
  drawPixels(canvas, image);
  return canvas.toDataURL("image/png");
}
