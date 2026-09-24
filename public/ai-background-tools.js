/* NaturalFix AI Background Tools v1.0
   - AIで背景だけを生成
   - 生成背景を透明化済み人物の後ろへ合成
   - 適用前へ戻す
   - PNG保存
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

  let generatedImage = null;
  let generatedDataUrl = '';
  let foregroundCanvas = null;
  let beforeApplyImageData = null;
  let applied = false;
  let generating = false;

  const card = document.createElement('section');
  card.id = 'nfAiBackgroundTools';
  card.className = 'card';

  card.innerHTML = `
    <h3>🧠 AI背景生成</h3>

    <p class="note">
      背景だけをAI生成して、
      背景削除済みの人物の後ろへ合成するよ。
    </p>

    <textarea
      id="nfAiBackgroundPrompt"
      rows="3"
      placeholder="例：夕暮れの海辺、映画のような光、人物なし"
      style="width:100%;box-sizing:border-box"
    ></textarea>

    <div
      style="
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:10px;
        margin-top:10px;
      "
    >
      <label>
        <span class="note">背景スタイル</span>

        <select
          id="nfAiBackgroundMode"
          style="width:100%"
        >
          <option value="realistic">
            📷 リアル
          </option>

          <option value="anime">
            🎨 アニメ
          </option>
        </select>
      </label>

      <label>
        <span class="note">生成品質</span>

        <select
          id="nfAiBackgroundPerformance"
          style="width:100%"
        >
          <option value="fast">
            ⚡ 高速
          </option>

          <option value="balanced">
            ✨ バランス
          </option>

          <option value="quality">
            💎 高品質
          </option>
        </select>
      </label>
    </div>

    <div
      class="buttons three"
      style="margin-top:10px"
    >
      <button
        id="nfGenerateAiBackground"
        type="button"
        class="primary"
      >
        🧠 背景だけAI生成
      </button>

      <button
        id="nfApplyAiBackground"
        type="button"
      >
        🖼️ 生成背景を適用
      </button>

      <button
        id="nfUndoAiBackground"
        type="button"
      >
        ↩ 適用前に戻す
      </button>
    </div>

    <div
      id="nfAiBackgroundPreviewWrap"
      style="display:none;margin-top:12px"
    >
      <p class="note">
        生成された背景
      </p>

      <img
        id="nfAiBackgroundPreview"
        alt="AI generated background preview"
        style="
          display:block;
          max-width:100%;
          max-height:360px;
          border-radius:12px;
        "
      >
    </div>

    <div
      class="buttons"
      style="margin-top:10px"
    >
      <button
        id="nfSaveAiBackground"
        type="button"
        class="green"
      >
        💾 AI背景合成PNG保存
      </button>
    </div>

    <div
      id="nfAiBackgroundStatus"
      class="status"
      style="margin-top:8px"
    >
      背景の説明を入力してね
    </div>
  `;

  const replaceCard =
    $('nfBackgroundReplaceTools');

  const backgroundCard =
    $('nfBackgroundTools');

  if (replaceCard) {
    replaceCard.insertAdjacentElement(
      'afterend',
      card
    );
  } else if (backgroundCard) {
    backgroundCard.insertAdjacentElement(
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
      $('nfAiBackgroundStatus');

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

  function resetImageState() {
    generatedImage = null;
    generatedDataUrl = '';
    foregroundCanvas = null;
    beforeApplyImageData = null;
    applied = false;

    const preview =
      $('nfAiBackgroundPreview');

    const wrap =
      $('nfAiBackgroundPreviewWrap');

    if (preview) {
      preview.removeAttribute('src');
    }

    if (wrap) {
      wrap.style.display = 'none';
    }
  }

  function hasTransparency() {
    if (
      !canvas.width ||
      !canvas.height
    ) {
      return false;
    }

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    const pixelCount =
      canvas.width *
      canvas.height;

    const step =
      Math.max(
        1,
        Math.floor(
          pixelCount / 12000
        )
      );

    for (
      let i = 0;
      i < pixelCount;
      i += step
    ) {
      if (
        data[
          i * 4 + 3
        ] < 245
      ) {
        return true;
      }
    }

    return false;
  }

  function captureForeground() {
    const result =
      document.createElement(
        'canvas'
      );

    result.width =
      canvas.width;

    result.height =
      canvas.height;

    const resultCtx =
      result.getContext('2d');

    if (!resultCtx) {
      return null;
    }

    resultCtx.drawImage(
      canvas,
      0,
      0
    );

    return result;
  }

  function loadImage(src) {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        image.onload =
          () => resolve(image);

        image.onerror =
          () => reject(
            new Error(
              '画像を読み込めませんでした'
            )
          );

        image.src =
          src;
      }
    );
  }

  function drawCover(
    targetCtx,
    image
  ) {
    const width =
      canvas.width;

    const height =
      canvas.height;

    const imageRatio =
      image.naturalWidth /
      image.naturalHeight;

    const canvasRatio =
      width / height;

    let drawWidth;
    let drawHeight;

    if (
      imageRatio >
      canvasRatio
    ) {
      drawHeight =
        height;

      drawWidth =
        height *
        imageRatio;
    } else {
      drawWidth =
        width;

      drawHeight =
        width /
        imageRatio;
    }

    const x =
      (width - drawWidth) / 2;

    const y =
      (height - drawHeight) / 2;

    targetCtx.drawImage(
      image,
      x,
      y,
      drawWidth,
      drawHeight
    );
  }

  async function generateBackground() {
    if (generating) {
      return;
    }

    const userPrompt =
      String(
        $('nfAiBackgroundPrompt')
          ?.value || ''
      ).trim();

    if (!userPrompt) {
      setStatus(
        '背景の説明を入力してね'
      );

      return;
    }

    generating = true;

    const button =
      $('nfGenerateAiBackground');

    if (button) {
      button.disabled = true;
    }

    setStatus(
      '🧠 AIで背景だけを生成中…'
    );

    try {
      const mode =
        $('nfAiBackgroundMode')
          ?.value === 'anime'
          ? 'anime'
          : 'realistic';

      const value =
        $('nfAiBackgroundPerformance')
          ?.value;

      const performance =
        [
          'fast',
          'balanced',
          'quality'
        ].includes(value)
          ? value
          : 'fast';

      const prompt = [
        'BACKGROUND ONLY.',
        'No people, no person, no human, no character, no face, no body, no text, no logo.',
        'Create only a clean environment/background scene suitable for placing a foreground subject in front.',
        userPrompt
      ].join(' ');

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
                references: [],
                mode,
                pose: '',
                performance,

                seed:
                  Math.floor(
                    Math.random() *
                    2147483647
                  ),

                useDolphin:
                  false,

                width:
                  Math.max(
                    512,
                    canvas.width ||
                    1024
                  ),

                height:
                  Math.max(
                    512,
                    canvas.height ||
                    1024
                  ),

                sampler: {
                  enabled:
                    performance ===
                    'quality'
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

      generatedDataUrl =
        data.image;

      generatedImage =
        await loadImage(
          generatedDataUrl
        );

      applied = false;

      const preview =
        $('nfAiBackgroundPreview');

      const wrap =
        $('nfAiBackgroundPreviewWrap');

      if (preview) {
        preview.src =
          generatedDataUrl;
      }

      if (wrap) {
        wrap.style.display =
          'block';
      }

      setStatus(
        '✅ AI背景を生成したよ。次は「生成背景を適用」を押してね'
      );

      window.dispatchEvent(
        new CustomEvent(
          'naturalfix:ai-background-generated',
          {
            detail: {
              image:
                generatedDataUrl
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
          '生成に失敗しました'
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
          `⚠️ AI背景生成に失敗したよ: ${message}`
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

  function applyGeneratedBackground() {
    if (!generatedImage) {
      setStatus(
        '先にAI背景を生成してね'
      );

      return;
    }

    if (
      !canvas.width ||
      !canvas.height
    ) {
      setStatus(
        '先に人物画像を読み込んでね'
      );

      return;
    }

    if (!foregroundCanvas) {
      if (!hasTransparency()) {
        setStatus(
          '先に「AI背景削除」で人物の背景を透明にしてね'
        );

        return;
      }

      foregroundCanvas =
        captureForeground();

      if (!foregroundCanvas) {
        setStatus(
          '⚠️ 人物画像を準備できなかったよ'
        );

        return;
      }

      beforeApplyImageData =
        ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        );
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    drawCover(
      ctx,
      generatedImage
    );

    ctx.drawImage(
      foregroundCanvas,
      0,
      0
    );

    applied = true;

    setStatus(
      '✅ AI背景を人物の後ろへ合成したよ'
    );

    window.dispatchEvent(
      new CustomEvent(
        'naturalfix:ai-background-applied'
      )
    );
  }

  function undoGeneratedBackground() {
    if (!beforeApplyImageData) {
      setStatus(
        'まだAI背景を適用してないよ'
      );

      return;
    }

    if (
      beforeApplyImageData.width !==
        canvas.width ||
      beforeApplyImageData.height !==
        canvas.height
    ) {
      foregroundCanvas = null;
      beforeApplyImageData = null;
      applied = false;

      setStatus(
        '画像サイズが変わったので、背景削除からやり直してね'
      );

      return;
    }

    ctx.putImageData(
      beforeApplyImageData,
      0,
      0
    );

    applied = false;

    setStatus(
      '↩ AI背景適用前に戻したよ'
    );
  }

  function saveResult() {
    if (!applied) {
      setStatus(
        '先にAI背景を適用してね'
      );

      return;
    }

    const a =
      document.createElement('a');

    a.href =
      canvas.toDataURL(
        'image/png'
      );

    a.download =
      `NaturalFix_AI_background_${Date.now()}.png`;

    a.click();
  }

  $('nfGenerateAiBackground')
    ?.addEventListener(
      'click',
      generateBackground
    );

  $('nfApplyAiBackground')
    ?.addEventListener(
      'click',
      applyGeneratedBackground
    );

  $('nfUndoAiBackground')
    ?.addEventListener(
      'click',
      undoGeneratedBackground
    );

  $('nfSaveAiBackground')
    ?.addEventListener(
      'click',
      saveResult
    );

  $('fileInput')
    ?.addEventListener(
      'change',
      () => {
        resetImageState();

        setStatus(
          '背景の説明を入力してね'
        );
      }
    );

  window.addEventListener(
    'naturalfix:background-removed',
    () => {
      foregroundCanvas = null;
      beforeApplyImageData = null;
      applied = false;

      setStatus(
        '✅ 背景削除済み。AI背景を生成してね'
      );
    }
  );

  window.NaturalFixAiBackground = {
    generate:
      generateBackground,

    apply:
      applyGeneratedBackground,

    undo:
      undoGeneratedBackground,

    save:
      saveResult
  };
})();
