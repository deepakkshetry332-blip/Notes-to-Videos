// ── NoteFilm App ──────────────────────────────────────────────
// All processing is client-side. OpenAI is called directly from browser.
// FFmpeg.wasm renders the final MP4 locally.

import { FFmpeg } from ‘https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js’;
import { fetchFile, toBlobURL } from ‘https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js’;

// ── STATE ─────────────────────────────────────────────────────
let apiKey = ‘’;
let ffmpeg = null;
let ffmpegLoaded = false;
let videoBlob = null;
let scenes = [];

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener(‘DOMContentLoaded’, () => {
apiKey = localStorage.getItem(‘nf_openai_key’) || ‘’;
if (apiKey) {
showScreen(‘app-screen’);
} else {
showScreen(‘setup-screen’);
}
populateVoices();
window.speechSynthesis.onvoiceschanged = populateVoices;
});

function populateVoices() {
const sel = document.getElementById(‘voice-select’);
if (!sel) return;
const voices = window.speechSynthesis.getVoices();
if (!voices.length) return;
sel.innerHTML = ‘’;
voices
.filter(v => v.lang.startsWith(‘en’))
.forEach(v => {
const opt = document.createElement(‘option’);
opt.value = v.name;
opt.textContent = v.name.replace(‘Google ‘, ‘’).replace(’ English’, ‘’).slice(0, 18);
sel.appendChild(opt);
});
}

// ── SCREEN MANAGEMENT ─────────────────────────────────────────
function showScreen(id) {
[‘setup-screen’, ‘app-screen’, ‘progress-screen’, ‘done-screen’].forEach(s => {
document.getElementById(s).style.display = ‘none’;
});
document.getElementById(id).style.display = ‘block’;
}

// ── KEY MANAGEMENT ────────────────────────────────────────────
window.saveKey = () => {
const val = document.getElementById(‘api-key-input’).value.trim();
if (!val.startsWith(‘sk-’)) {
toast(‘Please enter a valid OpenAI API key (starts with sk-)’);
return;
}
apiKey = val;
localStorage.setItem(‘nf_openai_key’, apiKey);
showScreen(‘app-screen’);
};

window.changeKey = () => {
document.getElementById(‘api-key-input’).value = apiKey;
showScreen(‘setup-screen’);
};

window.toggleKeyVisibility = () => {
const inp = document.getElementById(‘api-key-input’);
inp.type = inp.type === ‘password’ ? ‘text’ : ‘password’;
};

// ── CHAR COUNT ────────────────────────────────────────────────
window.updateCharCount = () => {
const n = document.getElementById(‘notes-input’).value.length;
document.getElementById(‘char-count’).textContent = n;
};

// ── MAIN GENERATION FLOW ──────────────────────────────────────
window.startGeneration = async () => {
const notes = document.getElementById(‘notes-input’).value.trim();
if (notes.length < 50) {
toast(‘Please paste at least a few sentences of notes.’);
return;
}

const sceneCount = parseInt(document.getElementById(‘scene-count’).value);
const imageStyle = document.getElementById(‘image-style’).value;
const sceneDuration = parseInt(document.getElementById(‘scene-duration’).value);
const voiceName = document.getElementById(‘voice-select’).value;

showScreen(‘progress-screen’);
document.getElementById(‘scenes-grid’).innerHTML = ‘’;
document.getElementById(‘scenes-label’).style.display = ‘none’;
videoBlob = null;

try {
// ── STEP 1: Parse notes into scenes ──
setStep(‘step-parse’, ‘active’);
setDetail(‘Sending notes to GPT-4o…’);
scenes = await parseNotesIntoScenes(notes, sceneCount);
setStep(‘step-parse’, ‘done’);

```
// Show scene grid placeholders
renderScenePlaceholders(scenes.length);

// ── STEP 2: Generate images ──
setStep('step-images', 'active');
setDetail('Generating images… (this may take 1–2 min)');
const imageBlobs = await generateImages(scenes, imageStyle, (i) => {
  setDetail(`Generating image ${i + 1} of ${scenes.length}…`);
  fillSceneThumb(i, null, true);
});
setStep('step-images', 'done');

// Fill thumbs with real images
imageBlobs.forEach((blob, i) => fillSceneThumb(i, blob, false));

// ── STEP 3: TTS audio per scene ──
setStep('step-audio', 'active');
setDetail('Synthesising narration…');
const audioBlobs = await synthesiseAudio(scenes, voiceName, (i) => {
  setDetail(`Narrating scene ${i + 1} of ${scenes.length}…`);
});
setStep('step-audio', 'done');

// ── STEP 4: Render MP4 ──
setStep('step-video', 'active');
setDetail('Loading FFmpeg (first time ~31MB)…');
await ensureFFmpeg();
setDetail('Stitching scenes into MP4…');
videoBlob = await renderVideo(imageBlobs, audioBlobs, sceneDuration, scenes);
setStep('step-video', 'done');

// ── DONE ──
const totalSecs = scenes.length * sceneDuration;
document.getElementById('done-meta').textContent =
  `${scenes.length} scenes · ${totalSecs} seconds`;
showScreen('done-screen');
```

} catch (err) {
console.error(err);
toast(‘Error: ’ + (err.message || ‘Something went wrong. Check API key & quota.’));
const activeStep = document.querySelector(’.step-item.active’);
if (activeStep) activeStep.className = ‘step-item error’;
}
};

// ── GPT-4o: PARSE NOTES ───────────────────────────────────────
async function parseNotesIntoScenes(notes, count) {
const prompt = `You are a visual learning content designer.
Convert the following study notes into exactly ${count} concise scenes for an educational video.

For each scene return JSON with:

- “title”: short scene title (3-5 words)
- “narration”: 1-2 sentence spoken explanation (max 30 words) - clear, engaging, educational
- “imagePrompt”: detailed DALL-E image prompt describing a visual that represents this concept

Return ONLY a JSON array, no markdown, no explanation.

Notes:
“””
${notes}
“””`;

const res = await openAIChat([{ role: ‘user’, content: prompt }], ‘gpt-4o’, 1500);
const text = res.choices[0].message.content.trim();
const clean = text.replace(/`json|`/g, ‘’).trim();
return JSON.parse(clean);
}

// ── DALL-E 3: GENERATE IMAGES ─────────────────────────────────
async function generateImages(scenes, style, onProgress) {
const blobs = [];
for (let i = 0; i < scenes.length; i++) {
onProgress(i);
const prompt = `${scenes[i].imagePrompt}. Style: ${style}. High quality, educational, 16:9 composition, no text overlays.`;
const res = await openAIImage(prompt);
const imageUrl = res.data[0].url;
const imgRes = await fetch(imageUrl);
const blob = await imgRes.blob();
blobs.push(blob);
}
return blobs;
}

// ── WEB SPEECH API: TTS ───────────────────────────────────────
async function synthesiseAudio(scenes, voiceName, onProgress) {
const blobs = [];
for (let i = 0; i < scenes.length; i++) {
onProgress(i);
const blob = await speakToBlob(scenes[i].narration, voiceName);
blobs.push(blob);
}
return blobs;
}

function speakToBlob(text, voiceName) {
return new Promise((resolve, reject) => {
// Use MediaRecorder to capture Web Speech output
try {
const audioCtx = new AudioContext();
const dest = audioCtx.createMediaStreamDestination();
const recorder = new MediaRecorder(dest.stream);
const chunks = [];

```
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));

  recorder.start();
  const utt = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.name === voiceName) || voices.find(v => v.lang.startsWith('en')) || voices[0];
  if (voice) utt.voice = voice;
  utt.rate = 0.95;
  utt.pitch = 1;
  utt.onend = () => {
    setTimeout(() => recorder.stop(), 300);
  };
  utt.onerror = reject;
  window.speechSynthesis.speak(utt);
} catch (e) {
  // Fallback: create a silent audio blob of ~3s if Web Speech + MediaRecorder combo fails
  console.warn('TTS capture failed, using silent audio:', e);
  const sampleRate = 44100;
  const duration = 3;
  const numSamples = sampleRate * duration;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  writeWavHeader(view, numSamples, sampleRate, 1);
  resolve(new Blob([buffer], { type: 'audio/wav' }));
}
```

});
}

function writeWavHeader(view, numSamples, sampleRate, numChannels) {
const byteRate = sampleRate * numChannels * 2;
const blockAlign = numChannels * 2;
const dataSize = numSamples * numChannels * 2;
let o = 0;
const writeStr = s => { for (let c of s) view.setUint8(o++, c.charCodeAt(0)); };
writeStr(‘RIFF’); view.setUint32(o, 36 + dataSize, true); o += 4;
writeStr(‘WAVE’); writeStr(’fmt ’);
view.setUint32(o, 16, true); o += 4;
view.setUint16(o, 1, true); o += 2;
view.setUint16(o, numChannels, true); o += 2;
view.setUint32(o, sampleRate, true); o += 4;
view.setUint32(o, byteRate, true); o += 4;
view.setUint16(o, blockAlign, true); o += 2;
view.setUint16(o, 16, true); o += 2;
writeStr(‘data’); view.setUint32(o, dataSize, true);
}

// ── FFMPEG: RENDER MP4 ────────────────────────────────────────
async function ensureFFmpeg() {
if (ffmpegLoaded) return;
if (!ffmpeg) ffmpeg = new FFmpeg();
const baseURL = ‘https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm’;
await ffmpeg.load({
coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, ‘text/javascript’),
wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, ‘application/wasm’),
});
ffmpegLoaded = true;
}

async function renderVideo(imageBlobs, audioBlobs, sceneDuration, scenes) {
// Write files to FFmpeg FS
for (let i = 0; i < imageBlobs.length; i++) {
ffmpeg.writeFile(`img${i}.jpg`, await fetchFile(imageBlobs[i]));
ffmpeg.writeFile(`audio${i}.webm`, await fetchFile(audioBlobs[i]));
}

// Build a concat input list: for each scene, make a still video segment then add audio
const segmentFiles = [];
for (let i = 0; i < scenes.length; i++) {
setDetail(`Encoding scene ${i + 1} of ${scenes.length}…`);
const seg = `seg${i}.mp4`;
// Create a video segment from image + audio
await ffmpeg.exec([
‘-loop’, ‘1’,
‘-i’, `img${i}.jpg`,
‘-i’, `audio${i}.webm`,
‘-c:v’, ‘libx264’,
‘-c:a’, ‘aac’,
‘-b:a’, ‘128k’,
‘-shortest’,
‘-t’, String(sceneDuration),
‘-vf’, `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,drawtext=text='${escapeDrawtext(scenes[i].title)}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h-80:box=1:boxcolor=black@0.5:boxborderw=10`,
‘-pix_fmt’, ‘yuv420p’,
‘-r’, ‘25’,
seg
]);
segmentFiles.push(seg);
}

// Concatenate all segments
setDetail(‘Concatenating all scenes…’);
const concatList = segmentFiles.map(f => `file '${f}'`).join(’\n’);
ffmpeg.writeFile(‘concat.txt’, concatList);
await ffmpeg.exec([
‘-f’, ‘concat’,
‘-safe’, ‘0’,
‘-i’, ‘concat.txt’,
‘-c’, ‘copy’,
‘output.mp4’
]);

const data = await ffmpeg.readFile(‘output.mp4’);
return new Blob([data.buffer], { type: ‘video/mp4’ });
}

function escapeDrawtext(text) {
return (text || ‘’).replace(/’/g, “\’”).replace(/:/g, ‘\:’).replace(/[/g, ‘\[’).replace(/]/g, ‘\]’);
}

// ── DOWNLOAD ──────────────────────────────────────────────────
window.downloadVideo = () => {
if (!videoBlob) return;
const url = URL.createObjectURL(videoBlob);
const a = document.createElement(‘a’);
a.href = url;
a.download = ‘notefilm-video.mp4’;
a.click();
setTimeout(() => URL.revokeObjectURL(url), 5000);
};

window.startOver = () => {
document.getElementById(‘notes-input’).value = ‘’;
document.getElementById(‘char-count’).textContent = ‘0’;
videoBlob = null;
scenes = [];
// Reset steps
[‘step-parse’,‘step-images’,‘step-audio’,‘step-video’].forEach(id => {
document.getElementById(id).className = ‘step-item’;
});
showScreen(‘app-screen’);
};

// ── OPENAI HELPERS ────────────────────────────────────────────
async function openAIChat(messages, model = ‘gpt-4o’, max_tokens = 1000) {
const res = await fetch(‘https://api.openai.com/v1/chat/completions’, {
method: ‘POST’,
headers: {
‘Content-Type’: ‘application/json’,
‘Authorization’: `Bearer ${apiKey}`
},
body: JSON.stringify({ model, messages, max_tokens })
});
if (!res.ok) {
const err = await res.json();
throw new Error(err.error?.message || `OpenAI error ${res.status}`);
}
return res.json();
}

async function openAIImage(prompt) {
const res = await fetch(‘https://api.openai.com/v1/images/generations’, {
method: ‘POST’,
headers: {
‘Content-Type’: ‘application/json’,
‘Authorization’: `Bearer ${apiKey}`
},
body: JSON.stringify({
model: ‘dall-e-3’,
prompt,
n: 1,
size: ‘1792x1024’,
quality: ‘standard’
})
});
if (!res.ok) {
const err = await res.json();
throw new Error(err.error?.message || `DALL-E error ${res.status}`);
}
return res.json();
}

// ── UI HELPERS ────────────────────────────────────────────────
function setStep(id, state) {
const el = document.getElementById(id);
const icon = el.dataset.icon;
el.className = `step-item ${state}`;
const iconEl = el.querySelector(’.step-icon’);

if (state === ‘active’) {
iconEl.outerHTML = `<div class="spinner"></div>`;
} else if (state === ‘done’) {
el.querySelector(‘div,span’)?.remove?.();
el.innerHTML = `<span class="step-icon">✓</span><span>${el.querySelector('span:last-child')?.textContent || ''}</span>`;
} else if (state === ‘error’) {
el.innerHTML = `<span class="step-icon">✗</span><span>${el.querySelector('span:last-child')?.textContent || ''}</span>`;
}
}

function setDetail(msg) {
document.getElementById(‘progress-detail’).textContent = msg;
}

function renderScenePlaceholders(count) {
const grid = document.getElementById(‘scenes-grid’);
grid.innerHTML = ‘’;
document.getElementById(‘scenes-label’).style.display = ‘block’;
for (let i = 0; i < count; i++) {
grid.innerHTML += ` <div class="scene-thumb" id="thumb-${i}"> <div class="img-placeholder">🎨</div> <span class="scene-num">SCENE ${String(i+1).padStart(2,'0')}</span> </div>`;
}
}

function fillSceneThumb(i, blob, loading) {
const el = document.getElementById(`thumb-${i}`);
if (!el) return;
if (loading) {
el.querySelector(’.img-placeholder’).textContent = ‘⏳’;
return;
}
const url = URL.createObjectURL(blob);
el.innerHTML = ` <img src="${url}" onload="this.classList.add('loaded')" /> <span class="scene-num">SCENE ${String(i+1).padStart(2,'0')}</span>`;
}

function toast(msg) {
const t = document.getElementById(‘toast’);
t.textContent = msg;
t.classList.add(‘show’);
setTimeout(() => t.classList.remove(‘show’), 4500);
}