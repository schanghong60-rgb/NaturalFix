# NaturalFix AI — Full integrated PWA

NaturalFix is a phone-friendly PWA front end plus a Node.js controller for local image adjustment and optional local AI services.

## Included

- Phone gallery image import
- Brightness / contrast / saturation / naturalization / rotation / flip / sharpen
- Fast preview mode for smoother phone editing
- MediaPipe face landmarks, face tilt and simple contour asymmetry indicator
- Up to 3 reference images with roles and strengths
- Realistic / anime direction
- Pose / camera presets
- Non-explicit adult-mood role (fashion / lighting / atmosphere only)
- Dolphin 3.0 prompt planner through Ollama
- Krea 2 generation through your local ComfyUI API workflow
- Turbo fast workflow and optional RAW -> Turbo two-pass workflow
- LoRA selection and strength control
- Krea 2 LoRA training launcher using the official Hugging Face Diffusers Krea 2 DreamBooth LoRA trainer
- Normal IndexedDB gallery
- Separate private gallery encrypted in-browser with AES-GCM and a PBKDF2-derived 4-digit PIN key
- Private vault auto-locks when the app goes into the background
- **No forced thumbnail blur** and **no two-minute inactivity lock**
- PWA manifest, service worker and 192/512 icons for home-screen installation

## Requirements

- Node.js 20+
- For AI generation: a running ComfyUI instance with Krea 2 configured
- For Dolphin: Ollama with Dolphin 3.0 available
- Optional LoRA training: a recent checkout of Hugging Face Diffusers with the Krea 2 DreamBooth LoRA training dependencies installed

Krea 2 officially ships RAW and Turbo variants. RAW is intended for fine-tuning/LoRA training; Turbo is the distilled fast inference model and its official recipe is 8 steps with CFG disabled. LoRAs trained on RAW are intended to be used on Turbo.

## 1. Install

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000` on the computer to verify the UI.

## 2. Dolphin 3.0

One current GGUF repository is:

```bash
ollama run hf.co/dphn/Dolphin3.0-Llama3.1-8B-GGUF:Q4_K_M
```

Keep Ollama running. The default API address in `.env.example` is `http://127.0.0.1:11434`.

Dolphin is used only as a text planner. It does not render the image.

## 3. Krea 2 / ComfyUI

Install Krea 2 in ComfyUI and first make sure your workflows run successfully **inside ComfyUI itself**.

Export two workflows in API format if you want both modes:

- `workflows/krea2_turbo.api.json`
- `workflows/krea2_twopass.api.json`

Then title the relevant nodes with the `NF_*` tags documented in `workflows/README.md`.

This avoids relying on guessed or version-specific Krea/Comfy node class names.

The backend uses ComfyUI's `/upload/image`, `/prompt`, `/history/{prompt_id}`, and `/view` routes.

## 4. LoRA inference

Set `LORA_DIR` in `.env` to the LoRA directory used by your ComfyUI install, for example:

```env
LORA_DIR=C:/ComfyUI/models/loras
```

Your workflow should contain a LoRA loader titled `NF_LORA` and, if desired, a strength-controlling node titled `NF_LORA_STRENGTH`.

## 5. LoRA training

Use the official Diffusers trainer `examples/dreambooth/train_dreambooth_lora_krea2.py`.

Typical setup from a fresh virtual environment:

```bash
git clone https://github.com/huggingface/diffusers
cd diffusers
pip install -e .
cd examples/dreambooth
pip install -r requirements_krea2.txt
accelerate config
```

Then set `.env`:

```env
KREA2_LORA_SCRIPT=/absolute/path/to/diffusers/examples/dreambooth/train_dreambooth_lora_krea2.py
LORA_DIR=/absolute/path/to/ComfyUI/models/loras
```

NaturalFix launches training on `krea/Krea-2-Raw`, validates on `krea/Krea-2-Turbo`, uses bf16, gradient checkpointing, latent caching, rank/alpha matching, 8-bit Adam, and copies the resulting `.safetensors` into `LORA_DIR` when training finishes.

## 6. Install on a Galaxy home screen

The app is PWA-ready, but browsers require a **secure context (HTTPS)** for service-worker/PWA installation, except `localhost`.

You have two practical choices:

1. Put the Node server behind an HTTPS reverse proxy/tunnel that your Galaxy can reach; or
2. Configure `HTTPS_KEY_PATH` and `HTTPS_CERT_PATH` in `.env` with a certificate trusted by the phone.

Once the Galaxy opens the HTTPS address:

- Tap the purple **ホーム画面に追加** button when it appears, or
- Chrome/Samsung Internet menu -> **ホーム画面に追加 / アプリをインストール**.

Plain `http://PC-LAN-IP:3000` can be useful for testing, but it is not the reliable PWA-install route.

## 7. Private vault behavior

- First open: choose a 4-digit PIN.
- The PIN is processed with PBKDF2-SHA256 (200,000 iterations).
- A derived AES-256-GCM key encrypts private images before IndexedDB storage.
- The decryption key is held only in memory while the vault is unlocked.
- Sending the app to the background locks the vault.
- There is intentionally no forced thumbnail blur and no 2-minute inactivity timer.

A 4-digit PIN has limited entropy, so this is an app-level privacy lock rather than a substitute for full-device encryption and a strong device passcode.

## Safety scope

The adult-mood option is deliberately limited to non-explicit adult styling: fashion, cinematic lighting, expression and atmosphere. The backend rejects requests aimed at nudifying a person, revealing explicit nudity/genitals, explicit sexual acts, or sexual content involving minors.

## Verification performed on this bundle

- `server.js`: Node syntax check passed
- `public/app.js`: Node syntax check passed
- Manifest/package JSON parse checks included in packaging step
- Krea/Comfy integration is workflow-adapter based so the app does not pretend a specific version-dependent Comfy node graph is universal


## v1.1 追加: 動画用キャラクターパーツ・スタジオ

読み込んだキャラクター画像から、MediaPipe Face / Pose / Hand Landmarker を使って次のパーツを解析・抽出できます。

- 顔: 頭部・髪、顔全体、左右の目、左右の眉、鼻、口・唇、左右の耳
- 上半身: 肩、胴体、左右の上腕/前腕、左右の手・指
- 下半身: 腰、左右の太もも、すね/ふくらはぎ、左右の足、全身

`動画用キャラクターパーツ・スタジオ` では、見えているパーツをローカルでPNG抽出できます。また、選択したパーツの切り抜き + 元のキャラクター全体画像を参照にし、既存の Krea 2 / Dolphin / LoRA パイプラインへ渡して動画用の高精細パーツ資料を生成できます。

単一画像に写っていない部分はローカル抽出できません。AI生成を使う場合も、元画像から完全に知り得ない形状は推定になります。

### アプリアイコン

`public/icons/icon-192.png` と `public/icons/icon-512.png` は、指定された青いリボンのキャラクター画像に更新済みです。Service Workerのキャッシュ名も `naturalfix-v1.1.1` に変更しているため、古いアイコンが残る場合はアプリを一度アンインストールして再度ホーム画面へ追加してください。\n\n## GitHub-ready setup (v1.1.1)\n\nThis repository is prepared for normal GitHub use:\n\n- `.github/workflows/ci.yml` checks JavaScript syntax and static project wiring on pushes/PRs.\n- `.github/workflows/pages.yml` can publish the **frontend only** from `public/` to GitHub Pages.\n- `public/config.js` lets a GitHub Pages frontend point at a separately hosted HTTPS Node backend.\n- `.env`, model weights, training images, LoRAs, certificates and private keys are excluded by `.gitignore`.\n- The service worker uses relative URLs, so it works when Pages serves the project under `https://USER.github.io/REPOSITORY/`.\n\n### Upload to GitHub\n\n```bash\ngit init\ngit add .\ngit commit -m "Initial NaturalFix v1.1.1"\ngit branch -M main\ngit remote add origin https://github.com/YOURNAME/YOUR-REPO.git\ngit push -u origin main\n```\n\n### GitHub Pages\n\nGitHub Pages can host the UI, local image adjustments, MediaPipe analysis, IndexedDB galleries and the PWA shell. It **cannot** run Node.js, ComfyUI, Ollama/Dolphin, or LoRA training. Those need a separate backend machine/service.\n\nFor Pages, edit `public/config.js` before deploying:\n\n```js\nwindow.NATURALFIX_CONFIG = Object.freeze({\n  API_BASE_URL: 'https://YOUR-NATURALFIX-BACKEND.example.com'\n});\n```\n\nThen set the backend `.env` to allow your Pages origin:\n\n```env\nALLOWED_ORIGINS=https://YOURNAME.github.io\n```\n\nThe backend URL must use **HTTPS** when the frontend is on GitHub Pages; browsers block an HTTPS page from calling an HTTP API. If the Node backend itself serves the frontend, leave `API_BASE_URL` empty and `ALLOWED_ORIGINS` empty.\n\nEnable Pages with **Settings → Pages → Source: GitHub Actions**. The included Pages workflow then publishes `public/`.\n\n### Local verification\n\n```bash\nnpm install\nnpm test\nnpm start\n```\n\n`npm test` checks:\n\n- `server.js` syntax\n- `public/app.js` syntax\n- package/manifest JSON\n- required PWA files\n- icon dimensions\n- static HTML element IDs referenced by the frontend\n- basic manifest/service-worker wiring\n\n### Important external-runtime check\n\nThe repository itself can be statically validated, but Krea 2 / ComfyUI workflows are intentionally **not hard-coded**. Before using AI generation, export API-format workflows from the exact ComfyUI/Krea 2 version installed on your machine and add the `NF_*` node titles described in `workflows/README.md`. This avoids pretending one version-specific node graph is universally correct.\n