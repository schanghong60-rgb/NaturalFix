/* NaturalFix Background Replace Tools v1.0
   - 透明化した人物の背景を画像へ差し替え
   - cover / contain / stretch
   - 適用前へ戻す
   - PNG保存
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
      {
        willReadFrequently: true
      }
    );

  if (!ctx) return;

  let backgroundImage = null;
  let backgroundObjectUrl = null;

  let foregroundCanvas = null;
  let beforeApplyImageData = null;

  let applied = false;

  const card =
    document.createElement('section');

  card.id =
    'nfBackgroundReplaceTools';

  card.className = 'card';

  card.innerHTML = `
    <h3>🖼️ 背景を差し替え</h3>

    <p class="note">
      「AI背景削除」で人物を透明化したあと、
      好きな画像を背景にできるよ。
    </p>

    <input
      id="nfBackgroundReplaceInput"
      type="file"
      accept="image/*"
      style="display:none"
    >

    <div
      class="buttons three"
      style="margin-top:10px"
    >
      <button
        id="nfChooseBackground"
        type="button"
      >
        📁 背景画像を選択
      </button>

      <button
        id="nfApplyBackground"
        type="button"
        class="primary"
      >
        🖼️ 背景を適用
      </button>

      <button
        id="nfUndoBackgroundReplace"
        type="button"
      >
        ↩ 適用前に戻す
      </button>
    </div>

    <div
      style="
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:10px;
        margin-top:10px;
      "
    >
      <label>
        <span class="note">
          配置
        </span>

        <select
          id="nfBackgroundFit"
          style="width:100%"
        >
          <option value="cover">
            画面いっぱい
          </option>

          <option value="contain">
            全体を表示
          </option>

          <option value="stretch">
            引き伸ばす
          </option>
        </select>
      </label>

      <label>
        <span class="note">
          余白色
        </span>

        <input
          id="nfBackgroundFill"
          type="color"
          value="#000000"
          style="
            width:100%;
            height:44px;
          "
        >
      </label>
    </div>

    <div
      class="buttons"
      style="margin-top:10px"
    >
      <button
        id="nfSaveBackgroundReplace"
        type="button"
        class="green"
      >
        💾 背景差し替えPNG保存
      </button>
    </div>

    <div
      id="nfBackgroundReplaceStatus"
      class="status"
      style="margin-top:8px"
    >
      先に「AI背景削除」で背景を透明にしてね
    </div>
  `;

  const backgroundCard =
    $('nfBackgroundTools');

  const faceApplyCard =
    $('nfFaceApplyTools');

  if (backgroundCard) {
    backgroundCard
      .insertAdjacentElement(
        'afterend',
        card
      );
  } else if (faceApplyCard) {
    faceApplyCard
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
      $('nfBackgroundReplaceStatus');

    if (el) {
      el.textContent = text;
    }
  }

  function revokeBackgroundUrl() {
    if (!backgroundObjectUrl) {
      return;
    }

    URL.revokeObjectURL(
      backgroundObjectUrl
    );

    backgroundObjectUrl = null;
  }

  function resetState() {
    revokeBackgroundUrl();

    backgroundImage = null;
    foregroundCanvas = null;
    beforeApplyImageData = null;

    applied = false;
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

  function drawBackground(
    targetCtx,
    image,
    mode,
    fill
  ) {
    const width =
      canvas.width;

    const height =
      canvas.height;

    targetCtx.fillStyle =
      fill || '#000000';

    targetCtx.fillRect(
      0,
      0,
      width,
      height
    );

    if (mode === 'stretch') {
      targetCtx.drawImage(
        image,
        0,
        0,
        width,
        height
      );

      return;
    }

    const imageRatio =
      image.naturalWidth /
      image.naturalHeight;

    const canvasRatio =
      width / height;

    let drawWidth;
    let drawHeight;

    if (mode === 'contain') {
      if (
        imageRatio >
        canvasRatio
      ) {
        drawWidth =
          width;

        drawHeight =
          width /
          imageRatio;
      } else {
        drawHeight =
          height;

        drawWidth =
          height *
          imageRatio;
      }
    } else {
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

  async function loadBackgroundFile(
    file
  ) {
    if (!file) return;

    if (
      !file.type
        .startsWith('image/')
    ) {
      setStatus(
        '画像ファイルを選んでね'
      );

      return;
    }

    revokeBackgroundUrl();

    backgroundObjectUrl =
      URL.createObjectURL(
        file
      );

    const image =
      new Image();

    try {
      await new Promise(
        (resolve, reject) => {
          image.onload =
            resolve;

          image.onerror =
            () => {
              reject(
                new Error(
                  'background image load error'
                )
              );
            };

          image.src =
            backgroundObjectUrl;
        }
      );

      backgroundImage =
        image;

      applied = false;

      setStatus(
        `✅ 背景画像を選択したよ: ${file.name}`
      );
    } catch (error) {
      console.error(error);

      backgroundImage =
        null;

      setStatus(
        '⚠️ 背景画像を読み込めなかったよ'
      );
    }
  }

  function applyBackground() {
    if (
      !canvas.width ||
      !canvas.height
    ) {
      setStatus(
        '先に人物画像を読み込んでね'
      );

      return;
    }

    if (!backgroundImage) {
      setStatus(
        '先に背景画像を選んでね'
      );

      return;
    }

    if (!foregroundCanvas) {
      if (!hasTransparency()) {
        setStatus(
          '先に「AI背景削除」で背景を透明にしてね'
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

    const mode =
      $('nfBackgroundFit')
        ?.value ||
      'cover';

    const fill =
      $('nfBackgroundFill')
        ?.value ||
      '#000000';

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    drawBackground(
      ctx,
      backgroundImage,
      mode,
      fill
    );

    ctx.drawImage(
      foregroundCanvas,
      0,
      0
    );

    applied = true;

    setStatus(
      '✅ 背景を差し替えたよ'
    );

    window.dispatchEvent(
      new CustomEvent(
        'naturalfix:background-replaced'
      )
    );
  }

  function undoBackgroundReplace() {
    if (!beforeApplyImageData) {
      setStatus(
        'まだ背景を差し替えてないよ'
      );

      return;
    }

    if (
      beforeApplyImageData.width !==
        canvas.width ||
      beforeApplyImageData.height !==
        canvas.height
    ) {
      beforeApplyImageData =
        null;

      foregroundCanvas =
        null;

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
      '↩ 背景差し替え前に戻したよ'
    );
  }

  function saveResult() {
    if (!applied) {
      setStatus(
        '先に背景を適用してね'
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
      `NaturalFix_background_${Date.now()}.png`;

    a.click();
  }

  $('nfChooseBackground')
    ?.addEventListener(
      'click',
      () => {
        $('nfBackgroundReplaceInput')
          ?.click();
      }
    );

  $('nfBackgroundReplaceInput')
    ?.addEventListener(
      'change',
      (event) => {
        const file =
          event.target
            .files?.[0];

        loadBackgroundFile(
          file
        );

        event.target.value =
          '';
      }
    );

  $('nfApplyBackground')
    ?.addEventListener(
      'click',
      applyBackground
    );

  $('nfUndoBackgroundReplace')
    ?.addEventListener(
      'click',
      undoBackgroundReplace
    );

  $('nfSaveBackgroundReplace')
    ?.addEventListener(
      'click',
      saveResult
    );

  $('fileInput')
    ?.addEventListener(
      'change',
      () => {
        resetState();

        setStatus(
          '先に「AI背景削除」で背景を透明にしてね'
        );
      }
    );

  window.addEventListener(
    'naturalfix:background-removed',
    () => {
      foregroundCanvas =
        null;

      beforeApplyImageData =
        null;

      applied = false;

      setStatus(
        '✅ 背景削除済み。背景画像を選んでね'
      );
    }
  );

  window.NaturalFixBackgroundReplace = {
    apply:
      applyBackground,

    undo:
      undoBackgroundReplace,

    save:
      saveResult
  };
})();
