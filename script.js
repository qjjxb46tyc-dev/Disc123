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
const activeVoices = []; // tableau pour superposition des cycles
const maxLayers = 3;     // 3 cycles maximum

// =======================
// WEBCAM (facultatif)
// =======================

navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
  video.srcObject = stream;
});

// =======================
// MEDIAPIPE SEGMENTATION (facultatif)
// =======================

const segmentation = new SelfieSegmentation({
  locateFile: f =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`
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
// AUDIO – 3 CYCLES + FILTRE PEAKING
// =======================

const audioBtn = document.getElementById("audioBtn");

audioBtn.addEventListener("click", async () => {

  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

  if (!audioActive) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const createVoiceCycle = () => {
      const micSource = audioContext.createMediaStreamSource(stream);

      // ===== Peaking filter
      const peaking = audioContext.createBiquadFilter();
      peaking.type = "peaking";
      peaking.frequency.value = 500 + Math.random() * 2000; // fréquence aléatoire
      peaking.Q.value = 1.2;
      peaking.gain.value = 6; // boost léger

      // ===== Delay + feedback
      const delayNode = audioContext.createDelay();
      delayNode.delayTime.value = 0.3;

      const feedbackGain = audioContext.createGain();
      feedbackGain.gain.value = 0.4;

      const feedbackFilter = audioContext.createBiquadFilter();
      feedbackFilter.type = "lowpass";
      feedbackFilter.frequency.value = 1500;

      // boucle feedback : delay → filter → gain → delay
      delayNode.connect(feedbackFilter);
      feedbackFilter.connect(feedbackGain);
      feedbackGain.connect(delayNode);

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0; // fondu d’entrée

      // connexions
      micSource.connect(peaking);
      peaking.connect(delayNode);
      delayNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      const cycle = { micSource, delayNode, feedbackGain, feedbackFilter, gainNode };
      activeVoices.push(cycle);

      // si plus de 3 cycles, supprimer le plus ancien avec fondu
      if (activeVoices.length > maxLayers) {
        const oldest = activeVoices.shift();
        oldest.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 2);
        setTimeout(() => {
          oldest.micSource.disconnect();
          oldest.delayNode.disconnect();
          oldest.feedbackGain.disconnect();
          oldest.feedbackFilter.disconnect();
          oldest.gainNode.disconnect();
        }, 2000);
      }

      // ===== Animation du cycle (30s)
      const duration = 30;
      const startTime = audioContext.currentTime;

      const interval = setInterval(() => {
        const elapsed = audioContext.currentTime - startTime;
        const t = Math.min(elapsed / duration, 1);

        // Feedback et filtre progressifs
        feedbackGain.gain.value = 0.4 + t * 0.55; // jusqu'à 0.95
        feedbackFilter.frequency.value = 1500 - t * 1200; // jusqu'à 300Hz
        gainNode.gain.value = 0.5 * t; // fondu d'entrée

        if (t >= 1) clearInterval(interval);
      }, 100);
    };

    // Création initiale
    createVoiceCycle();

    // Nouveau cycle toutes les 30s
    setInterval(() => {
      if (!audioActive) return;
      createVoiceCycle();
    }, 30000);

    audioActive = true;
    audioBtn.textContent = "Désactiver son";

  } else {
    // ===== DÉSACTIVER SON
    audioActive = false;
    activeVoices.forEach(cycle => {
      cycle.micSource.disconnect();
      cycle.delayNode.disconnect();
      cycle.feedbackGain.disconnect();
      cycle.feedbackFilter.disconnect();
      cycle.gainNode.disconnect();
    });
    activeVoices.length = 0;

    audioBtn.textContent = "Activer son";
  }

});
