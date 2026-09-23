const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------- API routing ---------------- */
const configuredApiBase = String(window.NATURALFIX_CONFIG?.API_BASE_URL || '').trim().replace(/\/$/, '');
function apiUrl(path) {
  const cleanPath = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  return configuredApiBase ? `${configuredApiBase}${cleanPath}` : cleanPath;
}
function apiFetch(path, options) { return fetch(apiUrl(path), options); }


/* ---------------- PWA / health ---------------- */
let deferredInstall = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
}
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  $('installButton').style.display = 'block';
});
$('installButton').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('installButton').style.display = 'none';
});
window.addEventListener('appinstalled', () => {
  $('installHint').textContent = '✅ ホーム画面への追加が完了したよ';
});

async function refreshHealth() {
  try {
    const r = await apiFetch('/api/health');
    const h = await r.json();
    $('health').innerHTML = [
      ['ComfyUI', h.comfy],
      ['Dolphin', h.dolphin],
      ['Turbo Workflow', h.turboWorkflow],
      ['2-Pass Workflow', h.twoPassWorkflow],
      ['LoRA Train', h.loraTraining]
    ].map(([name, ok]) => `<span class="badge">${ok ? '✅' : '⚠️'} ${name}</span>`).join('');
  } catch {
    $('health').innerHTML = '<span class="badge">⚠️ サーバー未接続</span>';
  }
  if (!window.isSecureContext) {
    $('installHint').textContent = '📌 PWAとしてホーム画面に追加するには、GalaxyからHTTPSで開いてね（localhostだけは例外）。';
  } else if (!deferredInstall) {
    $('installHint').textContent = '📌 インストールボタンが出ない場合は、ブラウザのメニュー →「ホーム画面に追加 / アプリをインストール」を使ってね。';
  }
}
refreshHealth();

/* ---------------- Canvas editor ---------------- */
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const sourceImage = new Image();
let loaded = false;
let baseW = 1;
let baseH = 1;
let flip = false;
let rotateExtra = 0;
let rafId = 0;
let faceLandmarker = null;
let currentLandmarks = null;
let faceAnalysis = null;
let poseLandmarker = null;
let handLandmarker = null;
let currentPoseLandmarks = null;
let currentHands = [];
let selectedPartDataUrl = null;
let extractedParts = new Map();

const controls = {
  natural: $('natural'), brightness: $('brightness'), contrast: $('contrast'), saturation: $('saturation'), sharp: $('sharp'), rotate: $('rotate')
};
const valueLabels = {
  natural: $('naturalValue'), brightness: $('brightnessValue'), contrast: $('contrastValue'), saturation: $('saturationValue'), sharp: $('sharpValue'), rotate: $('rotateValue')
};

function updateLabels() {
  valueLabels.natural.textContent = controls.natural.value;
  valueLabels.brightness.textContent = controls.brightness.value;
  valueLabels.contrast.textContent = controls.contrast.value;
  valueLabels.saturation.textContent = controls.saturation.value;
  valueLabels.sharp.textContent = controls.sharp.value;
  valueLabels.rotate.textContent = `${controls.rotate.value}°`;
}

function resetControls() {
  controls.natural.value = 0;
  controls.brightness.value = 100;
  controls.contrast.value = 100;
  controls.saturation.value = 100;
  controls.sharp.value = 0;
  controls.rotate.value = 0;
  flip = false;
  rotateExtra = 0;
  updateLabels();
}

function syncCanvasDimensions() {
  const r = ((rotateExtra % 360) + 360) % 360;
  if (r === 90 || r === 270) {
    canvas.width = baseH;
    canvas.height = baseW;
  } else {
    canvas.width = baseW;
    canvas.height = baseH;
  }
}

function scheduleDraw() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => drawImage(false));
}

function applySharpness() {
  const value = Number(controls.sharp.value);
  if (!value) return;
  const amount = value / 100;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const copy = new Uint8ClampedArray(data);
  const w = canvas.width;
  const h = canvas.height;
  for (let y = 1; y < h - 1; y += 1) {
    let i = (y * w + 1) * 4;
    for (let x = 1; x < w - 1; x += 1, i += 4) {
      for (let c = 0; c < 3; c += 1) {
        const center = copy[i + c];
        const sharp = center * 5 - copy[i - 4 + c] - copy[i + 4 + c] - copy[i - w * 4 + c] - copy[i + w * 4 + c];
        data[i + c] = Math.max(0, Math.min(255, center * (1 - amount) + sharp * amount));
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function transformLandmark(p) {
  let x = p.x * baseW - baseW / 2;
  let y = p.y * baseH - baseH / 2;
  if (flip) x *= -1;
  const angle = (Number(controls.rotate.value) + rotateExtra) * Math.PI / 180;
  const rx = x * Math.cos(angle) - y * Math.sin(angle);
  const ry = x * Math.sin(angle) + y * Math.cos(angle);
  return { x: rx + canvas.width / 2, y: ry + canvas.height / 2 };
}

function avgPoint(indices, landmarks) {
  let x = 0, y = 0;
  for (const i of indices) { x += landmarks[i].x; y += landmarks[i].y; }
  return { x: x / indices.length, y: y / indices.length };
}
function drawLine(a, b, color, width = 2) { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore(); }
function drawPoint(p, color, radius = 4) { ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }

const contourPairs = [[127,356],[234,454],[93,323],[132,361],[58,288],[172,397],[136,365],[150,379],[149,378],[176,400],[148,377]];
function drawGuides(landmarks) {
  if ($('showGuide').checked) {
    const le = transformLandmark(avgPoint([33,133,159,145], landmarks));
    const re = transformLandmark(avgPoint([362,263,386,374], landmarks));
    const nose = transformLandmark(landmarks[1]);
    const forehead = transformLandmark(landmarks[10]);
    const chin = transformLandmark(landmarks[152]);
    drawLine(le, re, '#00ffd0'); drawLine(forehead, chin, '#ffd166'); drawPoint(le, '#00ffd0', 5); drawPoint(re, '#00ffd0', 5); drawPoint(nose, '#ffd166', 5);
  }
  if ($('showDistortion').checked) {
    for (const [l, r] of contourPairs) {
      const a = transformLandmark(landmarks[l]); const b = transformLandmark(landmarks[r]);
      drawLine(a, b, '#ff9f43', 1); drawPoint(a, '#ffae64', 2.5); drawPoint(b, '#ffae64', 2.5);
    }
  }
}

function drawImage(finalRender = false) {
  if (!loaded) return;
  syncCanvasDimensions();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const natural = Number(controls.natural.value) / 100;
  const brightness = Number(controls.brightness.value) * (1 - natural) + 100 * natural;
  const contrast = Number(controls.contrast.value) * (1 - natural) + 94 * natural;
  const saturation = Number(controls.saturation.value) * (1 - natural) + 90 * natural;
  ctx.save();
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((Number(controls.rotate.value) + rotateExtra) * Math.PI / 180);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(sourceImage, -baseW / 2, -baseH / 2, baseW, baseH);
  ctx.restore();
  if (finalRender || !$('fastPreview').checked) applySharpness();
  if (currentLandmarks) drawGuides(currentLandmarks);
  if (currentPoseLandmarks && $('showPoseGuide')?.checked) drawPoseGuides(currentPoseLandmarks);
  if (currentHands?.length && $('showHandGuide')?.checked) drawHandGuides(currentHands);
}

async function exportCurrentDataURL(quality = 0.92) {
  if (!loaded) return null;
  drawImage(true);
  const out = canvas.toDataURL('image/jpeg', quality);
  scheduleDraw();
  return out;
}

function loadImageData(src) {
  return new Promise((resolve, reject) => {
    sourceImage.onload = async () => {
      loaded = true;
      const maxSize = 1200;
      const ratio = Math.min(1, maxSize / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
      baseW = Math.max(1, Math.round(sourceImage.naturalWidth * ratio));
      baseH = Math.max(1, Math.round(sourceImage.naturalHeight * ratio));
      currentLandmarks = null; faceAnalysis = null; currentPoseLandmarks = null; currentHands = []; selectedPartDataUrl = null; extractedParts.clear();
      resetControls(); syncCanvasDimensions(); drawImage(false);
      await analyzeFace(true).catch(() => {});
      resolve();
    };
    sourceImage.onerror = reject;
    sourceImage.src = src;
  });
}

$('fileInput').addEventListener('change', (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  const reader = new FileReader(); reader.onload = () => loadImageData(reader.result); reader.readAsDataURL(file);
});
Object.values(controls).forEach((el) => el.addEventListener('input', () => { updateLabels(); scheduleDraw(); }));
$('showGuide').addEventListener('change', scheduleDraw); $('showDistortion').addEventListener('change', scheduleDraw);
$('flipButton').addEventListener('click', () => { if (!loaded) return; flip = !flip; scheduleDraw(); });
$('rotate90Button').addEventListener('click', () => { if (!loaded) return; rotateExtra = (rotateExtra + 90) % 360; syncCanvasDimensions(); scheduleDraw(); });
$('resetButton').addEventListener('click', () => { if (!loaded) return; resetControls(); syncCanvasDimensions(); scheduleDraw(); });
$('autoFixButton').addEventListener('click', () => {
  if (!loaded) return; controls.natural.value = 55; controls.brightness.value = 102; controls.contrast.value = 96; controls.saturation.value = 92; controls.sharp.value = 8;
  if (faceAnalysis && $('autoFaceTilt').checked) controls.rotate.value = Math.max(-20, Math.min(20, -faceAnalysis.tilt)).toFixed(1);
  updateLabels(); scheduleDraw();
});
$('downloadButton').addEventListener('click', async () => {
  const data = await exportCurrentDataURL(0.95); if (!data) return;
  const a = document.createElement('a'); a.href = data; a.download = `NaturalFix_${Date.now()}.jpg`; a.click();
});

/* ---------------- Face analysis ---------------- */
async function initFaceModel() {
  try {
    const { FilesetResolver, FaceLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm');
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
      runningMode: 'IMAGE', numFaces: 1
    });
    $('modelStatus').textContent = '✅ 顔解析AI準備OK';
  } catch (e) {
    console.error(e); $('modelStatus').textContent = '⚠️ 顔解析AIを読み込めなかったよ（画像補正は使える）';
  }
}
initFaceModel();

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function calculateFaceAnalysis(landmarks) {
  const le = avgPoint([33,133,159,145], landmarks); const re = avgPoint([362,263,386,374], landmarks);
  const dx = re.x - le.x; const dy = re.y - le.y; const tilt = Math.atan2(dy, dx) * 180 / Math.PI;
  const eyeDifference = Math.abs(dy * baseH); const nose = landmarks[1]; const left = landmarks[234]; const right = landmarks[454];
  const ratio = dist(left, nose) / Math.max(0.00001, dist(right, nose)); const faceWidth = Math.max(0.00001, dist(left, right));
  let sum = 0; for (const [li, ri] of contourPairs) sum += Math.abs(Math.abs(nose.x - landmarks[li].x) - Math.abs(landmarks[ri].x - nose.x)) / faceWidth;
  const distortion = Math.min(100, (sum / contourPairs.length) * 500);
  return { tilt, eyeDifference, ratio, distortion };
}
function showFaceAnalysis() {
  if (!faceAnalysis) return;
  $('tiltResult').textContent = `${faceAnalysis.tilt.toFixed(2)}°`;
  $('eyeResult').textContent = `${faceAnalysis.eyeDifference.toFixed(1)} px`;
  const symmetry = faceAnalysis.ratio > .95 && faceAnalysis.ratio < 1.05 ? '自然' : faceAnalysis.ratio > .88 && faceAnalysis.ratio < 1.12 ? '軽い左右差' : '左右差あり';
  $('symmetryResult').textContent = `${symmetry} / ${faceAnalysis.ratio.toFixed(3)}`;
  const d = faceAnalysis.distortion; $('distortionScore').textContent = `${d.toFixed(1)} / 100`;
  $('distortionResult').textContent = d < 10 ? 'ほぼ自然' : d < 20 ? '軽い左右差' : d < 35 ? 'やや大きな左右差' : '大きな左右差候補';
  const s = []; if (Math.abs(faceAnalysis.tilt) > 1) s.push('傾き補正'); if (d >= 20) s.push('輪郭確認'); if (faceAnalysis.eyeDifference > 8) s.push('目の高さ確認');
  $('suggestResult').textContent = s.length ? s.join('・') : '大きな補正は不要';
}
async function analyzeFace(silent = false) {
  if (!loaded || !faceLandmarker) return;
  if (!silent) $('modelStatus').textContent = '🔍 顔解析中…';
  const result = faceLandmarker.detect(sourceImage);
  if (!result.faceLandmarks?.length) { currentLandmarks = null; $('modelStatus').textContent = '顔を検出できなかったよ'; scheduleDraw(); return; }
  currentLandmarks = result.faceLandmarks[0]; faceAnalysis = calculateFaceAnalysis(currentLandmarks); showFaceAnalysis();
  if ($('autoFaceTilt').checked) { controls.rotate.value = Math.max(-20, Math.min(20, -faceAnalysis.tilt)).toFixed(1); updateLabels(); }
  scheduleDraw(); $('modelStatus').textContent = '✅ 顔解析完了';
}
$('analyzeButton').addEventListener('click', () => analyzeFace(false));

/* ---------------- Multi references / generation ---------------- */
let generationMode = 'realistic';
const refData = [null, null, null];
$('realisticButton').addEventListener('click', () => setMode('realistic'));
$('animeButton').addEventListener('click', () => setMode('anime'));
function setMode(mode) { generationMode = mode; $('realisticButton').classList.toggle('active', mode === 'realistic'); $('animeButton').classList.toggle('active', mode === 'anime'); }
for (let i = 1; i <= 3; i += 1) {
  $(`refInput${i}`).addEventListener('change', (event) => {
    const file = event.target.files?.[0]; if (!file) { refData[i - 1] = null; return; }
    const reader = new FileReader(); reader.onload = () => { refData[i - 1] = reader.result; const img = $(`refPreview${i}`); img.src = reader.result; img.style.display = 'block'; }; reader.readAsDataURL(file);
  });
  $(`refStrength${i}`).addEventListener('input', () => { $(`refStrengthValue${i}`).textContent = $(`refStrength${i}`).value; });
}
['samplerSteps','samplerBoundary','rawCfg','turboCfg','loraStrength','loraRank','loraSteps'].forEach((id) => {
  const map = { samplerSteps:'samplerStepsValue', samplerBoundary:'samplerBoundaryValue', rawCfg:'rawCfgValue', turboCfg:'turboCfgValue', loraStrength:'loraStrengthValue', loraRank:'loraRankValue', loraSteps:'loraStepsValue' };
  $(id).addEventListener('input', () => {
    const val = id === 'loraStrength' ? Number($(id).value).toFixed(2) : $(id).value; $(map[id]).textContent = val;
    if (id === 'samplerSteps') { const max = Math.max(1, Number($(id).value) - 1); $('samplerBoundary').max = String(max); if (Number($('samplerBoundary').value) > max) $('samplerBoundary').value = String(max); $('samplerBoundaryValue').textContent = $('samplerBoundary').value; }
  });
});

function collectReferences() {
  const refs = [];
  for (let i = 1; i <= 3; i += 1) {
    if (!refData[i - 1]) continue;
    refs.push({ image: refData[i - 1], role: $(`refRole${i}`).value, strength: Number($(`refStrength${i}`).value) });
  }
  return refs;
}

async function refreshLoras() {
  try {
    const r = await apiFetch('/api/loras'); const data = await r.json(); const select = $('loraSelector'); const previous = select.value;
    select.innerHTML = '<option value="">LoRAなし</option>' + (data.items || []).map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  } catch (e) { console.error(e); }
}
$('refreshLoraButton').addEventListener('click', refreshLoras); refreshLoras();

function escapeHtml(text) { const d = document.createElement('div'); d.textContent = String(text); return d.innerHTML; }

$('generateButton').addEventListener('click', async () => {
  const prompt = $('multiRefPrompt').value.trim();
  if (!prompt) { $('generationStatus').textContent = '編集指示を入力してね'; return; }
  $('generateButton').disabled = true; $('generationStatus').textContent = '🧬 生成・融合編集を開始…';
  try {
    const baseImage = loaded ? await exportCurrentDataURL(0.92) : null;
    const references = collectReferences();
    const payload = {
      prompt, baseImage, references, mode: generationMode, pose: $('posePreset').value,
      performance: $('performanceMode').value, seed: Number($('seed').value || 42), useDolphin: $('useDolphin').checked,
      sampler: {
        enabled: $('twoSamplerEnabled').checked,
        pass1: $('samplerPass1').value, pass2: $('samplerPass2').value,
        steps: Number($('samplerSteps').value), boundary: Number($('samplerBoundary').value),
        rawCfg: Number($('rawCfg').value), turboCfg: Number($('turboCfg').value)
      },
      lora: { name: $('loraSelector').value, strength: Number($('loraStrength').value) }, width: 1024, height: 1024
    };
    const r = await apiFetch('/api/generate', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    const result = await r.json(); if (!r.ok) throw new Error(result.error || 'generation failed');
    $('generatedArea').innerHTML = `<img id="generatedImage" alt="generated result"><div class="buttons" style="margin-top:8px"><button id="editGeneratedButton" class="green">✏️ NaturalFixで編集</button><button id="downloadGeneratedButton" class="green">💾 保存</button></div>`;
    $('generatedImage').src = result.image;
    $('editGeneratedButton').addEventListener('click', async () => { await loadImageData(result.image); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('downloadGeneratedButton').addEventListener('click', () => { const a = document.createElement('a'); a.href = result.image; a.download = `NaturalFix_AI_${Date.now()}.png`; a.click(); });
    $('generationStatus').textContent = result.twoPass ? '✅ 2パス生成完了' : '✅ Turbo生成完了';
  } catch (e) { console.error(e); $('generationStatus').textContent = `⚠️ ${e.message}`; }
  finally { $('generateButton').disabled = false; }
});

/* ---------------- LoRA training ---------------- */
let trainingPoll = null;
$('trainLoraButton').addEventListener('click', async () => {
  const files = [...$('loraDataset').files]; const name = $('loraName').value.trim(); const trigger = $('triggerWord').value.trim();
  if (!files.length || !name || !trigger) { $('trainingStatus').textContent = '画像・LoRA名・トリガーワードを入れてね'; return; }
  const form = new FormData(); files.forEach((f) => form.append('images', f)); form.append('name', name); form.append('trigger', trigger); form.append('rank', $('loraRank').value); form.append('steps', $('loraSteps').value);
  $('trainLoraButton').disabled = true; $('trainingStatus').textContent = '🧠 学習ジョブ開始…'; $('trainingProgress').style.width = '8%';
  try {
    const r = await apiFetch('/api/lora/train', { method:'POST', body:form }); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'train start failed');
    if (trainingPoll) clearInterval(trainingPoll);
    trainingPoll = setInterval(() => pollTraining(data.jobId), 3000); await pollTraining(data.jobId);
  } catch (e) { $('trainingStatus').textContent = `⚠️ ${e.message}`; $('trainLoraButton').disabled = false; }
});
async function pollTraining(id) {
  try {
    const r = await apiFetch(`/api/lora/train/${encodeURIComponent(id)}`); const job = await r.json(); if (!r.ok) throw new Error(job.error);
    $('trainingStatus').textContent = `状態: ${job.status}${job.output ? ` / ${job.output}` : ''}`;
    $('trainingLogs').textContent = (job.logs || []).slice(-6).join(' | ');
    const log = (job.logs || []).slice(-20).join(' '); const m = log.match(/(\d{1,3})%/g); if (m?.length) $('trainingProgress').style.width = `${Math.min(99, Number(m.at(-1).replace('%','')))}%`;
    else if (job.status === 'running') $('trainingProgress').style.width = '35%';
    if (job.status === 'completed' || job.status === 'failed') {
      clearInterval(trainingPoll); trainingPoll = null; $('trainLoraButton').disabled = false; $('trainingProgress').style.width = job.status === 'completed' ? '100%' : '0%'; if (job.error) $('trainingStatus').textContent += ` / ${job.error}`; if (job.status === 'completed') refreshLoras();
    }
  } catch (e) { clearInterval(trainingPoll); trainingPoll = null; $('trainLoraButton').disabled = false; $('trainingStatus').textContent = `⚠️ ${e.message}`; }
}

/* ---------------- IndexedDB galleries ---------------- */
let db = null;
function openDb() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('NaturalFixDB', 3);
    req.onupgradeneeded = (event) => {
      const d = event.target.result;
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath:'id', autoIncrement:true });
      if (!d.objectStoreNames.contains('r18Images')) d.createObjectStore('r18Images', { keyPath:'id', autoIncrement:true });
    };
    req.onsuccess = () => { db = req.result; resolve(db); }; req.onerror = () => reject(req.error);
  });
}
function idbGetAll(storeName) { return openDb().then((d) => new Promise((resolve,reject) => { const req = d.transaction(storeName,'readonly').objectStore(storeName).getAll(); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); })); }
function idbAdd(storeName, value) { return openDb().then((d) => new Promise((resolve,reject) => { const tx=d.transaction(storeName,'readwrite'); tx.objectStore(storeName).add(value); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); })); }
function idbDelete(storeName, id) { return openDb().then((d) => new Promise((resolve,reject) => { const tx=d.transaction(storeName,'readwrite'); tx.objectStore(storeName).delete(id); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); })); }

async function renderGallery() {
  const items = (await idbGetAll('images')).sort((a,b)=>b.createdAt-a.createdAt); const g=$('gallery'); g.innerHTML='';
  if (!items.length) { g.innerHTML='<div class="empty">まだ画像はないよ</div>'; return; }
  for (const item of items) {
    const div=document.createElement('div'); div.className='gallery-item'; div.innerHTML=`<img><div class="small">${new Date(item.createdAt).toLocaleString()}</div><div class="gallery-actions"><button class="primary">開く</button><button>削除</button></div>`; div.querySelector('img').src=item.image;
    const [open,del]=div.querySelectorAll('button'); open.onclick=()=>{loadImageData(item.image);window.scrollTo({top:0,behavior:'smooth'});}; del.onclick=async()=>{await idbDelete('images',item.id);renderGallery();}; g.appendChild(div);
  }
}
$('saveGalleryButton').addEventListener('click', async()=>{const image=await exportCurrentDataURL(.9);if(!image)return;await idbAdd('images',{image,createdAt:Date.now()});renderGallery();});
$('saveGeneratedGalleryButton').addEventListener('click', async()=>{const img=$('generatedImage');if(!img){return alert('生成結果がまだないよ');}await idbAdd('images',{image:img.src,createdAt:Date.now()});renderGallery();});

/* ---------------- PIN encrypted private vault ---------------- */
const enc = new TextEncoder();
const PIN_SALT='nf_vault_salt_v2'; const PIN_VERIFIER='nf_vault_verifier_v2';
let vaultKey=null; let vaultUnlocked=false; let pendingVaultSave=false; const privateUrls=new Set();
function bytesToB64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);} function b64ToBytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function deriveVaultMaterial(pin,salt){const base=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},base,512));const key=await crypto.subtle.importKey('raw',bits.slice(0,32),'AES-GCM',false,['encrypt','decrypt']);return{key,verifier:bytesToB64(bits.slice(32,64))};}
function showPinModal(){const isSetup=!localStorage.getItem(PIN_VERIFIER);$('pinTitle').textContent=isSetup?'🔐 4桁PINを設定':'🔐 PINで解除';$('pinMessage').textContent=isSetup?'新しい4桁PINを入力してね':'4桁PINを入力してね';$('pinConfirm').textContent=isSetup?'PIN設定':'解除';$('pinInput').value='';$('pinModal').style.display='flex';setTimeout(()=>$('pinInput').focus(),100);}
function closePinModal(){ $('pinModal').style.display='none'; $('pinInput').value=''; if(!vaultUnlocked) pendingVaultSave=false; }
$('pinInput').addEventListener('input',()=>{$('pinInput').value=$('pinInput').value.replace(/\D/g,'').slice(0,4);});
$('pinCancel').addEventListener('click',closePinModal); $('openVaultButton').addEventListener('click',()=>{if(!window.crypto?.subtle){alert('PIN暗号化保管庫はHTTPSで開いてね');return;}if(vaultUnlocked)return renderPrivateGallery();showPinModal();});
$('pinConfirm').addEventListener('click',async()=>{const pin=$('pinInput').value;if(!/^\d{4}$/.test(pin)){return $('pinMessage').textContent='4桁の数字を入力してね';}let saltB64=localStorage.getItem(PIN_SALT);if(!saltB64){const salt=crypto.getRandomValues(new Uint8Array(16));saltB64=bytesToB64(salt);localStorage.setItem(PIN_SALT,saltB64);}const material=await deriveVaultMaterial(pin,b64ToBytes(saltB64));const stored=localStorage.getItem(PIN_VERIFIER);if(stored&&stored!==material.verifier){$('pinMessage').textContent='PINが違うよ';$('pinInput').value='';return;}if(!stored)localStorage.setItem(PIN_VERIFIER,material.verifier);vaultKey=material.key;vaultUnlocked=true;$('pinModal').style.display='none';$('vaultStatus').textContent='🔓 UNLOCKED';await renderPrivateGallery();if(pendingVaultSave){pendingVaultSave=false;await saveCurrentToVault();}});
function revokePrivateUrls(){for(const u of privateUrls)URL.revokeObjectURL(u);privateUrls.clear();}
function lockVault(){vaultKey=null;vaultUnlocked=false;revokePrivateUrls();$('vaultStatus').textContent='🔒 LOCKED';$('privateGallery').innerHTML='<div class="empty">ロックされています</div>';}
$('lockVaultButton').addEventListener('click',lockVault);
async function encryptDataUrl(dataUrl){const blob=await (await fetch(dataUrl)).blob();const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},vaultKey,await blob.arrayBuffer());return{data,iv:[...iv],mime:blob.type||'image/jpeg'};}
async function decryptItem(item){const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(item.iv)},vaultKey,item.data);return new Blob([raw],{type:item.mime||'image/jpeg'});}
async function saveCurrentToVault(){if(!window.crypto?.subtle)return alert('PIN暗号化保管庫はHTTPSで開いてね');if(!loaded)return alert('先に画像を読み込んでね');if(!vaultUnlocked){pendingVaultSave=true;showPinModal();return;}const image=await exportCurrentDataURL(.9);const encrypted=await encryptDataUrl(image);await idbAdd('r18Images',{...encrypted,createdAt:Date.now()});await renderPrivateGallery();}
$('saveVaultButton').addEventListener('click',saveCurrentToVault);
async function renderPrivateGallery(){if(!vaultUnlocked)return;revokePrivateUrls();const items=(await idbGetAll('r18Images')).sort((a,b)=>b.createdAt-a.createdAt);const g=$('privateGallery');g.innerHTML='';if(!items.length){g.innerHTML='<div class="empty">まだ保存画像はないよ</div>';return;}for(const item of items){try{const blob=await decryptItem(item);const url=URL.createObjectURL(blob);privateUrls.add(url);const div=document.createElement('div');div.className='gallery-item';div.innerHTML=`<img><div class="small">${new Date(item.createdAt).toLocaleString()}</div><div class="gallery-actions"><button class="primary">編集</button><button>削除</button></div>`;div.querySelector('img').src=url;const[open,del]=div.querySelectorAll('button');open.onclick=()=>{loadImageData(url);window.scrollTo({top:0,behavior:'smooth'});};del.onclick=async()=>{if(confirm('この画像を削除する？')){await idbDelete('r18Images',item.id);renderPrivateGallery();}};g.appendChild(div);}catch(e){console.error(e);}}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&vaultUnlocked){lockVault();$('privacyShield').style.display='flex';}});$('privacyShield').addEventListener('click',()=>{$('privacyShield').style.display='none';});


/* ---------------- Video character part studio ---------------- */
const PART_LABELS = {
  head:'頭部・髪', face:'顔全体', left_eye:'左目', right_eye:'右目', left_eyebrow:'左眉', right_eyebrow:'右眉', nose:'鼻', mouth:'口・唇', left_ear:'左耳', right_ear:'右耳',
  upper_body:'上半身全体', shoulders:'両肩', torso:'胴体', left_upper_arm:'左上腕', right_upper_arm:'右上腕', left_forearm:'左前腕', right_forearm:'右前腕', left_hand:'左手・指', right_hand:'右手・指',
  hips:'腰・ヒップライン', left_thigh:'左太もも', right_thigh:'右太もも', left_calf:'左すね・ふくらはぎ', right_calf:'右すね・ふくらはぎ', left_foot:'左足', right_foot:'右足', full_body:'全身'
};
const FACE_PART_INDICES = {
  left_eye:[33,133,159,145,160,144,158,153], right_eye:[362,263,386,374,387,373,385,380],
  left_eyebrow:[70,63,105,66,107], right_eyebrow:[300,293,334,296,336], nose:[1,2,98,327,168,195], mouth:[61,291,13,14,78,308,0,17]
};
const POSE_CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[24,26],[26,28],[28,30],[30,32]];
const HAND_CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

async function initCharacterPartModels() {
  try {
    const { FilesetResolver, PoseLandmarker, HandLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm');
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions:{ modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
      runningMode:'IMAGE', numPoses:1
    });
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions:{ modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' },
      runningMode:'IMAGE', numHands:2, minHandDetectionConfidence:0.35, minHandPresenceConfidence:0.35
    });
    if ($('characterPartStatus')) $('characterPartStatus').textContent = '✅ 顔・体・手の解析AI準備OK';
  } catch (e) {
    console.error(e);
    if ($('characterPartStatus')) $('characterPartStatus').textContent = '⚠️ 体/手解析AIを読み込めなかったよ。顔パーツ抽出は利用できるよ';
  }
}

function drawPoseGuides(landmarks) {
  for (const [a,b] of POSE_CONNECTIONS) {
    if (!landmarks[a] || !landmarks[b]) continue;
    const p1=transformLandmark(landmarks[a]); const p2=transformLandmark(landmarks[b]);
    drawLine(p1,p2,'#8ba8ff',2); drawPoint(p1,'#b7c6ff',3); drawPoint(p2,'#b7c6ff',3);
  }
}
function drawHandGuides(hands) {
  for (const hand of hands) {
    for (const [a,b] of HAND_CONNECTIONS) {
      if (!hand.landmarks[a] || !hand.landmarks[b]) continue;
      drawLine(transformLandmark(hand.landmarks[a]), transformLandmark(hand.landmarks[b]), '#6fffd2', 1.5);
    }
    for (const p of hand.landmarks) drawPoint(transformLandmark(p),'#6fffd2',2);
  }
}

function clamp01(v){return Math.max(0,Math.min(1,v));}
function bboxFromPoints(points, padX=0.08, padY=0.08) {
  const good=(points||[]).filter(p=>p && Number.isFinite(p.x) && Number.isFinite(p.y)); if (!good.length) return null;
  let minX=Math.min(...good.map(p=>p.x)), maxX=Math.max(...good.map(p=>p.x)), minY=Math.min(...good.map(p=>p.y)), maxY=Math.max(...good.map(p=>p.y));
  const w=Math.max(.015,maxX-minX), h=Math.max(.015,maxY-minY);
  minX=clamp01(minX-w*padX); maxX=clamp01(maxX+w*padX); minY=clamp01(minY-h*padY); maxY=clamp01(maxY+h*padY);
  return {x:minX,y:minY,w:Math.max(.01,maxX-minX),h:Math.max(.01,maxY-minY)};
}
function expandBox(box,left=.1,top=.1,right=.1,bottom=.1){if(!box)return null;const x1=clamp01(box.x-box.w*left),y1=clamp01(box.y-box.h*top),x2=clamp01(box.x+box.w+box.w*right),y2=clamp01(box.y+box.h+box.h*bottom);return{x:x1,y:y1,w:Math.max(.01,x2-x1),h:Math.max(.01,y2-y1)};}
function centeredBox(point, w, h){if(!point)return null;const x1=clamp01(point.x-w/2),y1=clamp01(point.y-h/2),x2=clamp01(point.x+w/2),y2=clamp01(point.y+h/2);return{x:x1,y:y1,w:x2-x1,h:y2-y1};}
function posePoints(indices){if(!currentPoseLandmarks)return [];return indices.map(i=>currentPoseLandmarks[i]).filter(p=>p && (p.visibility==null || p.visibility>.15));}
function facePoints(indices){if(!currentLandmarks)return [];return indices.map(i=>currentLandmarks[i]).filter(Boolean);}
function findHand(side){return currentHands.find(h=>String(h.side).toLowerCase()===side.toLowerCase()) || null;}

function getPartBox(partId) {
  const faceBox=currentLandmarks?bboxFromPoints(currentLandmarks,.05,.06):null;
  switch(partId){
    case 'face': return faceBox;
    case 'head': return faceBox ? expandBox(faceBox,.25,.65,.25,.08) : null;
    case 'left_eye': case 'right_eye': case 'left_eyebrow': case 'right_eyebrow': case 'nose': case 'mouth': return bboxFromPoints(facePoints(FACE_PART_INDICES[partId]),.55,.8);
    case 'left_ear': return faceBox&&currentLandmarks ? centeredBox(currentLandmarks[234],faceBox.w*.28,faceBox.h*.34):null;
    case 'right_ear': return faceBox&&currentLandmarks ? centeredBox(currentLandmarks[454],faceBox.w*.28,faceBox.h*.34):null;
    case 'upper_body': return expandBox(bboxFromPoints(posePoints([0,11,12,13,14,15,16,23,24]),.08,.08),.08,.15,.08,.08);
    case 'shoulders': return expandBox(bboxFromPoints(posePoints([11,12]),.35,.7),.1,.2,.1,.35);
    case 'torso': return expandBox(bboxFromPoints(posePoints([11,12,23,24]),.12,.12),.08,.08,.08,.08);
    case 'left_upper_arm': return expandBox(bboxFromPoints(posePoints([11,13]),.5,.35),.12,.12,.12,.12);
    case 'right_upper_arm': return expandBox(bboxFromPoints(posePoints([12,14]),.5,.35),.12,.12,.12,.12);
    case 'left_forearm': return expandBox(bboxFromPoints(posePoints([13,15]),.55,.35),.12,.12,.12,.12);
    case 'right_forearm': return expandBox(bboxFromPoints(posePoints([14,16]),.55,.35),.12,.12,.12,.12);
    case 'left_hand': {const h=findHand('Left'); if(h)return expandBox(bboxFromPoints(h.landmarks,.15,.15),.15,.15,.15,.15); const wrist=currentPoseLandmarks?.[15]; return wrist?centeredBox(wrist,.18,.18):null;}
    case 'right_hand': {const h=findHand('Right'); if(h)return expandBox(bboxFromPoints(h.landmarks,.15,.15),.15,.15,.15,.15); const wrist=currentPoseLandmarks?.[16]; return wrist?centeredBox(wrist,.18,.18):null;}
    case 'hips': return expandBox(bboxFromPoints(posePoints([23,24]),.5,.8),.1,.3,.1,.45);
    case 'left_thigh': return expandBox(bboxFromPoints(posePoints([23,25]),.55,.25),.15,.15,.15,.15);
    case 'right_thigh': return expandBox(bboxFromPoints(posePoints([24,26]),.55,.25),.15,.15,.15,.15);
    case 'left_calf': return expandBox(bboxFromPoints(posePoints([25,27]),.55,.25),.15,.15,.15,.15);
    case 'right_calf': return expandBox(bboxFromPoints(posePoints([26,28]),.55,.25),.15,.15,.15,.15);
    case 'left_foot': return expandBox(bboxFromPoints(posePoints([27,29,31]),.35,.35),.2,.2,.2,.2);
    case 'right_foot': return expandBox(bboxFromPoints(posePoints([28,30,32]),.35,.35),.2,.2,.2,.2);
    case 'full_body': return currentPoseLandmarks ? expandBox(bboxFromPoints(currentPoseLandmarks.filter(p=>p && (p.visibility==null || p.visibility>.1)),.05,.04),.05,.05,.05,.05) : null;
    default:return null;
  }
}

function cropPartDataUrl(partId, maxDim=900) {
  if (!loaded) return null; const box=getPartBox(partId); if(!box)return null;
  const sw=sourceImage.naturalWidth, sh=sourceImage.naturalHeight;
  const sx=Math.max(0,Math.floor(box.x*sw)), sy=Math.max(0,Math.floor(box.y*sh)); const cw=Math.max(2,Math.floor(box.w*sw)), ch=Math.max(2,Math.floor(box.h*sh));
  const scale=Math.min(1,maxDim/Math.max(cw,ch)); const out=document.createElement('canvas'); out.width=Math.max(2,Math.round(cw*scale)); out.height=Math.max(2,Math.round(ch*scale));
  const octx=out.getContext('2d'); octx.imageSmoothingQuality='high'; octx.drawImage(sourceImage,sx,sy,cw,ch,0,0,out.width,out.height); return out.toDataURL('image/png');
}

async function analyzeCharacterParts(silent=false) {
  if(!loaded){if(!silent)alert('先に画像を読み込んでね');return;}
  if(!silent)$('characterPartStatus').textContent='🧩 顔・体・手を解析中…';
  if(!currentLandmarks && faceLandmarker) await analyzeFace(true).catch(()=>{});
  try{if(poseLandmarker){const r=poseLandmarker.detect(sourceImage);currentPoseLandmarks=r.landmarks?.[0]||null;}}catch(e){console.error(e);currentPoseLandmarks=null;}
  try{if(handLandmarker){const r=handLandmarker.detect(sourceImage);currentHands=(r.landmarks||[]).map((landmarks,i)=>({landmarks,side:r.handedness?.[i]?.[0]?.categoryName||`Hand${i+1}`}));}}catch(e){console.error(e);currentHands=[];}
  const bits=[currentLandmarks?'顔✅':'顔—',currentPoseLandmarks?'体✅':'体—',currentHands.length?`手${currentHands.length}個✅`:'手—'];
  $('characterPartStatus').innerHTML=`${bits.join(' / ')}<div class="part-detect-badges"><span>顔: 目・眉・鼻・口・耳・髪</span><span>体: 肩・腕・胴・腰・脚・足</span><span>手: 指ランドマーク</span></div>`;
  scheduleDraw(); if(!silent)renderAllPartCrops();
}

function renderAllPartCrops() {
  const grid=$('partGrid'); grid.innerHTML=''; extractedParts.clear();
  for(const [id,label] of Object.entries(PART_LABELS)){
    const data=cropPartDataUrl(id,500); if(!data)continue; extractedParts.set(id,data);
    const card=document.createElement('div'); card.className='part-card'; card.dataset.part=id; card.innerHTML=`<img alt="${escapeHtml(label)}"><strong>${escapeHtml(label)}</strong><div class="small">タップで選択</div>`; card.querySelector('img').src=data;
    card.onclick=()=>{$('characterPartSelect').value=id;previewSelectedPart();document.querySelectorAll('.part-card').forEach(x=>x.classList.toggle('active',x.dataset.part===id));}; grid.appendChild(card);
  }
  if(!grid.children.length)grid.innerHTML='<div class="empty">検出できるパーツがなかったよ。顔や全身が見える画像で試してね</div>';
}
function previewSelectedPart(){const id=$('characterPartSelect').value;selectedPartDataUrl=extractedParts.get(id)||cropPartDataUrl(id,1000);const area=$('selectedPartPreview');if(!selectedPartDataUrl){area.innerHTML='<div class="empty">このパーツは画像内で検出できなかったよ</div>';return null;}area.innerHTML=`<img src="${selectedPartDataUrl}" alt="${escapeHtml(PART_LABELS[id]||id)}">`;return selectedPartDataUrl;}

$('showPoseGuide')?.addEventListener('change',()=>{document.querySelector('.canvas-wrap')?.classList.toggle('pose-active',$('showPoseGuide').checked);scheduleDraw();});
$('showHandGuide')?.addEventListener('change',scheduleDraw);
$('analyzePartsButton')?.addEventListener('click',()=>analyzeCharacterParts(false));
$('extractAllPartsButton')?.addEventListener('click',async()=>{if(!currentPoseLandmarks&&!currentLandmarks)await analyzeCharacterParts(true);renderAllPartCrops();});
$('clearPartsButton')?.addEventListener('click',()=>{extractedParts.clear();selectedPartDataUrl=null;$('partGrid').innerHTML='';$('selectedPartPreview').innerHTML='';$('partGeneratedArea').innerHTML='';});
$('previewPartButton')?.addEventListener('click',async()=>{if(!currentLandmarks&&!currentPoseLandmarks)await analyzeCharacterParts(true);previewSelectedPart();});
$('characterPartSelect')?.addEventListener('change',previewSelectedPart);
$('characterKeep')?.addEventListener('input',()=>{$('characterKeepValue').textContent=$('characterKeep').value;});
$('downloadPartButton')?.addEventListener('click',async()=>{const data=previewSelectedPart();if(!data)return;const id=$('characterPartSelect').value;const a=document.createElement('a');a.href=data;a.download=`NaturalFix_${id}_${Date.now()}.png`;a.click();});

function partAssetInstruction(partId, type, extra='') {
  const label=PART_LABELS[partId]||partId;
  const typeText={detail:'high-detail isolated reference asset',front:'front-view reference asset',side:'side-view reference asset',turnaround:'clean character turnaround/reference-sheet asset',motion:'animation-friendly natural-pose reference asset'}[type]||'detailed reference asset';
  return `Create a ${typeText} for the SAME character shown in the reference image, focusing on ${label}. Preserve the same identity, facial design, hair color, eye color, outfit, accessories, proportions, materials and color palette. Keep the result coherent for video/animation consistency. Show the selected area clearly, with natural anatomy and clean readable shapes. Keep clothing intact and non-explicit. Do not redesign the character. ${extra}`.trim();
}

$('generatePartButton')?.addEventListener('click',async()=>{
  if(!loaded){alert('先にキャラクター画像を読み込んでね');return;}
  const id=$('characterPartSelect').value; if(!currentLandmarks&&!currentPoseLandmarks)await analyzeCharacterParts(true);
  const crop=previewSelectedPart(); const full=await exportCurrentDataURL(.92); if(!crop){$('partGenerationStatus').textContent='⚠️ 選択パーツを画像から検出できなかったよ';return;}
  const extra=$('characterPartPrompt').value.trim(); const prompt=partAssetInstruction(id,$('characterPartAssetType').value,extra);
  $('generatePartButton').disabled=true;$('partGenerationStatus').textContent=`✨ ${PART_LABELS[id]}を動画用素材として生成中…`;
  try{
    const payload={prompt,baseImage:crop,references:[{image:full,role:'identity',strength:Number($('characterKeep').value)}],mode:generationMode,pose:'',performance:$('performanceMode').value,seed:Number($('seed').value||42),useDolphin:$('useDolphin').checked,sampler:{enabled:$('twoSamplerEnabled').checked,pass1:$('samplerPass1').value,pass2:$('samplerPass2').value,steps:Number($('samplerSteps').value),boundary:Number($('samplerBoundary').value),rawCfg:Number($('rawCfg').value),turboCfg:Number($('turboCfg').value)},lora:{name:$('loraSelector').value,strength:Number($('loraStrength').value)},width:1024,height:1024};
    const r=await apiFetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await r.json();if(!r.ok)throw new Error(result.error||'part generation failed');
    $('partGeneratedArea').innerHTML=`<img id="partGeneratedImage" alt="generated character part"><div class="buttons" style="margin-top:8px"><button id="partOpenEditor" class="green">✏️ NaturalFixで編集</button><button id="partSaveGenerated" class="green">💾 PNG保存</button></div>`;$('partGeneratedImage').src=result.image;
    $('partOpenEditor').onclick=()=>{loadImageData(result.image);window.scrollTo({top:0,behavior:'smooth'});};$('partSaveGenerated').onclick=()=>{const a=document.createElement('a');a.href=result.image;a.download=`NaturalFix_${id}_AI_${Date.now()}.png`;a.click();};
    $('partGenerationStatus').textContent=`✅ ${PART_LABELS[id]}の動画用リファレンス生成完了`;
  }catch(e){console.error(e);$('partGenerationStatus').textContent=`⚠️ ${e.message}`;}finally{$('generatePartButton').disabled=false;}
});

initCharacterPartModels();

await openDb(); await renderGallery(); updateLabels();
