/* NaturalFix Background Tools v1.1
   - AI人物切り抜き
   - 背景透明化
   - 透過PNG保存
   - 元画像へ戻す
*/
(() => {
  'use strict';

  const $ = (id) =>
    document.getElementById(id);

  const canvas = $('canvas');
  if (!canvas) return;

  const ctx =
    canvas.getContext(
      '2d',
      { willReadFrequently: true }
    );

  if (!ctx) return;

  let segmenter = null;
  let modelLoading = false;
  let busy = false;

  let originalImageData = null;
  let transparentDataUrl = null;

  const card =
    document.createElement('section');

  card.id = 'nfBackgroundTools';
  card.className = 'card';

  card.innerHTML = `
    <h3>✂️ AI背景削除</h3>

    <p class="note">
      AIで人物を判定して、
      背景を透明にするよ。
      処理は端末内で行うよ。
    </p>

    <div
      id="nfBackgroundModelStatus"
      class="status"
    >
      AI背景モデルを準備中…
    </div>

    <div
      class="buttons three"
      style="margin-top:10px"
    >
      <button
        id="nfRemoveBackground"
        type="button"
        class="primary"
      >
        ✂️ 背景を削除
      </button>

      <button
        id="nfRestoreBackground"
        type="button"
      >
        ↩ 元に戻す
      </button>

      <button
        id="nfSaveTransparentPng"
        type="button"
        class="green"
      >
        💾 透過PNG保存
      </button>
    </div>

    <div
      id="nfBackgroundStatus"
      class="status"
      style="margin-top:8px"
    >
      画像を読み込んでね
    </div>
  `;

  const faceApplyCard =
    $('nfFaceApplyTools');

  const faceCard =
    $('nfFaceTools');

  if (faceApplyCard) {
    faceApplyCard
      .insertAdjacentElement(
        'afterend',
        card
      );
  } else if (faceCard) {
    faceCard
      .insertAdjacentElement(
        'afterend',
        card
      );
  } else {
    document
      .querySelector('.container')
      ?.appendChild(card);
  }

  function setModelStatus(text) {
    const el =
      $('nfBackgroundModelStatus');

    if (el) {
      el.textContent = text;
    }
  }

  function setStatus(text) {
    const el =
      $('nfBackgroundStatus');

    if (el) {
      el.textContent = text;
    }
  }

  function nextPaint() {
    return new Promise(
      (resolve) => {
        requestAnimationFrame(
          () => {
            requestAnimationFrame(
              resolve
            );
          }
        );
      }
    );
  }

  async function captureCleanCanvas() {
    const guideIds = [
      'showGuide',
      'showDistortion',
      'showPoseGuide',
      'showHandGuide'
    ];

    const previousStates =
      guideIds.map(
        (id) => {
          const el = $(id);

          return {
            el,
            checked:
              Boolean(el?.checked)
          };
        }
      );

    let changed = false;

    for (
      const item
      of previousStates
    ) {
      if (
        item.el &&
        item.el.checked
      ) {
        item.el.checked = false;

        item.el.dispatchEvent(
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

    const source =
      document.createElement(
        'canvas'
      );

    source.width =
      canvas.width;

    source.height =
      canvas.height;

    const sourceCtx =
      source.getContext('2d');

    if (!sourceCtx) {
      return null;
    }

    sourceCtx.drawImage(
      canvas,
      0,
      0
    );

    for (
      const item
      of previousStates
    ) {
      if (item.el) {
        item.el.checked =
          item.checked;
      }
    }

    return source;
  }

  async function initSegmenter() {
    if (
      segmenter ||
      modelLoading
    ) {
      return;
    }

    modelLoading = true;

    try {
      setModelStatus(
        'AI背景モデルを読み込み中…'
      );

      const {
        FilesetResolver,
        ImageSegmenter
      } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm'
      );

      const vision =
        await FilesetResolver
          .forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
          );

      segmenter =
        await ImageSegmenter
          .createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath:
                  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
              },

              runningMode:
                'IMAGE',

              outputCategoryMask:
                false,

              outputConfidenceMasks:
                true
            }
          );

      setModelStatus(
        '✅ AI背景モデル準備OK'
      );
    } catch (error) {
      console.error(error);

      segmenter = null;

      setModelStatus(
        '⚠️ AI背景モデルを読み込めなかったよ'
      );
    } finally {
      modelLoading = false;
    }
  }

  function smoothConfidence(value) {
    const low = 0.15;
    const high = 0.85;

    const t =
      Math.max(
        0,
        Math.min(
          1,
          (value - low) /
          (high - low)
        )
      );

    return (
      t * t *
      (3 - 2 * t)
    );
  }

  function createMaskCanvas(
    mask,
    width,
    height
  ) {
    const values =
      mask.getAsFloat32Array();

    const maskWidth =
      mask.width;

    const maskHeight =
      mask.height;

    if (
      !maskWidth ||
      !maskHeight
    ) {
      return null;
    }

    const small =
      document.createElement(
        'canvas'
      );

    small.width =
      maskWidth;

    small.height =
      maskHeight;

    const smallCtx =
      small.getContext('2d');

    if (!smallCtx) {
      return null;
    }

    const pixels =
      new Uint8ClampedArray(
        maskWidth *
        maskHeight *
        4
      );

    for (
      let i = 0;
      i < values.length;
      i += 1
    ) {
      const confidence =
        smoothConfidence(
          values[i]
        );

      const alpha =
        Math.round(
          confidence * 255
        );

      const p = i * 4;

      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
      pixels[p + 3] = alpha;
    }

    smallCtx.putImageData(
      new ImageData(
        pixels,
        maskWidth,
        maskHeight
      ),
      0,
      0
    );

    const full =
      document.createElement(
        'canvas'
      );

    full.width = width;
    full.height = height;

    const fullCtx =
      full.getContext('2d');

    if (!fullCtx) {
      return null;
    }

    fullCtx.imageSmoothingEnabled =
      true;

    fullCtx.drawImage(
      small,
      0,
      0,
      width,
      height
    );

    return full;
  }

  async function removeBackground() {
    if (busy) return;

    if (
      !canvas.width ||
      !canvas.height
    ) {
      setStatus(
        '先に画像を読み込んでね'
      );
      return;
    }

    if (!segmenter) {
      await initSegmenter();

      if (!segmenter) {
        setStatus(
          'AI背景モデルを準備できなかったよ'
        );
        return;
      }
    }

    busy = true;

    const button =
      $('nfRemoveBackground');

    if (button) {
      button.disabled = true;
    }

    let mask = null;

    try {
      setStatus(
        '✂️ AIが人物を判定中…'
      );

      const source =
        await captureCleanCanvas();

      if (!source) {
        throw new Error(
          'source canvas error'
        );
      }

      originalImageData =
        ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        );

      const result =
        segmenter.segment(
          source
        );

      mask =
        result
          ?.confidenceMasks
          ?.[0];

      if (!mask) {
        throw new Error(
          'person mask not found'
        );
      }

      const maskCanvas =
        createMaskCanvas(
          mask,
          canvas.width,
          canvas.height
        );

      if (!maskCanvas) {
        throw new Error(
          'mask canvas error'
        );
      }

      const output =
        document.createElement(
          'canvas'
        );

      output.width =
        canvas.width;

      output.height =
        canvas.height;

      const outputCtx =
        output.getContext('2d');

      if (!outputCtx) {
        throw new Error(
          'output canvas error'
        );
      }

      outputCtx.drawImage(
        source,
        0,
        0
      );

      outputCtx
        .globalCompositeOperation =
        'destination-in';

      outputCtx.drawImage(
        maskCanvas,
        0,
        0
      );

      outputCtx
        .globalCompositeOperation =
        'source-over';

      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      ctx.drawImage(
        output,
        0,
        0
      );

      transparentDataUrl =
        output.toDataURL(
          'image/png'
        );

      setStatus(
        '✅ 背景を透明にしたよ'
      );

      window.dispatchEvent(
        new CustomEvent(
          'naturalfix:background-removed'
        )
      );
    } catch (error) {
      console.error(error);

      originalImageData = null;
      transparentDataUrl = null;

      setStatus(
        `⚠️ 背景削除エラー: ${
          error.message ||
          'unknown error'
        }`
      );
    } finally {
      mask?.close?.();

      busy = false;

      if (button) {
        button.disabled = false;
      }
    }
  }

  function restoreBackground() {
    if (!originalImageData) {
      setStatus(
        'まだ背景削除してないよ'
      );
      return;
    }

    if (
      originalImageData.width !==
        canvas.width ||
      originalImageData.height !==
        canvas.height
    ) {
      originalImageData = null;
      transparentDataUrl = null;

      setStatus(
        '画像サイズが変わったので、もう一度画像を読み込んでね'
      );

      return;
    }

    ctx.putImageData(
      originalImageData,
      0,
      0
    );

    originalImageData = null;
    transparentDataUrl = null;

    setStatus(
      '↩ 背景削除前に戻したよ'
    );
  }

  function saveTransparentPng() {
    if (!transparentDataUrl) {
      setStatus(
        '先に「背景を削除」を押してね'
      );
      return;
    }

    const a =
      document.createElement('a');

    a.href =
      transparentDataUrl;

    a.download =
      `NaturalFix_transparent_${Date.now()}.png`;

    a.click();
  }

  function resetState(message) {
    originalImageData = null;
    transparentDataUrl = null;

    setStatus(
      message ||
      '画像を読み込んでね'
    );
  }

  $('nfRemoveBackground')
    ?.addEventListener(
      'click',
      removeBackground
    );

  $('nfRestoreBackground')
    ?.addEventListener(
      'click',
      restoreBackground
    );

  $('nfSaveTransparentPng')
    ?.addEventListener(
      'click',
      saveTransparentPng
    );

  $('fileInput')
    ?.addEventListener(
      'change',
      () => {
        resetState(
          '画像を読み込んでね'
        );
      }
    );

  [
    'natural',
    'brightness',
    'contrast',
    'saturation',
    'sharp',
    'rotate'
  ].forEach(
    (id) => {
      $(id)?.addEventListener(
        'input',
        () => {
          if (
            originalImageData ||
            transparentDataUrl
          ) {
            resetState(
              '画像補正が変わったので、背景削除をもう一度実行してね'
            );
          }
        }
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
          if (
            originalImageData ||
            transparentDataUrl
          ) {
            resetState(
              '画像の向きが変わったので、背景削除をもう一度実行してね'
            );
          }
        }
      );
    }
  );

  window.NaturalFixBackground = {
    remove:
      removeBackground,

    restore:
      restoreBackground,

    save:
      saveTransparentPng
  };

  initSegmenter();
})();
