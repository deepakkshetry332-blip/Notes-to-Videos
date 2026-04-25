// ── NoteFilm App — FREE VERSION ───────────────────────────────
// LLM:    Groq API (free) — llama-3.3-70b-versatile
// Images: Pollinations.ai (free, no key needed)
// TTS:    Web Speech API (free, built into browser)
// Video:  FFmpeg.wasm (free, runs in browser)

import { FFmpeg } from ‘https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js’;
import { fetchFile, toBlobURL } from ‘https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js’;

// ── STATE ─────────────────────────────────────────────────────
let groqKey = ‘’;
let ffmpeg = null;
let ffmpegLoaded = false;
let videoBlob = null;
let scenes = [];

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener(‘DOMContentLoaded’, () => {
groqKey = localStorage.getItem(‘nf_groq_key’) || ‘’;
if (groqKey) {
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
opt.textContent = v.name.replace(‘Google ‘, ‘’).replace(’ English’, ‘’).slice(0, 20);
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
if (val.length < 10) {
toast(‘Key looks too short — please paste the full Groq key’);
return;
}
if (!val.startsWith(‘gsk_’)) {
toast(‘Groq keys start with gsk_ — please check and try again’);
return;
}
groqKey = val;
localStorage.setItem(‘nf_groq_key’, groqKey);
showScreen(‘app-screen’);
};

window.changeKey = () => {
document.getElementById(‘api-key-input’).value = groqKey;
showScreen(‘setup-screen’);
};

window.toggleKeyVisibility = () => {
const inp = document.getElementById(‘api-key-input’);
const btn = document.getElementById(‘eye-btn’);
if (inp.type === ‘password’) {
inp.type = ‘text’;
btn.textContent = ‘🙈’;
} else {
inp.type = ‘password’;
btn.textContent = ‘👁’;
}
};

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

const sceneCount    = parseInt(document.getElementById(‘scene-count’).value);
const imageStyle    = document.getElementById(‘image-style’).value;
const sceneDuration = parseInt(document.getElementById(‘scene-duration’).value);
const voiceName     = document.getElementById(‘voice-select’).value;

showScreen(‘progress-screen’);
document.getElementById(‘scenes-grid’).innerHTML = ‘’;
document.getElementById(‘scenes-label’).style.display = ‘none’;
videoBlob = null;

// Reset steps
[‘step-parse’,‘step-images’,‘step-audio’,‘step-video’].forEach(id => {
const el = document.getElementById(id);
el.className = ‘step-item’;
el.innerHTML = `<span class="step-icon">${el.dataset.icon}</span><span>${el.dataset.label}</span>`;
});

try {
// ── STEP 1: Parse notes with Groq ──
setStep(‘step-parse’, ‘active’);
setDetail(‘Sending notes to Groq (Llama 3.3 70B)…’);
scenes = await parseNotesWithGroq(notes, sceneCount);
setStep(‘step-parse’, ‘done’);
renderScenePlaceholders(scenes.length);

```
// ── STEP 2: Generate images with Pollinations.ai ──
setStep('step-images', 'active');
setDetail('Generating images with Pollinations.ai…');
const imageBlobs = await generateImagesWithPollinations(scenes, imageStyle, (i) => {
  setDetail(`Generating image ${i + 1} of ${scenes.length}…`);
  fillSceneThumb(i, null, true);
});
setStep('step-images', 'done');
imageBlobs.forEach((blob, i) => fillSceneThumb(i, blob, false));

// ── STEP 3: TTS narration ──
setStep('step-audio', 'active');
setDetail('Synthesising narration…');
const audioBlobs = await synthesiseAudio(scenes, voiceName, (i) => {
  setDetail(`Narrating scene ${i + 1} of ${scenes.length}…`);
});
setStep('step-audio', 'done');

// ── STEP 4: Render MP4 ──
setStep('step-video', 'active');
setDetail('Loading FFmpeg (first time ~31MB, cached after)…');
await ensureFFmpeg();
setDetail('Stitching scenes into MP4…');
videoBlob = await renderVideo(imageBlobs, audioBlobs, sceneDuration, scenes);
setStep('step-video', 'done');

const totalSecs = scenes.length * sceneDuration;
document.getElementById('done-meta').textContent =
  `${scenes.length} scenes · ${totalSecs} seconds`;
showScreen('done-screen');
```

} catch (err) {
console.error(err);
toast(‘Error: ’ + (err.message || ‘Something went wrong. Check your Groq key.’));
const activeStep = document.querySelector(’.step-item.active’);
if (activeStep) activeStep.className = ‘step-item error’;
}
};

// ── GROQ: PARSE NOTES ─────────────────────────────────────────
async function parseNotesWithGroq(notes, count) {
const prompt = `You are a visual learning content designer.
Convert the following study notes into exactly ${count} concise scenes for an educational video.

For each scene return JSON with:

- “title”: short scene title (3-5 words)
- “narration”: 1-2 sentence spoken explanation (max 30 words), clear and educational
- “imagePrompt”: a vivid image description for an AI image generator showing a visual that represents this concept

Return ONLY a valid JSON array. No markdown, no code fences, no explanation.

Notes:
“””
${notes}
“””`;

const res = await fetch(‘https://api.groq.com/openai/v1/chat/completions’, {
method: ‘POST’,
headers: {
‘Content-Type’: ‘application/json’,
‘Authorization’: `Bearer ${groqKey}`
},
body: JSON.stringify({
model: ‘llama-3.3-70b-versatile’,
messages: [{ role: ‘user’, content: prompt }],
max_tokens: 2000,
temperature: 0.7
})
});

if (!res.ok) {
const err = await res.json();
throw new Error(err.error?.message || `Groq error ${res.status}`);
}

const data = await res.json();
const text = data.choices[0].message.content.trim();
const clean = text.replace(/`json|`/g, ‘’).trim();
return JSON.parse(clean);
}

// ── POLLINATIONS.AI: FREE IMAGE GENERATION ────────────────────
async function generateImagesWithPollinations(scenes, style, onProgress) {
const blobs = [];
for (let i = 0; i < scenes.length; i++) {
onProgress(i);
const prompt = encodeURIComponent(
`${scenes[i].imagePrompt}, ${style} style, high quality, educational, vibrant, detailed, no text`
);
const seed = Math.floor(Math.random() * 999999);
const url = `https://image.pollinations.ai/prompt/${prompt}?width=1280&height=720&seed=${seed}&nologo=true&enhance=true`;

```
const imgRes = await fetch(url);
if (!imgRes.ok) throw new Error(`Image failed for scene ${i + 1}`);
blobs.push(await imgRes.blob());

if (i < scenes.length - 1) await delay(500);
```

}
return blobs;
}

// ── WEB SPEECH API: TTS ───────────────────────────────────────
async function synthesiseAudio(scenes, voiceName, onProgress) {
const blobs = [];
for (let i = 0; i < scenes.length; i++) {
onProgress(i);
blobs.push(await speakToBlob(scenes[i].narration, voiceName));
}
return blobs;
}

function speakToBlob(text, voiceName) {
return new Promise((resolve) => {
try {
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const dest = audioCtx.createMediaStreamDestination();
const recorder = new MediaRecorder(dest.stream);
const chunks = [];

```
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
  recorder.start();

  const utt = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.name === voiceName)
    || voices.find(v => v.lang.startsWith('en'))
    || voices[0];
  if (voice) utt.voice = voice;
  utt.rate = 0.9;
  utt.pitch = 1.0;
  utt.onend = () => setTimeout(() => recorder.stop(), 400);
  utt.onerror = () => { recorder.stop(); resolve(makeSilentWav(3)); };
  window.speechSynthesis.speak(utt);
} catch (e) {
  resolve(makeSilentWav(3));
}
```

});
}

function makeSilentWav(sec) {
const sr = 44100, n = sr * sec;
const buf = new ArrayBuffer(44 + n * 2);
const v = new DataView(buf);
const ws = (s, o) => { for (const c of s) v.setUint8(o++, c.charCodeAt(0)); return o; };
let o = 0;
o = ws(‘RIFF’, o); v.setUint32(o, 36 + n * 2, true); o += 4;
o = ws(‘WAVE’, o); o = ws(’fmt ’, o);
v.setUint32(o, 16, true); o += 4;
v.setUint16(o, 1, true); o += 2;
v.setUint16(o, 1, true); o += 2;
v.setUint32(o, sr, true); o += 4;
v.setUint32(o, sr * 2, true); o += 4;
v.setUint16(o, 2, true); o += 2;
v.setUint16(o, 16, true); o += 2;
o = ws(‘data’, o); v.setUint32(o, n * 2, true);
return new Blob([buf], { type: ‘audio/wav’ });
}

// ── FFMPEG: RENDER MP4 ────────────────────────────────────────
async function ensureFFmpeg() {
if (ffmpegLoaded) return;
if (!ffmpeg) ffmpeg = new FFmpeg();
const base = ‘https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm’;
await ffmpeg.load({
coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, ‘text/javascript’),
wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, ‘application/wasm’),
});
ffmpegLoaded = true;
}

async function renderVideo(imageBlobs, audioBlobs, sceneDuration, scenes) {
for (let i = 0; i < imageBlobs.length; i++) {
await ffmpeg.writeFile(`img${i}.jpg`, await fetchFile(imageBlobs[i]));
await ffmpeg.writeFile(`audio${i}.webm`, await fetchFile(audioBlobs[i]));
}

const segs = [];
for (let i = 0; i < scenes.length; i++) {
setDetail(`Encoding scene ${i + 1} of ${scenes.length}…`);
const seg = `seg${i}.mp4`;
const title = escapeDrawtext(scenes[i].title || ‘’);
await ffmpeg.exec([
‘-loop’, ‘1’, ‘-i’, `img${i}.jpg`,
‘-i’, `audio${i}.webm`,
‘-c:v’, ‘libx264’, ‘-c:a’, ‘aac’, ‘-b:a’, ‘128k’,
‘-shortest’, ‘-t’, String(sceneDuration),
‘-vf’, `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,drawtext=text='${title}':fontsize=32:fontcolor=white:x=(w-text_w)/2:y=h-70:box=1:boxcolor=black@0.55:boxborderw=12`,
‘-pix_fmt’, ‘yuv420p’, ‘-r’, ‘25’, seg
]);
segs.push(seg);
}

setDetail(‘Concatenating all scenes…’);
await ffmpeg.writeFile(‘concat.txt’, segs.map(f => `file '${f}'`).join(’\n’));
await ffmpeg.exec([’-f’, ‘concat’, ‘-safe’, ‘0’, ‘-i’, ‘concat.txt’, ‘-c’, ‘copy’, ‘output.mp4’]);

const data = await ffmpeg.readFile(‘output.mp4’);
return new Blob([data.buffer], { type: ‘video/mp4’ });
}

function escapeDrawtext(t) {
return t.replace(/’/g, “\’”).replace(/:/g, ‘\:’).replace(/[[]]/g, ‘’);
}

// ── DOWNLOAD & RESET ──────────────────────────────────────────
window.downloadVideo = () => {
if (!videoBlob) return;
const url = URL.createObjectURL(videoBlob);
const a = document.createElement(‘a’);
a.href = url; a.download = ‘notefilm-video.mp4’; a.click();
setTimeout(() => URL.revokeObjectURL(url), 5000);
};

window.startOver = () => {
document.getElementById(‘notes-input’).value = ‘’;
document.getElementById(‘char-count’).textContent = ‘0’;
videoBlob = null; scenes = [];
showScreen(‘app-screen’);
};

// ── UTILS & UI ────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function setStep(id, state) {
const el = document.getElementById(id);
el.className = `step-item ${state}`;
const icons = { active: `<div class="spinner"></div>`, done: `<span class="step-icon">✓</span>`, error: `<span class="step-icon">✗</span>` };
el.innerHTML = `${icons[state]}<span>${el.dataset.label}</span>`;
}

function setDetail(msg) { document.getElementById(‘progress-detail’).textContent = msg; }

function renderScenePlaceholders(count) {
const grid = document.getElementById(‘scenes-grid’);
grid.innerHTML = ‘’;
document.getElementById(‘scenes-label’).style.display = ‘block’;
for (let i = 0; i < count; i++) {
grid.innerHTML += `<div class="scene-thumb" id="thumb-${i}"><div class="img-placeholder">🎨</div><span class="scene-num">SCENE ${String(i+1).padStart(2,'0')}</span></div>`;
}
}

function fillSceneThumb(i, blob, loading) {
const el = document.getElementById(`thumb-${i}`);
if (!el) return;
if (loading) { el.querySelector(’.img-placeholder’).textContent = ‘⏳’; return; }
const url = URL.createObjectURL(blob);
el.innerHTML = `<img src="${url}" onload="this.classList.add('loaded')" /><span class="scene-num">SCENE ${String(i+1).padStart(2,'0')}</span>`;
}

function toast(msg) {
const t = document.getElementById(‘toast’);
t.textContent = msg; t.classList.add(‘show’);
setTimeout(() => t.classList.remove(‘show’), 5000);
}
