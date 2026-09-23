/* NaturalFix Feature Pack v1.0
   Client-side upgrades: compare, undo/redo, crop, white balance,
   local face/background correction, portrait background blur,
   batch processing, presets, EXIF-safe export, multi-reference prep sheet.
*/
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  if (!canvas) return;

  const VERSION = '1.0.0';
  const STORAGE_PRESETS = 'naturalfix_feature_presets_v1';
  const STORAGE_REF = 'naturalfix_multiref_settings_v1';

  let originalDataUrl = '';
  let originalImage = null;
  let applying = false;
  let forcingBase = false;
  let renderTimer = 0;
  let historyTimer = 0;
  let flipParity = 0;
  let rotate90Steps = 0;
  let history = [];
  let future = [];
  let restoring = false;
  const refCopies = [null, null, null];

  const css = `
  .nf-feature-card{outline:1px solid #8ba8ff22}
  .nf-feature-head{display:flex;justify-content:space-between;gap:10px;align-items:center}
  .nf-version{font-size:11px;color:#aab2c0;background:#303641;padding:4px 8px;border-radius:999px}
  .nf-toolbar{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
  .nf-toolbar button{padding:10px}
  .nf-compare{position:relative;width:100%;overflow:hidden;border-radius:14px;background:#090a0e;min-height:180px;margin-top:10px}
  .nf-compare img{display:block;width:100%;height:auto;max-height:520px;object-fit:contain;background:#090a0e}
  .nf-compare-after{position:absolute;inset:0;overflow:hidden;clip-path:inset(0 50% 0 0)}
  .nf-compare-after img{width:100%;height:100%;object-fit:contain}
  .nf-compare-line{position:absolute;top:0;bottom:0;left:50%;width:2px;background:#fff;box-shadow:0 0 0 1px #0008;pointer-events:none}
  .nf-compare-label{position:absolute;top:8px;padding:4px 7px;border-radius:8px;background:#0009;font-size:11px;z-index:3}
  .nf-before-label{left:8px}.nf-after-label{right:8px}
  .nf-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .nf-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .nf-subcard{background:#2b303a;border-radius:13px;padding:11px;margin:10px 0}
  .nf-subcard h4{margin:0 0 9px}
  .nf-badge{display:inline-block;font-size:11px;padding:5px 8px;border-radius:999px;background:#1f4934;color:#aaf1cb;margin:3px}
  .nf-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .nf-row>*{flex:1 1 150px}
  .nf-note{font-size:12px;line-height:1.5;color:#aab2c0}
  .nf-danger-note{font-size:12px;color:#ffd6a0}
  @media(max-width:720px){.nf-grid2,.nf-grid3{grid-template-columns:1fr}.nf-toolbar{grid-template-columns:1fr 1fr}}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const featureCard = document.createElement('section');
  featureCard.className = 'card nf-feature-card';
  featureCard.id = 'naturalFixFeaturePack';
  featureCard.innerHTML = `
    <div class="nf-feature-head">
      <h3>🛠 NaturalFix 追加編集ツール</h3>
      <span class="nf-version">Feature Pack v${VERSION}</span>
    </div>

    <div class="nf-toolbar">
      <button id="nfUndo">↶ 元に戻す</button>
      <button id="nfRedo">↷ やり直す</button>
      <button id="nfCaptureBase">📌 現在画像を基準</button>
      <button id="nfAdvancedSave" class="green">💾 完成JPG保存</button>
    </div>

    <div class="nf-subcard">
      <h4>↔ ビフォー / アフター比較</h4>
      <div class="nf-compare" id="nfCompare">
        <img id="nfCompareBefore" alt="before">
        <div class="nf-compare-after" id="nfCompareAfterWrap"><img id="nfCompareAfter" alt="after"></div>
        <span class="nf-compare-label nf-before-label">BEFORE</span>
        <span class="nf-compare-label nf-after-label">AFTER</span>
        <div class="nf-compare-line" id="nfCompareLine"></div>
      </div>
      <input id="nfCompareSlider" type="range" min="0" max="100" value="50" aria-label="before after comparison">
    </div>

    <div class="nf-subcard">
      <h4>✂️ 自動トリミング</h4>
      <div class="nf-grid2">
        <select id="nfCropPreset">
          <option value="none">トリミングなし</option>
          <option value="face-square">顔中心 1:1</option>
          <option value="square">中央 1:1</option>
          <option value="4:5">SNS縦 4:5</option>
          <option value="9:16">ストーリー 9:16</option>
          <option value="16:9">横長 16:9</option>
        </select>
        <button id="nfApplyCrop" class="primary">✂️ トリミング反映</button>
      </div>
    </div>

    <div class="nf-subcard">
      <h4>🌡 色温度 / ホワイトバランス</h4>
      <div class="control"><label><span>色温度</span><span id="nfTempValue">0</span></label><input id="nfTemp" type="range" min="-100" max="100" value="0"></div>
      <div class="control"><label><span>色かぶり補正</span><span id="nfTintValue">0</span></label><input id="nfTint" type="range" min="-100" max="100" value="0"></div>
      <div class="nf-row">
        <button id="nfAutoWB">✨ 自動WB</button>
        <button id="nfResetWB">↩ WBリセット</button>
      </div>
    </div>

    <div class="nf-subcard">
      <h4>🎯 部分補正 / 背景ぼかし</h4>
      <div class="control"><label><span>顔の明るさ</span><span id="nfFaceBrightValue">0</span></label><input id="nfFaceBright" type="range" min="-40" max="40" value="0"></div>
      <div class="control"><label><span>背景の明るさ</span><span id="nfBgBrightValue">0</span></label><input id="nfBgBright" type="range" min="-40" max="40" value="0"></div>
      <div class="control"><label><span>背景ぼかし</span><span id="nfBgBlurValue">0</span></label><input id="nfBgBlur" type="range" min="0" max="20" step="1" value="0"></div>
      <p class="nf-note">人物・顔の中心を推定してローカル処理する軽量版。GPU不要・端末内処理だよ。</p>
    </div>

    <div class="nf-subcard">
      <h4>🎨 編集プリセット</h4>
      <div class="nf-grid2">
        <select id="nfPresetSelect">
          <option value="">プリセットを選択</option>
          <option value="builtin:natural">自然</option>
          <option value="builtin:bright">明るめ</option>
          <option value="builtin:sns">SNS</option>
          <option value="builtin:night">夜景</option>
        </select>
        <button id="nfApplyPreset" class="primary">適用</button>
      </div>
      <div class="nf-row" style="margin-top:8px">
        <button id="nfSavePreset">＋ 現在設定を保存</button>
        <button id="nfDeletePreset">削除</button>
      </div>
    </div>

    <div class="nf-subcard">
      <h4>🗂 一括処理</h4>
      <input id="nfBatchFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple>
      <div class="nf-row" style="margin-top:8px">
        <button id="nfBatchRun" class="primary">⚡ 現在設定で一括保存</button>
        <span id="nfBatchStatus" class="nf-note">最大10枚</span>
      </div>
      <div><span class="nf-badge">✅ 保存時EXIF削除</span><span class="nf-badge">✅ 位置情報を引き継がない</span></div>
    </div>

    <div class="nf-subcard">
      <h4>🧬 マルチリファレンス準備シート</h4>
      <div class="nf-row">
        <button id="nfRefSheet" class="primary">🖼 準備シートJPG保存</button>
        <button id="nfRefSettingsSave">💾 設定を端末保存</button>
        <button id="nfRefSettingsLoad">📂 設定を読込</button>
      </div>
      <p class="nf-note">参考画像3枚・役割・反映度・ポーズ・編集指示を1枚のシートにまとめる。AIバックエンドは不要。</p>
    </div>
  `;

  const baseCard = $('downloadButton')?.closest('.card');
  if (baseCard) baseCard.insertAdjacentElement('afterend', featureCard);
  else document.querySelector('.container')?.appendChild(featureCard);

  const adv = {
    temp: $('nfTemp'),
    tint: $('nfTint'),
    faceBright: $('nfFaceBright'),
    bgBright: $('nfBgBright'),
    bgBlur: $('nfBgBlur'),
    crop: $('nfCropPreset')
  };

  const baseIds = ['natural','brightness','contrast','saturation','sharp','rotate'];
  const labelMap = {
    nfTemp:'nfTempValue',
    nfTint:'nfTintValue',
    nfFaceBright:'nfFaceBrightValue',
    nfBgBright:'nfBgBrightValue',
    nfBgBlur:'nfBgBlurValue'
  };

  function syncAdvLabels() {
    Object.entries(labelMap).forEach(([id, lid]) => {
      const el = $(id), lab = $(lid);
      if (el && lab) lab.textContent = el.value;
    });
  }

  function readState() {
    const s = {
      base: {},
      adv: {
        temp:Number(adv.temp.value),
        tint:Number(adv.tint.value),
        faceBright:Number(adv.faceBright.value),
        bgBright:Number(adv.bgBright.value),
        bgBlur:Number(adv.bgBlur.value),
        crop:adv.crop.value
      },
      flipParity,
      rotate90Steps
    };
    baseIds.forEach(id => s.base[id] = $(id)?.value ?? '');
    return s;
  }

  function stateKey(s) { return JSON.stringify(s); }

  function pushHistory() {
    if (restoring) return;
    const s = readState();
    if (!history.length || stateKey(history[history.length - 1]) !== stateKey(s)) {
      history.push(s);
      if (history.length > 60) history.shift();
      future = [];
    }
    updateUndoButtons();
  }

  function scheduleHistory() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(pushHistory, 250);
  }

  function updateUndoButtons() {
    $('nfUndo').disabled = history.length < 2;
    $('nfRedo').disabled = !future.length;
  }

  function restoreState(s) {
    if (!s) return;
    restoring = true;
    baseIds.forEach(id => {
      if ($(id) && s.base[id] != null) $(id).value = s.base[id];
    });
    adv.temp.value = s.adv.temp;
    adv.tint.value = s.adv.tint;
    adv.faceBright.value = s.adv.faceBright;
    adv.bgBright.value = s.adv.bgBright;
    adv.bgBlur.value = s.adv.bgBlur;
    adv.crop.value = s.adv.crop;
    syncAdvLabels();

    while (flipParity !== s.flipParity) {
      $('flipButton')?.click();
      flipParity ^= 1;
    }
    const currentRot = ((rotate90Steps % 4) + 4) % 4;
    const targetRot = ((s.rotate90Steps % 4) + 4) % 4;
    let diff = (targetRot - currentRot + 4) % 4;
    while (diff-- > 0) $('rotate90Button')?.click();
    rotate90Steps = targetRot;

    $('brightness')?.dispatchEvent(new Event('input', {bubbles:true}));
    syncBaseValueLabels();
    restoring = false;
    requestAdvancedRender();
  }

  function syncBaseValueLabels() {
    const m = {
      natural:'naturalValue',brightness:'brightnessValue',contrast:'contrastValue',
      saturation:'saturationValue',sharp:'sharpValue',rotate:'rotateValue'
    };
    Object.entries(m).forEach(([id,lid]) => {
      const el=$(id), lab=$(lid);
      if (!el || !lab) return;
      lab.textContent = id === 'rotate' ? `${el.value}°` : el.value;
    });
  }

  $('nfUndo').addEventListener('click', () => {
    if (history.length < 2) return;
    const current = history.pop();
    future.push(current);
    restoreState(history[history.length - 1]);
    updateUndoButtons();
  });
  $('nfRedo').addEventListener('click', () => {
    const s = future.pop();
    if (!s) return;
    history.push(s);
    restoreState(s);
    updateUndoButtons();
  });

  $('flipButton')?.addEventListener('click', () => {
    if (!restoring) { flipParity ^= 1; scheduleHistory(); requestAdvancedRender(); }
  });
  $('rotate90Button')?.addEventListener('click', () => {
    if (!restoring) { rotate90Steps = (rotate90Steps + 1) % 4; scheduleHistory(); requestAdvancedRender(); }
  });
  $('resetButton')?.addEventListener('click', () => {
    if (restoring) return;
    adv.temp.value = 0; adv.tint.value = 0; adv.faceBright.value = 0; adv.bgBright.value = 0; adv.bgBlur.value = 0; adv.crop.value = 'none';
    flipParity = 0; rotate90Steps = 0; syncAdvLabels(); scheduleHistory(); requestAdvancedRender();
  });

  baseIds.forEach(id => {
    $(id)?.addEventListener('input', () => {
      if (forcingBase || restoring) return;
      requestAdvancedRender();
      scheduleHistory();
    });
  });

  ['showGuide','showDistortion','showPoseGuide','showHandGuide'].forEach(id => {
    $(id)?.addEventListener('change', requestAdvancedRender);
  });

  Object.values(adv).forEach(el => {
    el?.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      syncAdvLabels();
      requestAdvancedRender();
      scheduleHistory();
    });
  });

  $('nfApplyCrop').addEventListener('click', () => {
    requestAdvancedRender();
    scheduleHistory();
  });

  function captureOriginalFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setOriginal(String(reader.result));
    reader.readAsDataURL(file);
  }

  function setOriginal(src) {
    originalDataUrl = src || '';
    if (!src) { originalImage = null; return; }
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      $('nfCompareBefore').src = src;
      setTimeout(updateComparison, 200);
    };
    img.src = src;
  }

  $('fileInput')?.addEventListener('change', (e) => {
    captureOriginalFromFile(e.target.files?.[0]);
    setTimeout(() => { history = [readState()]; future=[]; updateUndoButtons(); requestAdvancedRender(); }, 450);
  });

  $('nfCaptureBase').addEventListener('click', () => {
    if (!canvas.width || !canvas.height) return alert('先に画像を読み込んでね');
    setOriginal(canvas.toDataURL('image/jpeg', .94));
    history = [readState()]; future=[]; updateUndoButtons();
  });

  function forceBaseRedraw() {
    const el = $('brightness');
    if (!el) return;
    forcingBase = true;
    el.dispatchEvent(new Event('input', {bubbles:true}));
    requestAnimationFrame(() => { forcingBase = false; });
  }

  function requestAdvancedRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(async () => {
      if (!canvas.width || !canvas.height) return;
      forceBaseRedraw();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await applyAdvancedToMain();
    }, 90);
  }

  function cloneCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src,0,0);
    return c;
  }

  function pixelWhiteBalance(c, temp, tint) {
    if (!temp && !tint) return;
    const x = c.getContext('2d', {willReadFrequently:true});
    const img = x.getImageData(0,0,c.width,c.height);
    const d = img.data;
    const t = temp / 100;
    const g = tint / 100;
    for (let i=0;i<d.length;i+=4) {
      d[i] = Math.max(0,Math.min(255,d[i] + 28*t + 7*g));
      d[i+1] = Math.max(0,Math.min(255,d[i+1] - 14*g));
      d[i+2] = Math.max(0,Math.min(255,d[i+2] - 28*t + 7*g));
    }
    x.putImageData(img,0,0);
  }

  function fallbackSubjectBox(w,h) {
    const fw = w*.34, fh = h*.42;
    return {x:(w-fw)/2,y:h*.17,w:fw,h:fh};
  }

  async function detectFaceBox(c) {
    // Fast native detector when the browser exposes it; otherwise use a safe portrait-center fallback.
    try {
      if ('FaceDetector' in window) {
        const detector = new FaceDetector({fastMode:true,maxDetectedFaces:1});
        const faces = await detector.detect(c);
        if (faces?.[0]?.boundingBox) {
          const b=faces[0].boundingBox;
          return {x:b.x,y:b.y,w:b.width,h:b.height};
        }
      }
    } catch {}
    return fallbackSubjectBox(c.width,c.height);
  }

  function ellipseMask(w,h,box,expandX=1.8,expandY=2.8) {
    const c=document.createElement('canvas'); c.width=w;c.height=h;
    const x=c.getContext('2d');
    const cx=box.x+box.w/2, cy=box.y+box.h*.75;
    const rx=Math.min(w*.48,box.w*expandX), ry=Math.min(h*.60,box.h*expandY);
    x.save();
    x.translate(cx,cy); x.scale(rx,ry);
    const grad=x.createRadialGradient(0,0,.72,0,0,1);
    grad.addColorStop(0,'rgba(255,255,255,1)');
    grad.addColorStop(.82,'rgba(255,255,255,.98)');
    grad.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=grad;
    x.beginPath(); x.arc(0,0,1,0,Math.PI*2); x.fill();
    x.restore();
    return c;
  }

  function faceMask(w,h,box) {
    const c=document.createElement('canvas'); c.width=w;c.height=h;
    const x=c.getContext('2d');
    const cx=box.x+box.w/2,cy=box.y+box.h/2;
    const rx=box.w*.72,ry=box.h*.78;
    x.save();x.translate(cx,cy);x.scale(rx,ry);
    const grad=x.createRadialGradient(0,0,.68,0,0,1);
    grad.addColorStop(0,'white');grad.addColorStop(.82,'rgba(255,255,255,.96)');grad.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=grad;x.beginPath();x.arc(0,0,1,0,Math.PI*2);x.fill();x.restore();
    return c;
  }

  function filteredCopy(src, filter) {
    const c=document.createElement('canvas');c.width=src.width;c.height=src.height;
    const x=c.getContext('2d');x.filter=filter;x.drawImage(src,0,0);x.filter='none';
    return c;
  }

  function maskedComposite(dst, layer, mask, inverse=false) {
    const temp=document.createElement('canvas');temp.width=dst.width;temp.height=dst.height;
    const t=temp.getContext('2d');t.drawImage(layer,0,0);
    t.globalCompositeOperation='destination-in';
    if (!inverse) t.drawImage(mask,0,0);
    else {
      const inv=document.createElement('canvas');inv.width=dst.width;inv.height=dst.height;
      const ix=inv.getContext('2d');ix.fillStyle='white';ix.fillRect(0,0,inv.width,inv.height);
      ix.globalCompositeOperation='destination-out';ix.drawImage(mask,0,0);
      t.drawImage(inv,0,0);
    }
    dst.getContext('2d').drawImage(temp,0,0);
  }

  function cropRectForPreset(w,h,preset,faceBox) {
    if (!preset || preset==='none') return {x:0,y:0,w,h};
    let ratio=1;
    if (preset==='4:5') ratio=4/5;
    else if (preset==='9:16') ratio=9/16;
    else if (preset==='16:9') ratio=16/9;
    const center = preset==='face-square' && faceBox
      ? {x:faceBox.x+faceBox.w/2,y:Math.min(h*.65,faceBox.y+faceBox.h*.72)}
      : {x:w/2,y:h/2};
    let cw=w,ch=h;
    if (w/h>ratio) cw=h*ratio; else ch=w/ratio;
    let x=Math.max(0,Math.min(w-cw,center.x-cw/2));
    let y=Math.max(0,Math.min(h-ch,center.y-ch/2));
    return {x,y,w:cw,h:ch};
  }

  async function applyAdvancedCanvas(base, state) {
    let work=cloneCanvas(base);
    pixelWhiteBalance(work,state.adv.temp,state.adv.tint);
    const faceBox=await detectFaceBox(work);
    const subject=ellipseMask(work.width,work.height,faceBox);
    const face=faceMask(work.width,work.height,faceBox);

    if (state.adv.bgBlur>0) {
      const blurred=filteredCopy(work,`blur(${state.adv.bgBlur}px)`);
      const out=cloneCanvas(blurred);
      maskedComposite(out,work,subject,false);
      work=out;
    }
    if (state.adv.bgBright!==0) {
      const amount=Math.max(40,100+state.adv.bgBright);
      const layer=filteredCopy(work,`brightness(${amount}%)`);
      maskedComposite(work,layer,subject,true);
    }
    if (state.adv.faceBright!==0) {
      const amount=Math.max(50,100+state.adv.faceBright);
      const layer=filteredCopy(work,`brightness(${amount}%)`);
      maskedComposite(work,layer,face,false);
    }

    const crop=cropRectForPreset(work.width,work.height,state.adv.crop,faceBox);
    if (crop.x!==0 || crop.y!==0 || crop.w!==work.width || crop.h!==work.height) {
      const out=document.createElement('canvas');
      out.width=Math.max(2,Math.round(crop.w));out.height=Math.max(2,Math.round(crop.h));
      out.getContext('2d').drawImage(work,crop.x,crop.y,crop.w,crop.h,0,0,out.width,out.height);
      work=out;
    }
    return work;
  }

  async function applyAdvancedToMain() {
    if (applying || !canvas.width || !canvas.height) return;
    applying=true;
    try {
      const base=cloneCanvas(canvas);
      const out=await applyAdvancedCanvas(base,readState());
      canvas.width=out.width;canvas.height=out.height;
      canvas.getContext('2d').drawImage(out,0,0);
      updateComparison();
    } finally { applying=false; }
  }

  function updateComparison() {
    if (!canvas.width || !canvas.height) return;
    try {
      $('nfCompareAfter').src=canvas.toDataURL('image/jpeg',.86);
      if (!originalDataUrl) $('nfCompareBefore').src=canvas.toDataURL('image/jpeg',.86);
    } catch {}
  }

  $('nfCompareSlider').addEventListener('input',e=>{
    const v=Number(e.target.value);
    $('nfCompareAfterWrap').style.clipPath=`inset(0 ${100-v}% 0 0)`;
    $('nfCompareLine').style.left=`${v}%`;
  });

  async function autoWhiteBalance() {
    if (!canvas.width || !canvas.height) return;
    forceBaseRedraw();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const sample=cloneCanvas(canvas);
    const x=sample.getContext('2d',{willReadFrequently:true});
    const img=x.getImageData(0,0,sample.width,sample.height).data;
    let r=0,g=0,b=0,n=0;
    const step=Math.max(4,Math.floor(Math.sqrt((sample.width*sample.height)/24000))*4);
    for(let i=0;i<img.length;i+=step){
      const a=img[i+3]; if(a<200) continue;
      r+=img[i];g+=img[i+1];b+=img[i+2];n++;
    }
    if(!n)return;
    r/=n;g/=n;b/=n;
    const temp=Math.max(-100,Math.min(100,(b-r)*1.25));
    const tint=Math.max(-100,Math.min(100,(((r+b)/2)-g)*1.1));
    adv.temp.value=Math.round(temp);adv.tint.value=Math.round(tint);
    syncAdvLabels();requestAdvancedRender();scheduleHistory();
  }
  $('nfAutoWB').addEventListener('click',autoWhiteBalance);
  $('nfResetWB').addEventListener('click',()=>{adv.temp.value=0;adv.tint.value=0;syncAdvLabels();requestAdvancedRender();scheduleHistory();});

  const BUILTINS={
    natural:{natural:55,brightness:102,contrast:96,saturation:92,sharp:8,temp:0,tint:0,faceBright:4,bgBright:0,bgBlur:0},
    bright:{natural:35,brightness:110,contrast:98,saturation:102,sharp:6,temp:3,tint:0,faceBright:8,bgBright:2,bgBlur:0},
    sns:{natural:25,brightness:105,contrast:106,saturation:110,sharp:10,temp:4,tint:0,faceBright:6,bgBright:-2,bgBlur:2},
    night:{natural:30,brightness:108,contrast:108,saturation:96,sharp:8,temp:8,tint:2,faceBright:10,bgBright:-8,bgBlur:3}
  };

  function applyPresetObj(p) {
    ['natural','brightness','contrast','saturation','sharp'].forEach(id=>{if(p[id]!=null&&$(id))$(id).value=p[id];});
    if(p.temp!=null)adv.temp.value=p.temp;if(p.tint!=null)adv.tint.value=p.tint;
    if(p.faceBright!=null)adv.faceBright.value=p.faceBright;if(p.bgBright!=null)adv.bgBright.value=p.bgBright;if(p.bgBlur!=null)adv.bgBlur.value=p.bgBlur;
    syncBaseValueLabels();syncAdvLabels();requestAdvancedRender();scheduleHistory();
  }

  function customPresets() {
    try{return JSON.parse(localStorage.getItem(STORAGE_PRESETS)||'{}')||{};}catch{return{};}
  }
  function refreshPresetSelect() {
    const sel=$('nfPresetSelect');
    [...sel.options].filter(o=>o.value.startsWith('custom:')).forEach(o=>o.remove());
    const p=customPresets();
    Object.keys(p).sort().forEach(name=>{const o=document.createElement('option');o.value=`custom:${name}`;o.textContent=`★ ${name}`;sel.appendChild(o);});
  }
  refreshPresetSelect();

  $('nfApplyPreset').addEventListener('click',()=>{
    const v=$('nfPresetSelect').value;if(!v)return;
    if(v.startsWith('builtin:'))applyPresetObj(BUILTINS[v.slice(8)]);
    else if(v.startsWith('custom:'))applyPresetObj(customPresets()[v.slice(7)]||{});
  });
  $('nfSavePreset').addEventListener('click',()=>{
    const name=prompt('プリセット名を入れてね');if(!name)return;
    const all=customPresets(),s=readState();
    all[name.trim()]={...s.base,...s.adv};
    localStorage.setItem(STORAGE_PRESETS,JSON.stringify(all));refreshPresetSelect();
    $('nfPresetSelect').value=`custom:${name.trim()}`;
  });
  $('nfDeletePreset').addEventListener('click',()=>{
    const v=$('nfPresetSelect').value;if(!v.startsWith('custom:'))return alert('削除できるのは自分で保存したプリセットだけだよ');
    const all=customPresets();delete all[v.slice(7)];localStorage.setItem(STORAGE_PRESETS,JSON.stringify(all));refreshPresetSelect();$('nfPresetSelect').value='';
  });

  function loadFileImage(file) {
    return new Promise((resolve,reject)=>{
      const r=new FileReader();
      r.onload=()=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=r.result;};
      r.onerror=reject;r.readAsDataURL(file);
    });
  }

  function baseRenderForBatch(img,state) {
    const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const bw=Math.max(2,Math.round(img.naturalWidth*scale)),bh=Math.max(2,Math.round(img.naturalHeight*scale));
    const angle=(Number(state.base.rotate||0)+state.rotate90Steps*90)*Math.PI/180;
    const quarter=((state.rotate90Steps%2)+2)%2;
    const c=document.createElement('canvas');c.width=quarter?bh:bw;c.height=quarter?bw:bh;
    const x=c.getContext('2d');
    const n=Number(state.base.natural||0)/100;
    const br=Number(state.base.brightness||100)*(1-n)+100*n;
    const co=Number(state.base.contrast||100)*(1-n)+94*n;
    const sa=Number(state.base.saturation||100)*(1-n)+90*n;
    x.filter=`brightness(${br}%) contrast(${co}%) saturate(${sa}%)`;
    x.translate(c.width/2,c.height/2);x.rotate(angle);if(state.flipParity)x.scale(-1,1);
    x.drawImage(img,-bw/2,-bh/2,bw,bh);x.setTransform(1,0,0,1,0,0);x.filter='none';
    return c;
  }

  async function downloadCanvas(c,name) {
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.94));
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }

  $('nfBatchRun').addEventListener('click',async()=>{
    const files=[...$('nfBatchFiles').files].slice(0,10);
    if(!files.length)return alert('一括処理する画像を選んでね');
    $('nfBatchRun').disabled=true;
    const state=readState();
    try{
      for(let i=0;i<files.length;i++){
        $('nfBatchStatus').textContent=`${i+1}/${files.length} 処理中…`;
        const img=await loadFileImage(files[i]);
        const base=baseRenderForBatch(img,state);
        const out=await applyAdvancedCanvas(base,state);
        const stem=files[i].name.replace(/\.[^.]+$/,'');
        await downloadCanvas(out,`${stem}_NaturalFix.jpg`);
        await new Promise(r=>setTimeout(r,350));
      }
      $('nfBatchStatus').textContent=`✅ ${files.length}枚 完了（EXIF/位置情報なし）`;
    }catch(e){console.error(e);$('nfBatchStatus').textContent=`⚠️ ${e.message}`;}
    finally{$('nfBatchRun').disabled=false;}
  });

  $('nfAdvancedSave').addEventListener('click',async()=>{
    if(!canvas.width||!canvas.height)return alert('先に画像を読み込んでね');
    // Current canvas is already a re-encoded bitmap, so EXIF/GPS metadata is not retained.
    await downloadCanvas(cloneCanvas(canvas),`NaturalFix_Final_${Date.now()}.jpg`);
  });

  for(let i=1;i<=3;i++){
    $(`refInput${i}`)?.addEventListener('change',e=>{
      const f=e.target.files?.[0];if(!f){refCopies[i-1]=null;return;}
      const r=new FileReader();r.onload=()=>{refCopies[i-1]=String(r.result)};r.readAsDataURL(f);
    });
  }

  function saveRefSettings() {
    const data={mode:$('realisticButton')?.classList.contains('active')?'realistic':'anime',pose:$('posePreset')?.value||'',prompt:$('multiRefPrompt')?.value||'',refs:[]};
    for(let i=1;i<=3;i++)data.refs.push({role:$(`refRole${i}`)?.value||'',strength:Number($(`refStrength${i}`)?.value||0)});
    localStorage.setItem(STORAGE_REF,JSON.stringify(data));
    alert('マルチリファレンス設定を端末に保存したよ');
  }
  function loadRefSettings() {
    let d;try{d=JSON.parse(localStorage.getItem(STORAGE_REF)||'null')}catch{}
    if(!d)return alert('保存済み設定がまだないよ');
    if(d.mode==='anime')$('animeButton')?.click();else $('realisticButton')?.click();
    if($('posePreset'))$('posePreset').value=d.pose||'';
    if($('multiRefPrompt'))$('multiRefPrompt').value=d.prompt||'';
    (d.refs||[]).forEach((r,idx)=>{const i=idx+1;if($(`refRole${i}`))$(`refRole${i}`).value=r.role;if($(`refStrength${i}`)){$(`refStrength${i}`).value=r.strength;$(`refStrengthValue${i}`).textContent=r.strength;}});
  }
  $('nfRefSettingsSave').addEventListener('click',saveRefSettings);
  $('nfRefSettingsLoad').addEventListener('click',loadRefSettings);

  function roundedRect(x,ctx,x0,y0,w,h,r){
    x.beginPath();x.roundRect?x.roundRect(x0,y0,w,h,r):(x.rect(x0,y0,w,h));x.fill();
  }

  function loadDataImage(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src;});}

  $('nfRefSheet').addEventListener('click',async()=>{
    if(!refCopies.some(Boolean))return alert('参考画像を1枚以上選んでね');
    const c=document.createElement('canvas');c.width=1500;c.height=1050;
    const x=c.getContext('2d');x.fillStyle='#111318';x.fillRect(0,0,c.width,c.height);
    x.fillStyle='white';x.font='bold 42px system-ui';x.fillText('NaturalFix マルチリファレンス準備シート',55,70);
    x.fillStyle='#aab2c0';x.font='22px system-ui';x.fillText(new Date().toLocaleString(),55,108);
    const gap=30,cardW=450,cardH=620,startX=45,y=145;
    for(let i=0;i<3;i++){
      const cx=startX+i*(cardW+gap);
      x.fillStyle='#20232b';roundedRect(x,x,cx,y,cardW,cardH,24);
      x.fillStyle='white';x.font='bold 28px system-ui';x.fillText(`参考画像 ${i+1}`,cx+24,y+44);
      if(refCopies[i]){
        try{
          const img=await loadDataImage(refCopies[i]);
          const box={x:cx+24,y:y+70,w:cardW-48,h:410};
          const scale=Math.max(box.w/img.width,box.h/img.height);
          const sw=box.w/scale,sh=box.h/scale,sx=(img.width-sw)/2,sy=(img.height-sh)/2;
          x.save();x.beginPath();x.roundRect?.(box.x,box.y,box.w,box.h,16);x.clip();
          x.drawImage(img,sx,sy,sw,sh,box.x,box.y,box.w,box.h);x.restore();
        }catch{}
      }else{
        x.fillStyle='#303641';x.fillRect(cx+24,y+70,cardW-48,410);
        x.fillStyle='#aab2c0';x.font='20px system-ui';x.fillText('画像なし',cx+175,y+285);
      }
      const role=$(`refRole${i+1}`)?.selectedOptions?.[0]?.textContent||'';
      const strength=$(`refStrength${i+1}`)?.value||'0';
      x.fillStyle='white';x.font='22px system-ui';x.fillText(`役割: ${role}`,cx+24,y+530);
      x.fillStyle='#bdc7ff';x.fillText(`反映度: ${strength}`,cx+24,y+570);
    }
    x.fillStyle='#20232b';roundedRect(x,x,45,800,1410,205,22);
    x.fillStyle='white';x.font='bold 24px system-ui';x.fillText(`ポーズ / カメラ: ${$('posePreset')?.selectedOptions?.[0]?.textContent||'指定なし'}`,70,845);
    const promptText=($('multiRefPrompt')?.value||'（編集指示なし）').replace(/\s+/g,' ');
    x.fillStyle='#aab2c0';x.font='21px system-ui';
    const max=80;for(let i=0;i<promptText.length;i+=max)x.fillText(promptText.slice(i,i+max),70,895+(i/max)*32);
    await downloadCanvas(c,`NaturalFix_MultiRef_${Date.now()}.jpg`);
  });

  // Keep a private copy of each reference role/strength history change.
  for(let i=1;i<=3;i++){
    $(`refRole${i}`)?.addEventListener('change',scheduleHistory);
    $(`refStrength${i}`)?.addEventListener('input',scheduleHistory);
  }

  // If an image was already on the canvas when the add-on loaded, use it as the initial comparison source.
  setTimeout(() => {
    try {
      if (canvas.width > 2 && canvas.height > 2) setOriginal(canvas.toDataURL('image/jpeg',.92));
    } catch {}
    history=[readState()];
    updateUndoButtons();
    syncAdvLabels();
  }, 900);
})();
