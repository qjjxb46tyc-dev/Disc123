const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let blackThreshold = 60;
let pixelSize = 4;
let step = pixelSize;

// Sliders et “fills”
const leftFill = document.getElementById("leftFill");
const rightFill = document.getElementById("rightFill");

// Valeurs normalisées 0-1
let blackNorm = blackThreshold / 255;
let pixelNorm = (pixelSize - 2) / (20 - 2);

// Couleur inverse pour les sliders
function inverseThermalColor(norm) {
  const hue = 240 - norm * 240;
  const inverseHue = (hue + 180) % 360;
  return `hsl(${inverseHue}, 90%, 50%)`;
}

// Slider vertical interactif
function setupVerticalSlider(sliderDiv, fillDiv, onUpdate, initialValue=0.5) {
  let dragging = false;

  sliderDiv.addEventListener("mousedown", e => dragging = true);
  sliderDiv.addEventListener("touchstart", e => dragging = true);

  document.addEventListener("mouseup", e => dragging = false);
  document.addEventListener("touchend", e => dragging = false);

  function updateValue(e) {
    if (!dragging) return;
    const rect = sliderDiv.getBoundingClientRect();
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    let value = (rect.bottom - y) / rect.height;
    if (value > 1) value = 1;
    if (value < 0) value = 0;
    onUpdate(value);
  }

  sliderDiv.addEventListener("mousemove", updateValue);
  sliderDiv.addEventListener("touchmove", updateValue);

  // valeur initiale
  onUpdate(initialValue);
}

// Configurer sliders
setupVerticalSlider(document.getElementById("leftSlider"), leftFill, v => {
  blackNorm = v;
  blackThreshold = Math.round(blackNorm * 255);
  leftFill.style.height = (blackNorm * 100) + "%";
  leftFill.style.background = inverseThermalColor(blackNorm);
});

setupVerticalSlider(document.getElementById("rightSlider"), rightFill, v => {
  pixelNorm = v;
  pixelSize = Math.round(pixelNorm * (20 - 2) + 2);
  step = pixelSize;
  rightFill.style.height = (pixelNorm * 100) + "%";
  rightFill.style.background = inverseThermalColor(pixelNorm);
});

// Webcam et Mediapipe
navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
  video.srcObject = stream;
});

const segmentation = new SelfieSegmentation({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`
});
segmentation.setOptions({ modelSelection: 1 });

const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d");

function thermalColor(r, g, b) {
  const lum = 0.299*r + 0.587*g + 0.114*b;
  const hue = 240 - (lum / 255) * 240;
  return { color: `hsl(${hue}, 90%, 50%)`, lum };
}

segmentation.onResults(results => {
  const w = video.videoWidth;
  const h = video.videoHeight;
  canvas.width = w;
  canvas.height = h;
  maskCanvas.width = w;
  maskCanvas.height = h;

  ctx.drawImage(video, 0, 0, w, h);
  const frameData = ctx.getImageData(0, 0, w, h).data;

  maskCtx.clearRect(0, 0, w, h);
  maskCtx.drawImage(results.segmentationMask, 0, 0, w, h);
  const maskData = maskCtx.getImageData(0, 0, w, h).data;

  ctx.clearRect(0, 0, w, h);

  // Fond
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (maskData[i + 3] < 128) {
        const { color, lum } = thermalColor(frameData[i], frameData[i+1], frameData[i+2]);
        ctx.fillStyle = lum < blackThreshold ? "black" : color;
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  // Sujet
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (maskData[i + 3] > 128) {
        ctx.fillStyle = "black";
        ctx.fillRect(x, y, step, step);
        if (Math.random() < 0.3) {
          const { color } = thermalColor(frameData[i], frameData[i+1], frameData[i+2]);
          ctx.fillStyle = color;
          const offsetX = (Math.random()-0.5)*step/2;
          const offsetY = (Math.random()-0.5)*step/2;
          ctx.fillRect(x + step/4 + offsetX, y + step/4 + offsetY, step/2, step/2);
        }
      }
    }
  }
});

const camera = new Camera(video, { onFrame: async () => { await segmentation.send({ image: video }); }});
camera.start();
