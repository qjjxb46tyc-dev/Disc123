// =======================
// VARIABLES GLOBALES
// =======================

const video = document.createElement("video");
video.setAttribute("playsinline", "");
video.autoplay = true;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const STEP = 6;
let pixelSize = 6;
let blackThreshold = 40;

// AUDIO
let audioContext;
let audioActive = false;
const activeVoices = [];
const maxLayers = 3;

// =======================
// SLIDERS
// =======================
const pixelSlider = document.getElementById("pixelSlider");
const thresholdSlider = document.getElementById("thresholdSlider");

pixelSlider.addEventListener("input", (e) => pixelSize = parseInt(e.target.value));
thresholdSlider.addEventListener("input", (e) => blackThreshold = parseInt(e.target.value));

// =======================
// WEBCAM
// =======================

navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
  video.srcObject = stream;
});

// =======================
// SEGMENTATION
// =======================

const segmentation = new SelfieSegmentation({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`
});
segmentation.setOptions({ modelSelection: 1 });

segmentation.onResults(results => {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  canvas.width = w;
  canvas.height = h;

  ctx.drawImage(video, 0, 0, w, h);
  const frame = ctx.getImageData(0, 0, w, h).data;

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < h; y += STEP) {
    for (let x = 0; x < w; x += STEP) {
      const i = (y * w + x) * 4;
      const r = frame[i];
      const g = frame[i + 1];
      const b = frame[i + 2];
      const brightness = (r + g + b) / 3;

      ctx.fillStyle = brightness < blackThreshold ? "black" : `hsl(${240 - (brightness / 255) * 240}, 85%, 55%)`;
      ctx.fillRect(x - pixelSize / 2, y - pixelSize / 2, pixelSize, pixelSize);
    }
  }
});

// =======================
// CAMERA LOOP
// =======================

const camera = new Camera(video, {
  onFrame: async () => {
    await segmentation.send({ image: video });
  }
});
camera.start();

// =======================
// AUDIO – 3 CYCLES GRAND ESPACE (20s)
// =======================

const audioBtn = document.getElementById("audioBtn");

audioBtn.addEventListener("click", async () => {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

  if (!audioActive) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const createVoiceCycle = () => {
      const micSource = audioContext.createMediaStreamSource(stream);

      // Peaking filter
      const peaking = audioContext.createBiquadFilter();
      peaking.type = "peaking";
      peaking.frequency.value = 800 + Math.random() * 1200;
      peaking.Q.value = 2;
      peaking.gain.value = 12;

      // Lowpass filter
      const lowpass = audioContext.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 1500;

      // Delay + feedback
      const delayNode = audioContext.createDelay();
      delayNode.delayTime.value = 2.5;

      const feedbackGain = audioContext.createGain();
      feedbackGain.gain.value = 0.25;

      const feedbackFilter = audioContext.createBiquadFilter();
      feedbackFilter.type = "lowpass";
      feedbackFilter.frequency.value = 1200;

      delayNode.connect(feedbackFilter);
      feedbackFilter.connect(feedbackGain);
      feedbackGain.connect(delayNode);

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0;

      micSource.connect(peaking);
      peaking.connect(lowpass);
      lowpass.connect(delayNode);
      delayNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      const cycle = { micSource, peaking, lowpass, delayNode, feedbackGain, feedbackFilter, gainNode };
      activeVoices.push(cycle);

      if (activeVoices.length > maxLayers) {
        const oldest = activeVoices.shift();
        oldest.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 2);
        setTimeout(() => {
          oldest.micSource.disconnect();
          oldest.peaking.disconnect();
          oldest.lowpass.disconnect();
          oldest.delayNode.disconnect();
          oldest.feedbackGain.disconnect();
          oldest.feedbackFilter.disconnect();
          oldest.gainNode.disconnect();
        }, 2000);
      }

      const duration = 20;
      const startTime = audioContext.currentTime;

      const interval = setInterval(() => {
        const elapsed = audioContext.currentTime - startTime;
        const t = Math.min(elapsed / duration, 1);

        gainNode.gain.linearRampToValueAtTime(0.5 * t, audioContext.currentTime + 0.05);
        peaking.frequency.value = 500 + Math.sin(audioContext.currentTime*0.02)*1500;
        lowpass.frequency.value = 1200 + Math.sin(audioContext.currentTime*0.01)*800;
        feedbackFilter.frequency.value = 1200 - t*800;

        if (t >= 1) clearInterval(interval);
      }, 50);
    };

    createVoiceCycle();
    setTimeout(() => createVoiceCycle(), 5000);
    setTimeout(() => createVoiceCycle(), 10000);

    audioActive = true;
    audioBtn.textContent = "Désactiver son";

  } else {
    audioActive = false;
    activeVoices.forEach(cycle => {
      cycle.micSource.disconnect();
      cycle.peaking.disconnect();
      cycle.lowpass.disconnect();
      cycle.delayNode.disconnect();
      cycle.feedbackGain.disconnect();
      cycle.feedbackFilter.disconnect();
      cycle.gainNode.disconnect();
    });
    activeVoices.length = 0;

    audioBtn.textContent = "Activer son";
  }

});
