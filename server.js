import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const app = express();
const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const COMFY_URL = (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const DOLPHIN_MODEL = process.env.DOLPHIN_MODEL || 'hf.co/dphn/Dolphin3.0-Llama3.1-8B-GGUF:Q4_K_M';
const KREA_TURBO_WORKFLOW = path.resolve(ROOT, process.env.KREA_TURBO_WORKFLOW || './workflows/krea2_turbo.api.json');
const KREA_TWOPASS_WORKFLOW = path.resolve(ROOT, process.env.KREA_TWOPASS_WORKFLOW || './workflows/krea2_twopass.api.json');
const LORA_DIR = path.resolve(ROOT, process.env.LORA_DIR || './loras');
const LORA_SCRIPT = process.env.KREA2_LORA_SCRIPT ? path.resolve(ROOT, process.env.KREA2_LORA_SCRIPT) : '';
const ACCELERATE_BIN = process.env.ACCELERATE_BIN || 'accelerate';
const KREA_RAW_MODEL = process.env.KREA_RAW_MODEL || 'krea/Krea-2-Raw';
const KREA_TURBO_MODEL = process.env.KREA_TURBO_MODEL || 'krea/Krea-2-Turbo';
const KEEP_TRAINING_DATA = String(process.env.KEEP_TRAINING_DATA || 'false').toLowerCase() === 'true';
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((v) => v.trim().replace(/\/$/, ''))
  .filter(Boolean);

await fsp.mkdir(LORA_DIR, { recursive: true });
await fsp.mkdir(path.join(ROOT, 'training_uploads'), { recursive: true });
await fsp.mkdir(path.join(ROOT, 'datasets'), { recursive: true });
await fsp.mkdir(path.join(ROOT, 'lora_output'), { recursive: true });

app.disable('x-powered-by');
const APP_USER = process.env.APP_USER || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';

const SESSION_COOKIE = 'naturalfix_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function signSession(value) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(value)
    .digest('hex');
}

function makeSessionToken() {
  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  const value = `${issuedAt}.${nonce}`;
  return `${value}.${signSession(value)}`;
}

function validSessionToken(token = '') {
  if (!SESSION_SECRET) return false;

  const [issuedAtText, nonce, signature] = String(token).split('.');
  if (!issuedAtText || !nonce || !signature) return false;

  const issuedAt = Number(issuedAtText);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > SESSION_TTL_MS) return false;

  return safeEqual(signature, signSession(`${issuedAtText}.${nonce}`));
}

function readCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] =
      decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

app.use(express.urlencoded({ extended: false, limit: '8kb' }));

if (!APP_USER || !APP_PASSWORD || !SESSION_SECRET) {
  throw new Error('APP_USER, APP_PASSWORD, SESSION_SECRET must be set');
}

const LOGIN_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NaturalFix Login</title>
</head>
<body>
  <main style="max-width:360px;margin:15vh auto;padding:24px;font-family:sans-serif">
    <h1>🔐 NaturalFix</h1>
    <form method="post" action="/login">
      <p><input name="username" autocomplete="username" required
        placeholder="ユーザー名" style="width:100%;padding:12px;box-sizing:border-box"></p>
      <p><input type="password" name="password" autocomplete="current-password" required
        placeholder="パスワード" style="width:100%;padding:12px;box-sizing:border-box"></p>
      <button type="submit" style="width:100%;padding:12px">ログイン</button>
    </form>
  </main>
</body>
</html>`;

app.get('/login', (req, res) => {
  const token = readCookies(req)[SESSION_COOKIE];
  if (validSessionToken(token)) return res.redirect('/');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(LOGIN_HTML);
});

app.post('/login', (req, res) => {
  const userOk = safeEqual(req.body?.username || '', APP_USER);
  const passOk = safeEqual(req.body?.password || '', APP_PASSWORD);

  if (!userOk || !passOk) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).type('html').send(LOGIN_HTML);
  }

  res.cookie(SESSION_COOKIE, makeSessionToken(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/'
  });

  res.redirect('/');
});

app.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/'
  });
  res.redirect('/login');
});

app.use((req, res, next) => {
  const token = readCookies(req)[SESSION_COOKIE];
  if (validSessionToken(token)) return next();

  res.setHeader('Cache-Control', 'no-store');

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }

  return res.redirect('/login');
});









// Optional CORS for a static GitHub Pages frontend talking to this backend.
// Leave ALLOWED_ORIGINS empty for same-origin use.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length) {
    const normalizedOrigin = String(origin).replace(/\/$/, '');
    const allowed = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(normalizedOrigin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes('*') ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '80mb' }));
app.use(express.static(path.join(ROOT, 'public'), {
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

const upload = multer({
  dest: path.join(ROOT, 'training_uploads'),
  limits: {
    files: 100,
    fileSize: 30 * 1024 * 1024
  },
  fileFilter(_req, file, cb) {
    const ok = /^image\/(jpeg|png|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('JPEG/PNG/WebP の画像だけ使えます'), ok);
  }
});

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function safeName(value, fallback = 'item') {
  const s = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 80);
  return s || fallback;
}

function explicitRequest(text = '') {
  const t = String(text || '').toLowerCase();

  // 未成年を示す表現
  const minor =
    /\b(minor|underage|child|kid)\b/.test(t) ||
    /(未成年|子ども|子供|児童|小学生|中学生|高校生)/.test(t);

  // 性的な内容を示す表現
  const sexual =
    /\b(sex|sexual|nude|naked|porn|pornographic|erotic)\b/.test(t) ||
    /(性的|性行為|裸|全裸|ヌード|ポルノ|エロ)/.test(t);

  // 「未成年」＋「性的内容」の両方がある場合だけ弾く
  return minor && sexual;
}

function fetchTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function serviceHealth(url) {
  try {
    const r = await fetchTimeout(url, {}, 3500);
    return r.ok;
  } catch {
    return false;
  }
}

app.get('/api/health', async (_req, res) => {
  const [comfy, ollama] = await Promise.all([
    serviceHealth(`${COMFY_URL}/system_stats`),
    serviceHealth(`${OLLAMA_URL}/api/tags`)
  ]);
  res.json({
    ok: true,
    comfy,
    dolphin: ollama,
    turboWorkflow: fs.existsSync(KREA_TURBO_WORKFLOW),
    twoPassWorkflow: fs.existsSync(KREA_TWOPASS_WORKFLOW),
    loraTraining: Boolean(LORA_SCRIPT && fs.existsSync(LORA_SCRIPT)),
    secureContextRequiredForInstall: true
  });
});

function cleanJsonText(text) {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

async function makeDolphinPlan({ prompt, references = [], mode = 'realistic', pose = '', performance = 'fast' }) {
  if (explicitRequest(prompt)) {
    throw new Error('露骨な性的変換・脱衣/裸化の指示には対応していません');
  }

  const refText = references.map((r, i) =>
    `Reference ${i + 1}: role=${String(r.role || 'style')}, strength=${clamp(r.strength, 0, 100)}/100`
  ).join('\n');

  const system = `You are the planning component of NaturalFix, an image editing app.\n` +
    `You do not render images. Produce concise instructions for Krea 2.\n` +
    `The app can use a base image and up to three reference images.\n` +
    `If the user selects adult mood, keep it non-explicit: mature fashion, lighting, expression and atmosphere only.\n` +
    `Never instruct nudification, clothing removal to reveal nudity, explicit genitals, explicit sexual acts, or sexual content involving minors.\n` +
    `Return JSON only with keys: prompt, pass1Prompt, pass2Prompt, referenceStrategy, detailFocus.`;

  const user = `Mode: ${mode}\nPerformance: ${performance}\nPose: ${pose || 'user/default'}\n${refText || 'No references'}\nInstruction:\n${prompt}`;

  const r = await fetchTimeout(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DOLPHIN_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      options: { temperature: 0.3, num_predict: 800 }
    })
  }, 120_000);

  if (!r.ok) throw new Error(`Dolphin: ${await r.text()}`);
  const data = await r.json();
  const text = cleanJsonText(data?.message?.content);
  try {
    return JSON.parse(text);
  } catch {
    return { prompt: text || prompt, pass1Prompt: text || prompt, pass2Prompt: text || prompt };
  }
}

app.post('/api/dolphin/plan', async (req, res) => {
  try {
    const { prompt = '', references = [], mode = 'realistic', pose = '', performance = 'fast' } = req.body || {};
    if (!String(prompt).trim()) return res.status(400).json({ error: 'prompt missing' });
    const plan = await makeDolphinPlan({ prompt, references, mode, pose, performance });
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function loadWorkflow(file) {
  const raw = await fsp.readFile(file, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('ComfyUI API workflow JSON が不正です');
  return parsed;
}

function nodeTitle(node) {
  return String(node?._meta?.title || '').trim();
}

function taggedEntries(workflow, title) {
  return Object.entries(workflow).filter(([, node]) => nodeTitle(node) === title);
}

function setFirstExistingInput(node, keys, value) {
  if (!node?.inputs) return false;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(node.inputs, key)) {
      node.inputs[key] = value;
      return true;
    }
  }
  return false;
}

function setAllExistingInputs(node, keys, value) {
  if (!node?.inputs) return false;
  let changed = false;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(node.inputs, key)) {
      node.inputs[key] = value;
      changed = true;
    }
  }
  return changed;
}

function patchTag(workflow, title, keys, value, all = false) {
  let count = 0;
  for (const [, node] of taggedEntries(workflow, title)) {
    const changed = all ? setAllExistingInputs(node, keys, value) : setFirstExistingInput(node, keys, value);
    if (changed) count += 1;
  }
  return count;
}

function dataUrlToBlob(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
  if (!m) throw new Error('image data URL is invalid');
  const bytes = Buffer.from(m[2], 'base64');
  return new Blob([bytes], { type: m[1] });
}

async function comfyUpload(dataUrl, filename) {
  const form = new FormData();
  form.append('image', dataUrlToBlob(dataUrl), filename);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const r = await fetchTimeout(`${COMFY_URL}/upload/image`, { method: 'POST', body: form }, 60_000);
  if (!r.ok) throw new Error(`Comfy upload: ${await r.text()}`);
  const info = await r.json();
  return info.name || filename;
}

async function comfyQueue(workflow) {
  const clientId = crypto.randomUUID();
  const r = await fetchTimeout(`${COMFY_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  }, 30_000);
  if (!r.ok) throw new Error(`Comfy queue: ${await r.text()}`);
  const data = await r.json();
  if (!data.prompt_id) throw new Error('ComfyUI did not return prompt_id');
  return data.prompt_id;
}

async function comfyWait(promptId, outputNodeId, timeoutMs = 10 * 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const r = await fetchTimeout(`${COMFY_URL}/history/${encodeURIComponent(promptId)}`, {}, 15_000);
    if (r.ok) {
      const data = await r.json();
      const job = data?.[promptId];
      if (job?.status?.status_str === 'error') throw new Error('ComfyUI generation failed');
      const outputs = job?.outputs;
      if (outputs) {
        let out = outputNodeId ? outputs[outputNodeId] : null;
        if (!out?.images?.length) {
          out = Object.values(outputs).find((v) => v?.images?.length);
        }
        if (out?.images?.length) return out.images[0];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('ComfyUI timeout');
}

async function comfyImageAsDataUrl(info) {
  const q = new URLSearchParams({
    filename: info.filename,
    subfolder: info.subfolder || '',
    type: info.type || 'output'
  });
  const r = await fetchTimeout(`${COMFY_URL}/view?${q.toString()}`, {}, 60_000);
  if (!r.ok) throw new Error(`Comfy view: ${await r.text()}`);
  const type = r.headers.get('content-type') || 'image/png';
  const arr = Buffer.from(await r.arrayBuffer());
  return `data:${type};base64,${arr.toString('base64')}`;
}

function composePrompt({ prompt, mode, pose, references }) {
  const style = mode === 'anime'
    ? 'High-quality anime illustration, coherent line art, deliberate anime shading and consistent character design.'
    : 'Photorealistic image, natural lighting, realistic proportions, natural skin/material texture and coherent photography.';

  const adultMood = references.some((r) => r.role === 'adult_mood');
  const adult = adultMood
    ? ' Mature adult, non-explicit styling only: sophisticated fashion, cinematic sensual lighting and adult atmosphere; no nudity or explicit sexual acts.'
    : '';

  const refRoles = references.map((r, i) => `Reference ${i + 1}: ${r.role || 'style'} (${clamp(r.strength, 0, 100)}/100).`).join(' ');
  const poseText = pose ? `Pose/camera direction: ${pose}.` : '';
  return `${style} ${adult} ${poseText} ${refRoles} User request: ${prompt}`.trim();
}

function workflowOutputNodeId(workflow) {
  const tagged = taggedEntries(workflow, 'NF_OUTPUT');
  return tagged.length ? tagged[0][0] : null;
}

async function buildGenerationWorkflow(payload, plan) {
  const performance = ['fast', 'balanced', 'quality'].includes(payload.performance) ? payload.performance : 'fast';
  const sampler = payload.sampler || {};
  const useTwoPass = Boolean(sampler.enabled || performance === 'quality');
  const workflowFile = useTwoPass ? KREA_TWOPASS_WORKFLOW : KREA_TURBO_WORKFLOW;
  if (!fs.existsSync(workflowFile)) {
    throw new Error(`必要なComfyUI API workflowがありません: ${path.basename(workflowFile)}`);
  }

  const workflow = await loadWorkflow(workflowFile);
  const finalPrompt = useTwoPass && plan?.pass1Prompt ? plan.pass1Prompt : (plan?.prompt || payload.finalPrompt);
  patchTag(workflow, 'NF_PROMPT', ['text', 'prompt'], finalPrompt);
  patchTag(workflow, 'NF_NEGATIVE', ['text', 'prompt'], 'low quality, malformed anatomy, duplicate limbs, artifacts');

  const seed = Number.isFinite(Number(payload.seed)) ? Number(payload.seed) : Math.floor(Math.random() * 2_147_483_647);
  patchTag(workflow, 'NF_SEED', ['seed', 'noise_seed'], seed);

  const profiles = {
    fast: { steps: 8, cfg: 0 },
    balanced: { steps: 8, cfg: 0 },
    quality: { steps: 12, cfg: 0 }
  };
  const profile = profiles[performance];
  patchTag(workflow, 'NF_STEPS', ['steps'], profile.steps);
  patchTag(workflow, 'NF_CFG', ['cfg', 'guidance'], profile.cfg);

  const width = clamp(payload.width || 1024, 512, 2048);
  const height = clamp(payload.height || 1024, 512, 2048);
  patchTag(workflow, 'NF_WIDTH', ['width'], Math.round(width / 16) * 16);
  patchTag(workflow, 'NF_HEIGHT', ['height'], Math.round(height / 16) * 16);

  if (payload.baseImage) {
    const name = await comfyUpload(payload.baseImage, `naturalfix_base_${Date.now()}.png`);
    patchTag(workflow, 'NF_BASE_IMAGE', ['image'], name);
  }

  for (let i = 0; i < Math.min(3, payload.references.length); i += 1) {
    const ref = payload.references[i];
    if (!ref.image) continue;
    const name = await comfyUpload(ref.image, `naturalfix_ref${i + 1}_${Date.now()}.png`);
    patchTag(workflow, `NF_REF${i + 1}`, ['image'], name);
    patchTag(workflow, `NF_REF${i + 1}_STRENGTH`, ['strength', 'weight', 'strength_model'], clamp(ref.strength, 0, 100) / 100, true);
  }

  if (payload.lora?.name) {
    const loraFile = path.basename(payload.lora.name);
    patchTag(workflow, 'NF_LORA', ['lora_name'], loraFile);
    const loraStrength = clamp(payload.lora.strength, 0, 1.5);
    patchTag(workflow, 'NF_LORA_STRENGTH', ['strength_model', 'strength_clip', 'strength'], loraStrength, true);
  }

  if (useTwoPass) {
    const steps = clamp(sampler.steps || 8, 4, 60);
    const boundary = clamp(sampler.boundary || 3, 1, Math.max(1, steps - 1));
    for (const [, node] of taggedEntries(workflow, 'NF_PASS1_SAMPLER')) {
      setFirstExistingInput(node, ['steps'], steps);
      setFirstExistingInput(node, ['start_at_step'], 0);
      setFirstExistingInput(node, ['end_at_step'], boundary);
      setFirstExistingInput(node, ['cfg'], clamp(sampler.rawCfg ?? 3.5, 0, 10));
      setFirstExistingInput(node, ['sampler_name'], String(sampler.pass1 || 'euler'));
    }
    for (const [, node] of taggedEntries(workflow, 'NF_PASS2_SAMPLER')) {
      setFirstExistingInput(node, ['steps'], steps);
      setFirstExistingInput(node, ['start_at_step'], boundary);
      setFirstExistingInput(node, ['end_at_step'], steps);
      setFirstExistingInput(node, ['cfg'], clamp(sampler.turboCfg ?? 0, 0, 10));
      setFirstExistingInput(node, ['sampler_name'], String(sampler.pass2 || 'euler'));
    }
    if (plan?.pass2Prompt) patchTag(workflow, 'NF_PASS2_PROMPT', ['text', 'prompt'], plan.pass2Prompt);
  }

  return { workflow, outputNodeId: workflowOutputNodeId(workflow), useTwoPass };
}

app.post('/api/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const prompt = String(body.prompt || '').trim();
    const references = Array.isArray(body.references) ? body.references.slice(0, 3) : [];
    if (!prompt) return res.status(400).json({ error: '編集指示を入力してください' });
    if (explicitRequest(prompt)) return res.status(400).json({ error: '露骨な性的変換・脱衣/裸化には対応していません' });

    const payload = {
      ...body,
      references,
      mode: body.mode === 'anime' ? 'anime' : 'realistic',
      performance: body.performance || 'fast'
    };
    payload.finalPrompt = composePrompt({ prompt, mode: payload.mode, pose: body.pose || '', references });

    let plan = null;
    if (body.useDolphin) {
      try {
        plan = await makeDolphinPlan({
          prompt: payload.finalPrompt,
          references,
          mode: payload.mode,
          pose: body.pose || '',
          performance: payload.performance
        });
      } catch (error) {
        plan = { prompt: payload.finalPrompt, warning: error.message };
      }
    }

    const { workflow, outputNodeId, useTwoPass } = await buildGenerationWorkflow(payload, plan);
    const promptId = await comfyQueue(workflow);
    const imageInfo = await comfyWait(promptId, outputNodeId);
    const image = await comfyImageAsDataUrl(imageInfo);
    res.json({ image, promptId, twoPass: useTwoPass, plan });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/loras', async (_req, res) => {
  try {
    const files = [];
    async function walk(dir, prefix = '') {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(full, rel);
        else if (/\.safetensors$/i.test(entry.name)) files.push(rel);
      }
    }
    await walk(LORA_DIR);
    files.sort((a, b) => a.localeCompare(b));
    res.json({ items: files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const trainingJobs = new Map();

function findSafetensors(dir) {
  const found = [];
  function walk(p) {
    if (!fs.existsSync(p)) return;
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.safetensors$/i.test(entry.name)) found.push(full);
    }
  }
  walk(dir);
  return found;
}

app.post('/api/lora/train', upload.array('images', 100), async (req, res) => {
  try {
    const cleanupIncoming = async () => {
      for (const f of req.files || []) await fsp.rm(f.path, { force: true }).catch(() => {});
    };
    if (!LORA_SCRIPT || !fs.existsSync(LORA_SCRIPT)) {
      await cleanupIncoming();
      return res.status(503).json({ error: 'KREA2_LORA_SCRIPT が未設定です' });
    }
    if (!req.files?.length) return res.status(400).json({ error: '学習画像がありません' });

    const name = safeName(req.body.name, 'naturalfix_lora');
    const trigger = String(req.body.trigger || '').trim();
    if (!trigger) {
      await cleanupIncoming();
      return res.status(400).json({ error: 'トリガーワードが必要です' });
    }
    const rank = Math.round(clamp(req.body.rank || 32, 8, 128));
    const steps = Math.round(clamp(req.body.steps || 1000, 100, 10_000));
    const jobId = crypto.randomUUID();
    const datasetDir = path.join(ROOT, 'datasets', jobId);
    const outputDir = path.join(ROOT, 'lora_output', jobId);
    await fsp.mkdir(datasetDir, { recursive: true });
    await fsp.mkdir(outputDir, { recursive: true });

    for (let i = 0; i < req.files.length; i += 1) {
      const f = req.files[i];
      const ext = f.mimetype === 'image/png' ? '.png' : f.mimetype === 'image/webp' ? '.webp' : '.jpg';
      await fsp.rename(f.path, path.join(datasetDir, `image_${String(i + 1).padStart(3, '0')}${ext}`));
    }

    const args = [
      'launch', LORA_SCRIPT,
      '--pretrained_model_name_or_path', KREA_RAW_MODEL,
      '--instance_data_dir', datasetDir,
      '--output_dir', outputDir,
      '--mixed_precision', 'bf16',
      '--instance_prompt', trigger,
      '--resolution', '1024',
      '--train_batch_size', '1',
      '--gradient_checkpointing',
      '--cache_latents',
      '--rank', String(rank),
      '--lora_alpha', String(rank),
      '--optimizer', 'adamW',
      '--use_8bit_adam',
      '--learning_rate', '3e-4',
      '--lr_scheduler', 'constant',
      '--lr_warmup_steps', '0',
      '--max_train_steps', String(steps),
      '--validation_model_path', KREA_TURBO_MODEL,
      '--validation_prompt', trigger,
      '--validation_num_inference_steps', '8',
      '--validation_guidance_scale', '0.0'
    ];

    const job = { id: jobId, name, status: 'starting', logs: [], startedAt: Date.now(), output: null };
    trainingJobs.set(jobId, job);
    const child = spawn(ACCELERATE_BIN, args, { cwd: path.dirname(LORA_SCRIPT), env: process.env });
    job.status = 'running';

    const addLog = (chunk) => {
      const lines = String(chunk).split(/\r?\n/).filter(Boolean);
      job.logs.push(...lines);
      if (job.logs.length > 150) job.logs.splice(0, job.logs.length - 150);
    };
    child.stdout.on('data', addLog);
    child.stderr.on('data', addLog);
    child.on('error', (error) => {
      job.status = 'failed';
      job.error = error.message;
    });
    child.on('close', async (code) => {
      job.finishedAt = Date.now();
      if (code === 0) {
        try {
          const files = findSafetensors(outputDir);
          if (!files.length) throw new Error('学習結果の .safetensors が見つかりません');
          const preferred = files.find((f) => path.basename(f) === 'pytorch_lora_weights.safetensors');
          files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
          const source = preferred || files[0];
          const target = path.join(LORA_DIR, `${name}.safetensors`);
          await fsp.copyFile(source, target);
          job.output = path.basename(target);
          job.status = 'completed';
        } catch (error) {
          job.status = 'failed';
          job.error = error.message;
        }
      } else {
        job.status = 'failed';
        job.error = `accelerate exited with code ${code}`;
      }
      if (!KEEP_TRAINING_DATA) {
        await fsp.rm(datasetDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    res.json({ jobId });
  } catch (error) {
    for (const f of req.files || []) await fsp.rm(f.path, { force: true }).catch(() => {});
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/lora/train/:id', (req, res) => {
  const job = trainingJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'request error' });
});

const keyPath = process.env.HTTPS_KEY_PATH ? path.resolve(ROOT, process.env.HTTPS_KEY_PATH) : '';
const certPath = process.env.HTTPS_CERT_PATH ? path.resolve(ROOT, process.env.HTTPS_CERT_PATH) : '';

if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app);
  server.listen(PORT, '0.0.0.0', () => console.log(`NaturalFix HTTPS: https://0.0.0.0:${PORT}`));
} else {
  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => console.log(`NaturalFix HTTP: http://0.0.0.0:${PORT}`));
}
