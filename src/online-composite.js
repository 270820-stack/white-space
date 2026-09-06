const VISION_PKG = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17";
const WASM_PATH = `${VISION_PKG}/wasm`;
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
const BODY_INDEX = new URL("../assets/figures-saved/index.json", import.meta.url).href;
const BODY_DIR = new URL("../assets/figures-saved/", import.meta.url).href;

let visionReady = null;
let faceDetector = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

function canvasFromImage(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.videoWidth || img.width;
  canvas.height = img.naturalHeight || img.videoHeight || img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx };
}

function isEmptyPixel(data, i) {
  const a = data[i + 3];
  if (a < 40) return true;
  return Math.max(data[i], data[i + 1], data[i + 2]) < 18;
}

function backdropMask(data, width, height) {
  const n = width * height;
  const bg = new Uint8Array(n);
  const q = [];
  const tryPush = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (bg[i] || !isEmptyPixel(data, i * 4)) return;
    bg[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < width; x++) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }
  while (q.length) {
    const i = q.pop();
    const x = i % width;
    const y = (i - x) / width;
    tryPush(x - 1, y);
    tryPush(x + 1, y);
    tryPush(x, y - 1);
    tryPush(x, y + 1);
  }
  return bg;
}

function opaqueBounds(data, width, height) {
  const bg = backdropMask(data, width, height);
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!bg[y * width + x]) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) return { x0: 0, y0: 0, x1: width, y1: height };
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

async function ensureVision() {
  if (visionReady) return visionReady;
  visionReady = (async () => {
    const { FilesetResolver, FaceDetector } = await import(`${VISION_PKG}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(WASM_PATH);
    const make = (delegate) =>
      FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.4,
      });
    try {
      faceDetector = await make("GPU");
    } catch {
      faceDetector = await make("CPU");
    }
  })().catch((err) => {
    visionReady = null;
    throw err;
  });
  return visionReady;
}

function cropCanvas(src, box) {
  const w = Math.max(1, box.x1 - box.x0);
  const h = Math.max(1, box.y1 - box.y0);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(src, box.x0, box.y0, w, h, 0, 0, w, h);
  return canvas;
}

function pixelBox(box, width, height) {
  let x = box.originX;
  let y = box.originY;
  let w = box.width;
  let h = box.height;
  if (x <= 1.5 && y <= 1.5 && w <= 1.5 && h <= 1.5) {
    x *= width;
    y *= height;
    w *= width;
    h *= height;
  }
  return { originX: x, originY: y, width: w, height: h };
}

function faceBoxFromDetections(detections, width, height) {
  if (!detections?.length) {
    if (height > width * 1.45) {
      return {
        x0: Math.floor(width * 0.12),
        y0: Math.floor(height * 0.02),
        x1: Math.ceil(width * 0.88),
        y1: Math.ceil(height * 0.26),
      };
    }
    return {
      x0: Math.floor(width * 0.18),
      y0: Math.floor(height * 0.08),
      x1: Math.ceil(width * 0.82),
      y1: Math.ceil(height * 0.78),
    };
  }
  const raw = detections.reduce((a, b) => {
    const aa = pixelBox(a.boundingBox, width, height);
    const bb = pixelBox(b.boundingBox, width, height);
    return aa.width * aa.height >= bb.width * bb.height ? a : b;
  }).boundingBox;
  const box = pixelBox(raw, width, height);
  if (box.height > height * 0.42 && height > width * 1.35) {
    return {
      x0: Math.floor(width * 0.12),
      y0: Math.floor(height * 0.02),
      x1: Math.ceil(width * 0.88),
      y1: Math.ceil(height * 0.22),
    };
  }
  const padX = box.width * 0.22;
  const padTop = box.height * 0.42;
  const padBot = box.height * 0.28;
  return {
    x0: Math.max(0, Math.floor(box.originX - padX)),
    y0: Math.max(0, Math.floor(box.originY - padTop)),
    x1: Math.min(width, Math.ceil(box.originX + box.width + padX)),
    y1: Math.min(height, Math.ceil(box.originY + box.height + padBot)),
  };
}

function ellipseFace(source, box) {
  const cropped = cropCanvas(source, box);
  const ctx = cropped.getContext("2d");
  const { width, height } = cropped;
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.48, width * 0.46, height * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return cropped;
}

async function cutFace(source) {
  const { canvas } = canvasFromImage(source);
  const { width, height } = canvas;
  let detections = [];
  try {
    await Promise.race([ensureVision(), sleep(5000)]);
    if (faceDetector) detections = faceDetector.detect(canvas).detections || [];
  } catch (err) {
    console.warn("face detector unavailable", err);
  }
  const box = faceBoxFromDetections(detections, width, height);
  const cropped = ellipseFace(canvas, box);
  const data = cropped.getContext("2d").getImageData(0, 0, cropped.width, cropped.height);
  return cropCanvas(cropped, opaqueBounds(data.data, cropped.width, cropped.height));
}

function fadeFaceBottom(ctx, width, height) {
  const data = ctx.getImageData(0, 0, width, height);
  const pix = data.data;
  const fadeH = Math.max(6, Math.floor(height * 0.16));
  for (let y = 0; y < height; y++) {
    const fade = Math.min(1, (height - 1 - y) / fadeH);
    for (let x = 0; x < width; x++) pix[(y * width + x) * 4 + 3] *= fade;
  }
  ctx.putImageData(data, 0, 0);
}

function compositeFaceOnBody(faceCanvas, bodyImg) {
  const { canvas, ctx } = canvasFromImage(bodyImg);
  const { width, height } = canvas;
  const body = ctx.getImageData(0, 0, width, height);
  const bb = opaqueBounds(body.data, width, height);
  const bw = Math.max(1, bb.x1 - bb.x0);
  const bh = Math.max(1, bb.y1 - bb.y0);
  const headH = Math.max(8, Math.floor(bh * 0.2));
  const neckY = bb.y0 + headH;
  let naturalW = 0;
  for (let y = bb.y0; y < neckY; y++) {
    let x0 = width;
    let x1 = 0;
    for (let x = bb.x0; x < bb.x1; x++) {
      if (!isEmptyPixel(body.data, (y * width + x) * 4)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (x1 >= x0) naturalW = Math.max(naturalW, x1 - x0 + 1);
  }
  if (!naturalW) naturalW = Math.floor(bw * 0.42);

  const faceData = faceCanvas.getContext("2d").getImageData(0, 0, faceCanvas.width, faceCanvas.height);
  const fb = opaqueBounds(faceData.data, faceCanvas.width, faceCanvas.height);
  const faceCrop = cropCanvas(faceCanvas, fb);
  const targetH = Math.max(28, Math.floor(bh * 0.22));
  const targetW = Math.max(24, Math.floor(naturalW * 0.95));
  const ratio = Math.min(targetW / Math.max(1, faceCrop.width), targetH / Math.max(1, faceCrop.height));
  const fw = Math.max(24, Math.round(faceCrop.width * ratio));
  const fh = Math.max(28, Math.round(faceCrop.height * ratio));
  const face = document.createElement("canvas");
  face.width = fw;
  face.height = fh;
  const fctx = face.getContext("2d");
  fctx.drawImage(faceCrop, 0, 0, fw, fh);
  fadeFaceBottom(fctx, fw, fh);

  const pix = body.data;
  for (let y = 0; y < height; y++) {
    const keep = y < neckY ? 0 : Math.min(1, (y - neckY) / 10);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (y < neckY || keep < 1) {
        if (y < neckY) {
          pix[i] = 0;
          pix[i + 1] = 0;
          pix[i + 2] = 0;
          pix[i + 3] = 0;
        } else {
          pix[i + 3] = Math.round(pix[i + 3] * keep);
        }
      }
    }
  }
  ctx.putImageData(body, 0, 0);
  const px = bb.x0 + Math.floor((bw - fw) / 2);
  const py = Math.max(0, neckY - fh + Math.floor(fh * 0.18));
  ctx.drawImage(face, px, py);
  const out = ctx.getImageData(0, 0, width, height);
  const tight = opaqueBounds(out.data, width, height);
  const pad = 8;
  return cropCanvas(canvas, {
    x0: Math.max(0, tight.x0 - pad),
    y0: Math.max(0, tight.y0 - pad),
    x1: Math.min(width, tight.x1 + pad),
    y1: Math.min(height, tight.y1 + pad),
  });
}

async function pickBody() {
  const list = await (await fetch(`${BODY_INDEX}?t=${Date.now()}`)).json();
  const name = list[Math.floor(Math.random() * list.length)];
  return loadImage(`${BODY_DIR}${name}`);
}

export async function warmupOnline() {
  try {
    await Promise.race([ensureVision(), sleep(8000)]);
  } catch {
    // Ellipse crop still works without the detector.
  }
}

export async function processOnlinePhoto(source) {
  const face = await cutFace(source);
  const body = await pickBody();
  const canvas = compositeFaceOnBody(face, body);
  return {
    id: Date.now(),
    figure: "online",
    src: canvas.toDataURL("image/png"),
    canvas,
    count: 3 + Math.floor(Math.random() * 8),
  };
}
