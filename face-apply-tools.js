/* NaturalFix Face Apply Tools v1.1 */
(() => {
  'use strict';

  const $ = (id) =>
    document.getElementById(id);

  const canvas = $('canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let baseImageData = null;
  let correctedDataUrl = null;
  let needsRedetect = false;

  const card =
    document.createElement('section');

  card.id = 'nfFaceApplyTools';
  card.className = 'card';

  card.innerHTML = `
    <h3>✨ 顔ごとの補正を画像へ反映</h3>

    <p class="note">
      人物ごとに保存した
      明るさ・コントラスト・彩度を
      選んだ顔だけに反映するよ。
    </p>

    <div class="buttons three">
      <button
        id="nfApplyFaceCorrections"
        type="button"
        class="primary"
      >
        ✨ 保存した顔補正を適用
      </button>

      <button
        id="nfUndoFaceCorrections"
        type="button"
      >
        ↩ 適用前に戻す
      </button>

      <button
        id="nfDownloadFaceCorrections"
        type="button"
        class="green"
      >
        💾 顔補正済みJPG保存
      </button>
    </div>

    <div
      id="nfFaceApplyStatus"
      class="status"
      style="margin-top:8px"
    >
      人物認識と補正保存のあとに使ってね
    </div>
  `;

  const faceCard =
    $('nfFaceTools');

  if (faceCard) {
    faceCard.insertAdjacentElement(
      'afterend',
      card
    );
  } else {
    document
      .querySelector('.container')
      ?.appendChild(card);
  }

  function setStatus(text) {
    const el =
      $('nfFaceApplyStatus');

    if (el) {
      el.textContent = text;
    }
  }

  function nextPaint() {
    return new Promise(
      (resolve) => {
        requestAnimationFrame(
          () =>
            requestAnimationFrame(resolve)
        );
      }
    );
  }

  async function hideGuidesAndRedraw() {
    const ids = [
      'showGuide',
      'showDistortion',
      'showPoseGuide',
      'showHandGuide'
    ];

    let changed = false;

    for (const id of ids) {
      const el = $(id);

      if (el?.checked) {
        el.checked = false;

        el.dispatchEvent(
          new Event(
            'change',
            { bubbles: true }
          )
        );

        changed = true;
      }
    }

    if (changed) {
      await nextPaint();
    }
  }

  function makeSourceCanvas() {
    if (!baseImageData) {
      return null;
    }

    const source =
      document.createElement('canvas');

    source.width = canvas.width;
    source.height = canvas.height;

    const sourceCtx =
      source.getContext('2d');

    if (!sourceCtx) {
      return null;
    }

    sourceCtx.putImageData(
      baseImageData,
      0,
      0
    );

    return source;
  }

  function applyOneFace(
    source,
    person,
    correction
  ) {
    const box = person?.box;

    if (!box) {
      return false;
    }

    const x = Math.max(
      0,
      Math.floor(
        box.x * canvas.width
      )
    );

    const y = Math.max(
      0,
      Math.floor(
        box.y * canvas.height
      )
    );

    const right = Math.min(
      canvas.width,
      Math.ceil(
        (box.x + box.w) *
        canvas.width
      )
    );

    const bottom = Math.min(
      canvas.height,
      Math.ceil(
        (box.y + box.h) *
        canvas.height
      )
    );

    const w = right - x;
    const h = bottom - y;

    if (w <= 1 || h <= 1) {
      return false;
    }

    const brightness =
      Number(
        correction?.brightness ??
        100
      );

    const contrast =
      Number(
        correction?.contrast ??
        100
      );

    const saturation =
      Number(
        correction?.saturation ??
        100
      );

    const temp =
      document.createElement('canvas');

    temp.width = w;
    temp.height = h;

    const tempCtx =
      temp.getContext('2d');

    if (!tempCtx) {
      return false;
    }

    tempCtx.filter =
      `brightness(${brightness}%) ` +
      `contrast(${contrast}%) ` +
      `saturate(${saturation}%)`;

    tempCtx.drawImage(
      source,
      x,
      y,
      w,
      h,
      0,
      0,
      w,
      h
    );

    tempCtx.filter = 'none';

    const mask =
      document.createElement('canvas');

    mask.width = w;
    mask.height = h;

    const maskCtx =
      mask.getContext('2d');

    if (!maskCtx) {
      return false;
    }

    const blur = Math.max(
      4,
      Math.round(
        Math.min(w, h) * 0.08
      )
    );

    maskCtx.filter =
      `blur(${blur}px)`;

    maskCtx.fillStyle = '#fff';

    maskCtx.beginPath();

    maskCtx.ellipse(
      w / 2,
      h / 2,
      w * 0.40,
      h * 0.44,
      0,
      0,
      Math.PI * 2
    );

    maskCtx.fill();

    tempCtx.globalCompositeOperation =
      'destination-in';

    tempCtx.drawImage(
      mask,
      0,
      0
    );

    tempCtx.globalCompositeOperation =
      'source-over';

    ctx.drawImage(
      temp,
      x,
      y
    );

    return true;
  }

  async function applyCorrections() {
    const personsApi =
      window.NaturalFixPersons;

    const faceApi =
      window.NaturalFixFaceTools;

    if (
      !personsApi ||
      !faceApi
    ) {
      setStatus(
        '⚠️ 人物認識または顔補正機能が準備できてないよ'
      );
      return;
    }

    const people =
      personsApi.getPeople();

    if (!people.length) {
      setStatus(
        '先に複数人物を認識してね'
      );
      return;
    }

    if (needsRedetect) {
      setStatus(
        '⚠️ 回転・反転後は、もう一度「複数人物を認識」してね'
      );
      return;
    }

    const corrections =
      faceApi.getAllCorrections();

    if (!corrections.size) {
      setStatus(
        '先に人物ごとの補正を保存してね'
      );
      return;
    }

    if (
      !canvas.width ||
      !canvas.height
    ) {
      setStatus(
        '先に画像を読み込んでね'
      );
      return;
    }

    try {
      setStatus(
        '✨ 顔補正を準備中…'
      );

      if (!baseImageData) {
        await hideGuidesAndRedraw();

        baseImageData =
          ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          );
      }

      ctx.putImageData(
        baseImageData,
        0,
        0
      );

      const source =
        makeSourceCanvas();

      if (!source) {
        setStatus(
          '⚠️ 元画像を準備できなかったよ'
        );
        return;
      }

      let applied = 0;

      for (
        const [index, correction]
        of corrections.entries()
      ) {
        const person =
          people[index];

        if (!person) {
          continue;
        }

        if (
          applyOneFace(
            source,
            person,
            correction
          )
        ) {
          applied += 1;
        }
      }

      if (!applied) {
        setStatus(
          '反映できる人物の補正がなかったよ'
        );
        return;
      }

      correctedDataUrl =
        canvas.toDataURL(
          'image/jpeg',
          0.95
        );

      setStatus(
        `✅ ${applied}人分の顔補正を反映したよ`
      );

      window.dispatchEvent(
        new CustomEvent(
          'naturalfix:face-corrections-applied',
          {
            detail: {
              count: applied
            }
          }
        )
      );
    } catch (error) {
      console.error(error);

      setStatus(
        `⚠️ 顔補正エラー: ${
          error.message ||
          'unknown error'
        }`
      );
    }
  }

  function undoCorrections() {
    if (!baseImageData) {
      setStatus(
        'まだ顔補正を適用してないよ'
      );
      return;
    }

    ctx.putImageData(
      baseImageData,
      0,
      0
    );

    baseImageData = null;
    correctedDataUrl = null;

    setStatus(
      '↩ 顔補正の適用前に戻したよ'
    );
  }

  function downloadCorrected() {
    if (!correctedDataUrl) {
      setStatus(
        '先に「保存した顔補正を適用」を押してね'
      );
      return;
    }

    const a =
      document.createElement('a');

    a.href =
      correctedDataUrl;

    a.download =
      `NaturalFix_face_${Date.now()}.jpg`;

    a.click();
  }

  function invalidateBase(
    message
  ) {
    baseImageData = null;
    correctedDataUrl = null;

    if (message) {
      setStatus(message);
    }
  }

  $('nfApplyFaceCorrections')
    ?.addEventListener(
      'click',
      applyCorrections
    );

  $('nfUndoFaceCorrections')
    ?.addEventListener(
      'click',
      undoCorrections
    );

  $('nfDownloadFaceCorrections')
    ?.addEventListener(
      'click',
      downloadCorrected
    );

  $('fileInput')
    ?.addEventListener(
      'change',
      () => {
        needsRedetect = false;

        invalidateBase(
          '人物認識と補正保存のあとに使ってね'
        );
      }
    );

  window.addEventListener(
    'naturalfix:people-detected',
    () => {
      needsRedetect = false;

      invalidateBase(
        '✅ 人物位置を更新したよ。補正を保存して適用してね'
      );
    }
  );

  window.addEventListener(
    'naturalfix:people-cleared',
    () => {
      needsRedetect = false;

      invalidateBase(
        '先に複数人物を認識してね'
      );
    }
  );

  window.addEventListener(
    'naturalfix:face-correction-changed',
    () => {
      correctedDataUrl = null;

      setStatus(
        '補正設定を更新したよ。「顔補正を適用」で反映してね'
      );
    }
  );

  [
    'natural',
    'brightness',
    'contrast',
    'saturation',
    'sharp'
  ].forEach(
    (id) => {
      $(id)?.addEventListener(
        'input',
        () => {
          invalidateBase(
            '画像全体の補正が変わったよ。顔補正をもう一度適用してね'
          );
        }
      );
    }
  );

  $('rotate')
    ?.addEventListener(
      'input',
      () => {
        needsRedetect = true;

        invalidateBase(
          '回転後は、もう一度「複数人物を認識」してね'
        );
      }
    );

  [
    'flipButton',
    'rotate90Button',
    'resetButton'
  ].forEach(
    (id) => {
      $(id)?.addEventListener(
        'click',
        () => {
          needsRedetect = true;

          invalidateBase(
            '向きが変わったので、もう一度「複数人物を認識」してね'
          );
        }
      );
    }
  );

  window.NaturalFixFaceApply = {
    apply: applyCorrections,
    undo: undoCorrections,
    download: downloadCorrected
  };
})();
