// =======================
// VARIABLES GLOBALES
// =======================
const video = document.createElement("video");
video.setAttribute("playsinline", "");
video.autoplay = true;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let STEP = 6;           
let blackThreshold = 60;

let audioContext;
let audioActive = false;
let micStream;
const activeVoices = [];
const maxLayers = 3;

// =======================
// JAUGES VERTICALES
// =======================
function setupGauge(id, max, initialValue, callback) {
  const gauge = document.getElementById(id);
  let dragging = false;

  function update(value) {
    value = Math.min(Math.max(value, 0), max);
    const pct = (value / max) * 100;
    gauge.style.background = `linear-gradient(to top, #00ffff ${pct}%, #111 ${pct}%)`;
    callback(value);
  }

  update(initialValue);

  function drag(e) {
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = gauge.getBoundingClientRect();
    let relative = 1 - (clientY - rect.top) / rect.height;
    const value = Math.round(relative * max);
    update(value);
  }

  gauge.addEventListener("mousedown", e => { dragging = true; drag(e); });
  gauge.addEventListener("mousemove", e => { if(dragging) drag(e); });
  gauge.addEventListener("mouseup", () => dragging = false);
  gauge.addEventListener("mouseleave", () => dragging = false);
  gauge.addEventListener("touchstart", e => { dragging = true; drag(e); e.preventDefault(); });
  gauge.addEventListener("touchmove", e => { if(dragging) drag(e); e.preventDefault(); });
  gauge.addEventListener("touchend", () => dragging = false);
}

setupGauge("pixelGauge", 20, STEP, val => STEP = val);
setupGauge("thresholdGauge", 255, blackThreshold, val => blackThreshold = val);

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

const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d");

function thermalColor(r,g,b) {
  const lum = 0.299*r + 0.587*g + 0.114*b;
  const hue = 240 - (lum/255)*240;
  return { color:`hsl(${hue},85%,55%)`, lum };
}

segmentation.onResults(results => {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if(!w||!h) return;

  canvas.width = w;
  canvas.height = h;
  maskCanvas.width = w;
  maskCanvas.height = h;

  ctx.drawImage(video,0,0,w,h);
  const frameData = ctx.getImageData(0,0,w,h).data;

  maskCtx.clearRect(0,0,w,h);
  maskCtx.drawImage(results.segmentationMask,0,0,w,h);
  const maskData = maskCtx.getImageData(0,0,w,h).data;

  ctx.clearRect(0,0,w,h);

  for(let y=0; y<h; y+=STEP){
    for(let x=0; x<w; x+=STEP){
      const i = (y*w+x)*4;
      const alpha = maskData[i+3];

      if(alpha<128){ // fond
        const r=frameData[i], g=frameData[i+1], b=frameData[i+2];
        const {color, lum} = thermalColor(r,g,b);
        ctx.fillStyle = lum<blackThreshold ? "black" : color;
        ctx.fillRect(x,y,STEP,STEP);
      } else { // sujet
        ctx.fillStyle = "black";
        ctx.fillRect(x,y,STEP,STEP);

        if(Math.random()<0.3){
          const r=frameData[i], g=frameData[i+1], b=frameData[i+2];
          const {color} = thermalColor(r,g,b);
          ctx.fillStyle = color;
          const offsetX=(Math.random()-0.5)*STEP/2;
          const offsetY=(Math.random()-0.5)*STEP/2;
          ctx.fillRect(x+STEP/4+offsetX,y+STEP/4+offsetY,STEP/2,STEP/2);
        }
      }
    }
  }
});

// =======================
// CAMERA LOOP
// =======================
const camera = new Camera(video,{onFrame: async()=>{await segmentation.send({image:video});}});
camera.start();

// =======================
// BOUTON AUDIO UNIQUE
// =======================
const audioBtn = document.getElementById("audioBtn");

audioBtn.addEventListener("click", async () => {
  if(!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

  if(audioContext.state==="suspended") await audioContext.resume();

  if(!audioActive){
    if(!micStream){
      micStream = await navigator.mediaDevices.getUserMedia({audio:true});
    }

    const createVoiceCycle = () => {
      const micSource = audioContext.createMediaStreamSource(micStream);

      const peaking = audioContext.createBiquadFilter();
      peaking.type = "peaking";
      peaking.frequency.value = 800;
      peaking.Q.value = 2;
      peaking.gain.value = 12;

      const delayNode = audioContext.createDelay();
      delayNode.delayTime.value = 2;

      const feedbackGain = audioContext.createGain();
      feedbackGain.gain.value = 0.25;

      const feedbackFilter = audioContext.createBiquadFilter();
      feedbackFilter.type = "lowpass";
      feedbackFilter.frequency.value = 1200;

      delayNode.connect(feedbackFilter);
      feedbackFilter.connect(feedbackGain);
      feedbackGain.connect(delayNode);

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.5;

      micSource.connect(peaking);
      peaking.connect(delayNode);
      delayNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      activeVoices.push({ micSource, peaking, delayNode, feedbackGain, feedbackFilter, gainNode });

      if(activeVoices.length>maxLayers){
        const oldest = activeVoices.shift();
        oldest.gainNode.gain.linearRampToValueAtTime(0,audioContext.currentTime+2);
        setTimeout(()=>{
          oldest.micSource.disconnect();
          oldest.peaking.disconnect();
          oldest.delayNode.disconnect();
          oldest.feedbackGain.disconnect();
          oldest.feedbackFilter.disconnect();
          oldest.gainNode.disconnect();
        },2000);
      }
    };

    createVoiceCycle();
    setTimeout(createVoiceCycle,5000);
    setTimeout(createVoiceCycle,10000);

    audioActive = true;
    audioBtn.textContent = "Désactiver son";

  } else {
    audioActive = false;
    activeVoices.forEach(cycle=>{
      cycle.micSource.disconnect();
      cycle.peaking.disconnect();
      cycle.delayNode.disconnect();
      cycle.feedbackGain.disconnect();
      cycle.feedbackFilter.disconnect();
      cycle.gainNode.disconnect();
    });
    activeVoices.length=0;
    audioBtn.textContent = "Activer son";
  }
});
