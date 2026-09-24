/* NaturalFix Outpaint Tools v1.0
   - 現在のCanvasを上下左右へ拡張
   - 透明余白の下地を作成
   - /api/generate でAIアウトペイント
   - 結果をCanvasへ反映 / 元へ戻す / PNG保存
*/
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const canvas = $('canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', {
    willReadFrequently: true
  });

  if (!ctx) return;

  let preparedDataUrl = '';
  let resultDataUrl = '';
  let resultImage = null;
  let restoreCanvas = null;
  let generating = false;

  const card =
    document.createElement('section');

  card.id = 'nfOutpaintTools';
  card.className = 'card';

  card.innerHTML = `
    <h3>🪄 画像拡張・アウトペイント</h3>

    <p class="note">
      今の画像を上下左右へ広げて、
      空いた部分をAIで自然につなげるよ。
      AI未接続でも拡張下地の作成とPNG保存は使えるよ。
    </p>

    <div
      style="
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:10px;
      "
    >
      <label>
        <span class="note">
          拡張方向
        </span>

        <select
          id="nfOutpaintDirection"
          style="width:100%"
        >
          <option value="all">
            ↔️ 四方向
          </option>

          <option value="left">
            ⬅️ 左
          </option>

          <option value="right">
            ➡️ 右
          </option>

          <option value="top">
            ⬆️ 上
          </option>

          <option value="bottom">
            ⬇️ 下
          </option>

          <option value="horizontal">
            ↔️ 左右
          </option>

          <option value="vertical">
            ↕️ 上下
          </option>
        </select>
      </label>

      <label>
        <span class="note">
          拡張量
        </span>

        <select
          id="nfOutpaintAmount"
          style="width:100%"
        >
          <option value="15">
            15%
          </option>

          <option
            value="25"
            selected
          >
            25%
          </option>

          <option value="40">
            40%
          </option>

          <option value="60">
            60%
          </option>
        </select>
      </label>
    </div>

    <textarea
      id="nfOutpaintPrompt"
      rows="3"
      placeholder="例：元画像の背景・光・色・遠近感を自然につなげる。人物や文字は追加しない"
      style="
        width:100%;
        box-sizing:border-box;
        margin-top:10px;
      "
    ></textarea>

    <div
      class="buttons three"
      style="margin-top:10px"
    >
      <button
        id="nfPrepareOutpaint"
        type="button"
      >
        🧩 拡張下地を作る
      </button>

      <button
        id="nfGenerateOutpaint"
        type="button"
        class="primary"
      >
        🧠 AIで拡張
      </button>

      <button
        id="nfApplyOutpaint"
        type="button"
      >
        ✨ Canvasへ反映
      </button>
    </div>

    <div
      class="buttons"
      style="margin-top:10px"
    >
      <button
        id="nfUndoOutpaint"
        type="button"
      >
        ↩ 反映前に戻す
      </button>

      <button
        id="nfSaveOutpaint"
        type="button"
        class="green"
      >
        💾 拡張PNG保存
      </button>
    </div>

    <div
      id="nfOutpaintPreviewWrap"
      style="
        display:none;
        margin-top:12px;
      "
    >
      <p class="note">
        アウトペイント結果
      </p>

      <img
        id="nfOutpaintPreview"
        alt="NaturalFix outpaint preview"
        style="
          display:block;
          max-width:100%;
          max-height:420px;
          border-radius:12px;
        "
      >
    </div>

    <div
      id="nfOutpaintStatus"
      class="status"
      style="margin-top:8px"
    >
      画像を読み込んで「拡張下地を作る」を押してね
    </div>
  `;

  const aiBackgroundCard =
    $('nfAiBackgroundTools');

  const replaceCard =
    $('nfBackgroundReplaceTools');

  const backgroundCard =
    $('nfBackgroundTools');

  if (aiBackgroundCard) {
    aiBackgroundCard
      .insertAdjacentElement(
        'afterend',
        card
      );
  } else if (replaceCard) {
    replaceCard
      .insertAdjacentElement(
        'afterend',
        card
      );
  } else if (backgroundCard) {
    backgroundCard
      .insertAdjacentElement(
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
      $('nfOutpaintStatus');

    if (el) {
      el.textContent = text;
    }
  }

  function apiUrl(path) {
    const base =
      String(
        window.NATURALFIX_CONFIG
          ?.API_BASE_URL || ''
      )
        .trim()
        .replace(/\/$/, '');

    const cleanPath =
      String(path || '')
        .startsWith('/')
        ? String(path)
        : `/${path}`;

    return base
      ? `${base}${cleanPath}`
      : cleanPath;
  }

  function snapshotCanvas() {
    if (
      !canvas.width ||
      !canvas.height
    ) {
      return null;
    }

    const copy =
      document.createElement(
        'canvas'
      );

    copy.width =
      canvas.width;

    copy.height =
      canvas.height;

    const copyCtx =
      copy.getContext('2d');

    if (!copyCtx) {
      return null;
    }

    copyCtx.drawImage(
      canvas,
      0,
      0
    );

    return copy;
  }

  function clampSize(value) {
    return Math.max(
      1,
      Math.min(
        2048,
        Math.round(value)
      )
    );
  }

  function align16(value) {
    return Math.max(
      16,
      Math.round(
        value / 16
      ) * 16
    );
  }

  function expansionGeometry() {
    const direction =
      $('nfOutpaintDirection')
        ?.value || 'all';

    const percent =
      Math.max(
        5,
        Math.min(
          100,
          Number(
            $('nfOutpaintAmount')
              ?.value || 25
          )
        )
      ) / 100;

    const w =
      canvas.width;

    const h =
      canvas.height;

    let left = 0;
    let right = 0;
    let top = 0;
    let bottom = 0;

    const dx =
      Math.round(
        w * percent
      );

    const dy =
      Math.round(
        h * percent
      );

    if (
      direction === 'all' ||
      direction === 'horizontal'
    ) {
      left = dx;
      right = dx;
    }

    if (
      direction === 'all' ||
      direction === 'vertical'
    ) {
      top = dy;
      bottom = dy;
    }

    if (direction === 'left') {
      left = dx;
    }

    if (direction === 'right') {
      right = dx;
    }

    if (direction === 'top') {
      top = dy;
    }

    if (direction === 'bottom') {
      bottom = dy;
    }

    const rawW =
      w +
      left +
      right;

    const rawH =
      h +
      top +
      bottom;

    const newW =
      align16(
        clampSize(rawW)
      );

    const newH =
      align16(
        clampSize(rawH)
      );

    const extraW =
      Math.max(
        0,
        newW - rawW
      );

    const extraH =
      Math.max(
        0,
        newH - rawH
      );

    left +=
      Math.floor(
        extraW / 2
      );

    top +=
      Math.floor(
        extraH / 2
      );

    return {
      width: newW,
      height: newH,
      x: left,
      y: top
    };
  }

  function makePreparedCanvas() {
    if (
      !canvas.width ||
      !canvas.height
    ) {
      return null;
    }

    const source =
      snapshotCanvas();

    if (!source) {
      return null;
    }

    const g =
      expansionGeometry();

    if (
      g.width === canvas.width &&
      g.height === canvas.height
    ) {
      return null;
    }

    const out =
      document.createElement(
        'canvas'
      );

    out.width =
      g.width;

    out.height =
      g.height;

    const outCtx =
      out.getContext('2d');

    if (!outCtx) {
      return null;
    }

    outCtx.clearRect(
      0,
      0,
      out.width,
      out.height
    );

    outCtx.drawImage(
      source,
      g.x,
      g.y
    );

    return out;
  }

  function showPreview(src) {
    const img =
      $('nfOutpaintPreview');

    const wrap =
      $('nfOutpaintPreviewWrap');

    if (img) {
      img.src = src;
    }

    if (wrap) {
      wrap.style.display =
        src
          ? 'block'
          : 'none';
    }
  }

  function prepareOutpaint() {
    const prepared =
      makePreparedCanvas();

    if (!prepared) {
      setStatus(
        '先に画像を読み込んでね'
      );

      return;
    }

    preparedDataUrl =
      prepared.toDataURL(
        'image/png'
      );

    resultDataUrl = '';
    resultImage = null;

    showPreview(
      preparedDataUrl
    );

    setStatus(
      `✅ 拡張下地を作ったよ（${prepared.width} × ${prepared.height}）。透明部分をAIで埋められるよ`
    );
  }

  function loadImage(src) {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        image.onload =
          () => resolve(image);

        image.onerror =
          () =>
            reject(
              new Error(
                '生成画像を読み込めなかったよ'
              )
            );

        image.src = src;
      }
    );
  }

  async function generateOutpaint() {
    if (generating) {
      return;
    }

    if (!preparedDataUrl) {
      prepareOutpaint();

      if (!preparedDataUrl) {
        return;
      }
    }

    const promptInput =
      String(
        $('nfOutpaintPrompt')
          ?.value || ''
      ).trim();

    const prompt = [
      'OUTPAINT / IMAGE EXPANSION.',
      'Preserve the existing central image, subject identity, pose, clothing, composition and colors.',
      'Fill only the transparent expanded area and continue the original scene naturally.',
      'Match lighting, perspective, depth of field, texture and background.',
      'Do not add extra people, extra limbs, text, logos or watermarks.',
      promptInput ||
        'Extend the original environment naturally and seamlessly.'
    ].join(' ');

    const button =
      $('nfGenerateOutpaint');

    generating = true;

    if (button) {
      button.disabled = true;
    }

    setStatus(
      '🧠 AIで画像の外側を生成中…'
    );

    try {
      const preparedImage =
        await loadImage(
          preparedDataUrl
        );

      const response =
        await fetch(
          apiUrl(
            '/api/generate'
          ),
          {
            method: 'POST',

            credentials:
              'include',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                prompt,

                baseImage:
                  preparedDataUrl,

                references: [],

                mode:
                  'realistic',

                pose: '',

                performance:
                  'quality',

                seed:
                  Math.floor(
                    Math.random() *
                    2147483647
                  ),

                useDolphin:
                  false,

                width:
                  preparedImage
                    .naturalWidth,

                height:
                  preparedImage
                    .naturalHeight,

                sampler: {
                  enabled: true
                }
              })
          }
        );

      const data =
        await response
          .json()
          .catch(
            () => ({})
          );

      if (!response.ok) {
        throw new Error(
          data?.error ||
          `HTTP ${response.status}`
        );
      }

      if (!data?.image) {
        throw new Error(
          '生成画像が返ってこなかったよ'
        );
      }

      resultDataUrl =
        data.image;

      resultImage =
        await loadImage(
          resultDataUrl
        );

      showPreview(
        resultDataUrl
      );

      setStatus(
        '✅ AIアウトペイント完了。よければ「Canvasへ反映」を押してね'
      );

      window.dispatchEvent(
        new CustomEvent(
          'naturalfix:outpaint-generated',
          {
            detail: {
              image:
                resultDataUrl
            }
          }
        )
      );
    } catch (error) {
      console.error(error);

      const message =
        String(
          error?.message ||
          error ||
          'アウトペイントに失敗しました'
        );

      if (
        /workflow|Comfy|fetch|Failed to fetch|ECONNREFUSED/i
          .test(message)
      ) {
        setStatus(
          `⚠️ AIバックエンド未接続または準備中: ${message}`
        );
      } else {
        setStatus(
          `⚠️ AIアウトペイントに失敗したよ: ${message}`
        );
      }
    } finally {
      generating = false;

      if (button) {
        button.disabled =
          false;
      }
    }
  }

  async function applyOutpaint() {
    const src =
      resultDataUrl ||
      preparedDataUrl;

    if (!src) {
      setStatus(
        '先に「拡張下地を作る」か「AIで拡張」を押してね'
      );

      return;
    }

    try {
      const image =
        resultImage ||
        await loadImage(src);

      if (!restoreCanvas) {
        restoreCanvas =
          snapshotCanvas();
      }

      canvas.width =
        image.naturalWidth;

      canvas.height =
        image.naturalHeight;

      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      ctx.drawImage(
        image,
        0,
        0,
        canvas.width,
        canvas.height
      );

      setStatus(
        resultDataUrl
          ? '✅ AI拡張結果をCanvasへ反映したよ'
          : '✅ 透明な拡張下地をCanvasへ反映したよ'
      );

      window.dispatchEvent(
        new CustomEvent(
          'naturalfix:outpaint-applied'
        )
      );
    } catch (error) {
      console.error(error);

      setStatus(
        '⚠️ Canvasへ反映できなかったよ'
      );
    }
  }

  function undoOutpaint() {
    if (!restoreCanvas) {
      setStatus(
        'まだCanvasへ反映してないよ'
      );

      return;
    }

    canvas.width =
      restoreCanvas.width;

    canvas.height =
      restoreCanvas.height;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      restoreCanvas,
      0,
      0
    );

    restoreCanvas = null;

    setStatus(
      '↩ アウトペイント反映前に戻したよ'
    );
  }

  function saveOutpaint() {
    const src =
      resultDataUrl ||
      preparedDataUrl;

    if (!src) {
      setStatus(
        '先に拡張下地かAI拡張結果を作ってね'
      );

      return;
    }

    const a =
      document.createElement(
        'a'
      );

    a.href = src;

    a.download =
      `NaturalFix_outpaint_${Date.now()}.png`;

    a.click();
  }

  function resetState() {
    preparedDataUrl = '';
    resultDataUrl = '';
    resultImage = null;
    restoreCanvas = null;

    showPreview('');

    setStatus(
      '画像を読み込んで「拡張下地を作る」を押してね'
    );
  }

  $('nfPrepareOutpaint')
    ?.addEventListener(
      'click',
      prepareOutpaint
    );

  $('nfGenerateOutpaint')
    ?.addEventListener(
      'click',
      generateOutpaint
    );

  $('nfApplyOutpaint')
    ?.addEventListener(
      'click',
      applyOutpaint
    );

  $('nfUndoOutpaint')
    ?.addEventListener(
      'click',
      undoOutpaint
    );

  $('nfSaveOutpaint')
    ?.addEventListener(
      'click',
      saveOutpaint
    );

  $('fileInput')
    ?.addEventListener(
      'change',
      resetState
    );

  window.NaturalFixOutpaint = {
    prepare:
      prepareOutpaint,

    generate:
      generateOutpaint,

    apply:
      applyOutpaint,

    undo:
      undoOutpaint,

    save:
      saveOutpaint
  };
})();
