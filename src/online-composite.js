const VISION_PKG = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17";
const WASM_PATH = `${VISION_PKG}/wasm`;
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
const SELFIE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const BODY_INDEX = "./assets/figures-saved/index.json";
const BODY_DIR = "./assets/figures-saved";

let visionReady = null;
let faceDetector = null;
let segmenter = null;

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
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx };
}

function opaqueBounds(data, width, height, minA = 40) {
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > minA) {
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
    const { FilesetResolver, FaceDetector, ImageSegmenter } = await import(`${VISION_PKG}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(WASM_PATH);
    const make = async (delegate) => {
      faceDetector = await FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.45,
      });
      segmenter = await ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: SELFIE_MODEL, delegate },
        runningMode: "IMAGE",
        outputCategoryMask: true,
      });
    };
    try {
      await make("GPU");
    } catch {
      await make("CPU");
    }
  })().catch((err) => {
    visionReady = null;
    throw err;
  });
  return visionReady;
}

function applyMask(ctx, maskBytes, maskW, maskH) {
  const { width, height } = ctx.canvas;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = maskW;
  maskCanvas.height = maskH;
  const mid = maskCanvas.getContext("2d").createImageData(maskW, maskH);
  const pix = mid.data;
  for (let i = 0; i < maskBytes.length; i++) {
    const keep = maskBytes[i] > 0;
    pix[i * 4 + 3] = keep ? 255 : 0;
  }
  maskCanvas.getContext("2d").putImageData(mid, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(maskCanvas, 0, 0, width, height);
  ctx.restore();
}

function opaqueRatio(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 40) n += 1;
  return n / Math.max(1, width * height);
}

function ellipseFace(source, box) {
  const cropped = cropCanvas(source, box);
  const ctx = cropped.getContext("2d");
  const { width, height } = cropped;
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.48, width * 0.42, height * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return cropped;
}

function readMask(result) {
  if (result?.categoryMask) {
    const mask = result.categoryMask;
    return { bytes: mask.getAsUint8Array(), width: mask.width, height: mask.height, close: () => mask.close() };
  }
  const conf = result?.confidenceMasks?.[0];
  if (!conf) return null;
  const floats = conf.getAsFloat32Array();
  const bytes = new Uint8Array(floats.length);
  for (let i = 0; i < floats.length; i++) bytes[i] = floats[i] > 0.35 ? 1 : 0;
  return { bytes, width: conf.width, height: conf.height, close: () => conf.close() };
}

function segmentOnce(canvas) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    try {
      const out = segmenter.segment(canvas, finish);
      if (out?.categoryMask || out?.confidenceMasks) finish(out);
    } catch (err) {
      reject(err);
    }
  });
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

function faceBoxFromDetections(detections, width, height) {
  if (!detections?.length) {
    return {
      x0: Math.floor(width * 0.18),
      y0: Math.floor(height * 0.08),
      x1: Math.ceil(width * 0.82),
      y1: Math.ceil(height * 0.78),
    };
  }
  const box = detections.reduce((a, b) => {
    const aa = a.boundingBox;
    const bb = b.boundingBox;
    return aa.width * aa.height >= bb.width * bb.height ? a : b;
  }).boundingBox;
  const padX = box.width * 0.22;
  const padTop = box.height * 0.38;
  const padBot = box.height * 0.22;
  return {
    x0: Math.max(0, Math.floor(box.originX - padX)),
    y0: Math.max(0, Math.floor(box.originY - padTop)),
    x1: Math.min(width, Math.ceil(box.originX + box.width + padX)),
    y1: Math.min(height, Math.ceil(box.originY + box.height + padBot)),
  };
}

async function cutFace(source) {
  const { canvas, ctx } = canvasFromImage(source);
  const { width, height } = canvas;
  let detections = [];
  try {
    await ensureVision();
    detections = faceDetector.detect(canvas).detections || [];
    const result = await segmentOnce(canvas);
    const mask = readMask(result);
    if (mask) {
      applyMask(ctx, mask.bytes, mask.width, mask.height);
      mask.close();
    }
    result.close?.();
  } catch (err) {
    console.warn("vision cutout unavailable, using ellipse crop", err);
  }
  const box = faceBoxFromDetections(detections, width, height);
  let cropped = cropCanvas(canvas, box);
  if (opaqueRatio(cropped) < 0.05) cropped = ellipseFace(source, box);
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
  const headH = Math.max(8, Math.floor(bh * 0.19));
  const neckY = bb.y0 + headH;
  let naturalW = 0;
  for (let y = bb.y0; y < neckY; y++) {
    let x0 = width;
    let x1 = 0;
    for (let x = bb.x0; x < bb.x1; x++) {
      if (body.data[(y * width + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (x1 >= x0) naturalW = Math.max(naturalW, x1 - x0 + 1);
  }
  if (!naturalW) naturalW = Math.floor(bw * 0.4);

  const faceData = faceCanvas.getContext("2d").getImageData(0, 0, faceCanvas.width, faceCanvas.height);
  const fb = opaqueBounds(faceData.data, faceCanvas.width, faceCanvas.height);
  const faceCrop = cropCanvas(faceCanvas, fb);
  let targetW = Math.max(24, Math.floor(naturalW * 0.9));
  let ratio = targetW / Math.max(1, faceCrop.width);
  const maxH = Math.max(28, Math.floor(bh * 0.2));
  if (Math.floor(faceCrop.height * ratio) > maxH) ratio = maxH / Math.max(1, faceCrop.height);
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
  ctx.putImageData(body, 0, 0);
  const px = bb.x0 + Math.floor((bw - fw) / 2);
  const py = neckY - fh + Math.floor(fh * 0.14);
  ctx.drawImage(face, px, py);
  return canvas;
}

async function pickBody() {
  const list = await (await fetch(`${BODY_INDEX}?t=${Date.now()}`)).json();
  const name = list[Math.floor(Math.random() * list.length)];
  return loadImage(`${BODY_DIR}/${name}`);
}

export async function warmupOnline() {
  try {
    await ensureVision();
  } catch {
    // Fallback crop still works.
  }
}

export async function processOnlinePhoto(source) {
  const face = await cutFace(source);
  const body = await pickBody();
  const combined = compositeFaceOnBody(face, body);
  const blob = await new Promise((resolve) => combined.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not encode composite");
  return {
    id: Date.now(),
    figure: "online",
    src: URL.createObjectURL(blob),
    count: 3 + Math.floor(Math.random() * 8),
  };
}
