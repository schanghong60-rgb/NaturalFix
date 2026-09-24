/* NaturalFix Upscale Tools v1.0
   - 端末側の高品質アップスケール
   - 2x / 3x / 4x
   - Canvasへ反映 / 元へ戻す / PNG保存
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

  let resultCanvas = null;
  let beforeApplyCanvas = null;
  let applied = false;
  let working = false;

  const card = document.createElement('section');
  card.id = 'nfUpscaleTools';
  card.className = 'card';

  card.innerHTML = `
    <h3>🔎 超解像・アップスケール</h3>

    <p class="note">
      現在の画像を端末側で高品質に
      2倍・3倍・4倍へ拡大するよ。
      AIバックエンドなしでも使えるよ。
    </p>

    <div
      style="
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:10px;
      "
    >
      <label>
        <span class="note">倍率</span>

        <select
          id="nfUpscaleScale"
          style="width:100%"
        >
          <option value="2" selected>2x</option>
          <option value="3">3x</option>
          <option value="4">4x</option>
        </select>
      </label>

      <label>
        <span class="note">補間品質</span>

        <select
          id="nfUpscaleQuality"
          style="width:100%"
        >
          <option value="high" selected>
            💎 高品質
          </option>

          <option value="medium">
            ✨ 標準
          </option>

          <option value="low">
            ⚡ 高速
          </option>
        </select>
      </label>
    </div>

    <div
      class="buttons three"
      style="margin-top:10px"
    >
      <button
        id="nfRunUpscale"
        type="button"
        class="primary"
      >
        🔎 高品質アップスケール
      </button>

      <button
        id="nfApplyUpscale"
        type="button"
      >
        ✨ Canvasへ反映
      </button>

      <button
        id="nfUndoUpscale"
        type="button"
      >
        ↩ 反映前に戻す
      </button>
    </div>

    <div
      class="buttons"
      style="margin-top:10px"
    >
      <button
        id="nfSaveUpscale"
        type="button"
        class="green"
      >
        💾 高解像度PNG保存
      </button>
    </div>

    <div
      id="nfUpscalePreviewWrap"
      style="display:none;margin-top:12px"
    >
      <p class="note">
        アップスケール結果
      </p>

      <img
        id="nfUpscalePreview"
        alt="NaturalFix upscale preview"
        style="
          display:block;
          max-width:100%;
          max-height:420px;
          border-radius:12px;
        "
      >
    </div>

    <div
      id="nfUpscaleStatus"
      class="status"
      style="margin-top:8px"
    >
      画像を読み込んで倍率を選んでね
    </div>
  `;

  const outpaintCard =
    $('nfOutpaintTools');

  const aiBackgroundCard =
    $('nfAiBackgroundTools');

  if (outpaintCard) {
    outpaintCard.insertAdjacentElement(
      'afterend',
      card
    );
  } else if (aiBackgroundCard) {
    aiBackgroundCard.insertAdjacentElement(
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
      $('nfUpscaleStatus');

    if (el) {
      el.textContent = text;
    }
  }

  function snapshot(source) {
    if (!source?.width || !source?.height) {
      return null;
    }

    const copy =
      document.createElement('canvas');

    copy.width =
      source.width;

    copy.height =
      source.height;

    const copyCtx =
      copy.getContext('2d');

    if (!copyCtx) {
      return null;
    }

    copyCtx.drawImage(
      source,
      0,
      0
    );

    return copy;
  }

  function maxSafeSize(
    width,
    height
  ) {
    const maxSide = 8192;
    const maxPixels = 36000000;

    return (
      width <= maxSide &&
      height <= maxSide &&
      width * height <= maxPixels
    );
  }

  function drawScaled(
    source,
    width,
    height,
    quality
  ) {
    const out =
      document.createElement('canvas');

    out.width = width;
    out.height = height;

    const outCtx =
      out.getContext('2d');

    if (!outCtx) {
      throw new Error(
        'Canvasを作れなかったよ'
      );
    }

    outCtx.imageSmoothingEnabled =
      true;

    outCtx.imageSmoothingQuality =
      quality;

    outCtx.clearRect(
      0,
      0,
      width,
      height
    );

    outCtx.drawImage(
      source,
      0,
      0,
      width,
      height
    );

    return out;
  }

  function progressiveScale(
    source,
    targetWidth,
    targetHeight,
    quality
  ) {
    let current =
      snapshot(source);

    if (!current) {
      throw new Error(
        '元画像を取得できなかったよ'
      );
    }

    while (
      current.width * 2 <
        targetWidth &&
      current.height * 2 <
        targetHeight
    ) {
      current =
        drawScaled(
          current,
          current.width * 2,
          current.height * 2,
          quality
        );
    }

    if (
      current.width !==
        targetWidth ||
      current.height !==
        targetHeight
    ) {
      current =
        drawScaled(
          current,
          targetWidth,
          targetHeight,
          quality
        );
    }

    return current;
  }

  function showPreview(
    sourceCanvas
  ) {
    const wrap =
      $('nfUpscalePreviewWrap');

    const img =
      $('nfUpscalePreview');

    if (!sourceCanvas) {
      if (img) {
        img.removeAttribute('src');
      }

      if (wrap) {
        wrap.style.display =
          'none';
      }

      return;
    }

    if (img) {
      img.src =
        sourceCanvas.toDataURL(
          'image/png'
        );
    }

    if (wrap) {
      wrap.style.display =
        'block';
    }
  }

  async function runUpscale() {
    if (working) {
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

    const scale =
      Number(
        $('nfUpscaleScale')
          ?.value || 2
      );

    const qualityValue =
      $('nfUpscaleQuality')
        ?.value || 'high';

    const quality =
      [
        'low',
        'medium',
        'high'
      ].includes(
        qualityValue
      )
        ? qualityValue
        : 'high';

    const targetWidth =
      Math.round(
        canvas.width * scale
      );

    const targetHeight =
      Math.round(
        canvas.height * scale
      );

    if (
      !maxSafeSize(
        targetWidth,
        targetHeight
      )
    ) {
      setStatus(
        `⚠️ ${targetWidth} × ${targetHeight} は端末負荷が大きすぎるよ。倍率を下げてね`
      );

      return;
    }

    working = true;

    const button =
      $('nfRunUpscale');

    if (button) {
      button.disabled = true;
    }

    setStatus(
      `🔎 ${scale}x 高品質アップスケール中…`
    );

    try {
      await new Promise(
        (resolve) =>
          requestAnimationFrame(
            resolve
          )
      );

      resultCanvas =
        progressiveScale(
          canvas,
          targetWidth,
          targetHeight,
          quality
        );

      applied = false;

      showPreview(
        resultCanvas
      );

      setStatus(
        `✅ ${canvas.width} × ${canvas.height} → ${targetWidth} × ${targetHeight} に拡大したよ`
      );

      window.dispatchEvent(
        new CustomEvent(
          'naturalfix:upscale-ready',
          {
            detail: {
              width:
                targetWidth,

              height:
                targetHeight,

              scale
            }
          }
        )
      );
    } catch (error) {
      console.error(error);

      setStatus(
        `⚠️ アップスケールに失敗したよ: ${error?.message || error}`
      );
    } finally {
      working = false;

      if (button) {
        button.disabled =
          false;
      }
    }
  }

  function applyUpscale() {
    if (!resultCanvas) {
      setStatus(
        '先に「高品質アップスケール」を押してね'
      );

      return;
    }

    if (!beforeApplyCanvas) {
      beforeApplyCanvas =
        snapshot(canvas);
    }

    canvas.width =
      resultCanvas.width;

    canvas.height =
      resultCanvas.height;

    ctx.imageSmoothingEnabled =
      true;

    ctx.imageSmoothingQuality =
      'high';

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      resultCanvas,
      0,
      0
    );

    applied = true;

    setStatus(
      '✅ 高解像度画像をCanvasへ反映したよ'
    );

    window.dispatchEvent(
      new CustomEvent(
        'naturalfix:upscale-applied',
        {
          detail: {
            width:
              canvas.width,

            height:
              canvas.height
          }
        }
      )
    );
  }

  function undoUpscale() {
    if (!beforeApplyCanvas) {
      setStatus(
        'まだCanvasへ反映してないよ'
      );

      return;
    }

    canvas.width =
      beforeApplyCanvas.width;

    canvas.height =
      beforeApplyCanvas.height;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      beforeApplyCanvas,
      0,
      0
    );

    beforeApplyCanvas = null;
    applied = false;

    setStatus(
      '↩ アップスケール反映前に戻したよ'
    );
  }

  function saveUpscale() {
    const source =
      resultCanvas ||
      (applied
        ? canvas
        : null);

    if (!source) {
      setStatus(
        '先にアップスケールしてね'
      );

      return;
    }

    const a =
      document.createElement('a');

    a.href =
      source.toDataURL(
        'image/png'
      );

    a.download =
      `NaturalFix_upscale_${source.width}x${source.height}_${Date.now()}.png`;

    a.click();
  }

  function resetState() {
    resultCanvas = null;
    beforeApplyCanvas = null;
    applied = false;

    showPreview(null);

    setStatus(
      '画像を読み込んで倍率を選んでね'
    );
  }

  $('nfRunUpscale')
    ?.addEventListener(
      'click',
      runUpscale
    );

  $('nfApplyUpscale')
    ?.addEventListener(
      'click',
      applyUpscale
    );

  $('nfUndoUpscale')
    ?.addEventListener(
      'click',
      undoUpscale
    );

  $('nfSaveUpscale')
    ?.addEventListener(
      'click',
      saveUpscale
    );

  $('fileInput')
    ?.addEventListener(
      'change',
      resetState
    );

  window.NaturalFixUpscale = {
    run:
      runUpscale,

    apply:
      applyUpscale,

    undo:
      undoUpscale,

    save:
      saveUpscale
  };
})();
