/* NaturalFix Video Tools v1.1
   - 現在のCanvas画像から短い動画を作成
   - ズーム / パン / 静止
   - 端末側でWebM生成
*/
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const sourceCanvas = $('canvas');
  if (!sourceCanvas) return;

  let videoBlob = null;
  let videoUrl = '';
  let rendering = false;

  const card = document.createElement('section');
  card.id = 'nfVideoTools';
  card.className = 'card';

  card.innerHTML = `
    <h3>🎬 画像 → 動画</h3>

    <p class="note">
      現在の画像から、ズームやパンを付けた短い動画を端末だけで作るよ。
      今はWebM保存。人物そのものをAIで動かす生成動画は次の段階で追加できるよ。
    </p>

    <div style="
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:10px;
    ">
      <label>
        <span class="note">動き</span>
        <select id="nfVideoMotion" style="width:100%">
          <option value="zoom-in" selected>🔍 ゆっくりズームイン</option>
          <option value="zoom-out">🔎 ゆっくりズームアウト</option>
          <option value="pan-x">↔️ 横パン</option>
          <option value="pan-y">↕️ 縦パン</option>
          <option value="still">🖼️ 静止</option>
        </select>
      </label>

      <label>
        <span class="note">長さ</span>
        <select id="nfVideoDuration" style="width:100%">
          <option value="4">4秒</option>
          <option value="6" selected>6秒</option>
          <option value="8">8秒</option>
          <option value="10">10秒</option>
        </select>
      </label>

      <label>
        <span class="note">FPS</span>
        <select id="nfVideoFps" style="width:100%">
          <option value="24">24 fps</option>
          <option value="30" selected>30 fps</option>
        </select>
      </label>

      <label>
        <span class="note">出力サイズ</span>
        <select id="nfVideoSize" style="width:100%">
          <option value="720">最大720px</option>
          <option value="1080" selected>最大1080px</option>
          <option value="1280">最大1280px</option>
        </select>
      </label>
    </div>

    <div class="buttons" style="margin-top:10px">
      <button id="nfCreateVideo" type="button" class="primary">
        🎞️ 動画を作る
      </button>

      <button id="nfSaveVideo" type="button" class="green" disabled>
        💾 WebM保存
      </button>
    </div>

    <div id="nfVideoPreviewWrap" style="display:none;margin-top:12px">
      <video
        id="nfVideoPreview"
        controls
        playsinline
        loop
        style="
          display:block;
          width:100%;
          max-height:480px;
          border-radius:12px;
          background:#000;
        "
      ></video>
    </div>

    <canvas id="nfVideoRenderCanvas" style="display:none"></canvas>

    <div id="nfVideoStatus" class="status" style="margin-top:8px">
      画像を読み込んで「動画を作る」を押してね
    </div>
  `;

  const upscaleCard = $('nfUpscaleTools');
  const outpaintCard = $('nfOutpaintTools');

  if (upscaleCard) {
    upscaleCard.insertAdjacentElement('afterend', card);
  } else if (outpaintCard) {
    outpaintCard.insertAdjacentElement('afterend', card);
  } else {
    document.querySelector('.container')?.appendChild(card);
  }

  const renderCanvas = $('nfVideoRenderCanvas');
  const renderCtx = renderCanvas?.getContext('2d');

  function setStatus(text) {
    const el = $('nfVideoStatus');
    if (el) el.textContent = text;
  }

  function revokeVideoUrl() {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      videoUrl = '';
    }
  }

  function clearPreview() {
    const preview = $('nfVideoPreview');
    const wrap = $('nfVideoPreviewWrap');
    const saveButton = $('nfSaveVideo');

    if (preview) {
      preview.pause();
      preview.removeAttribute('src');
      preview.load();
    }

    if (wrap) wrap.style.display = 'none';
    if (saveButton) saveButton.disabled = true;
  }

  function resetVideo() {
    revokeVideoUrl();
    videoBlob = null;
    clearPreview();

    setStatus(
      '画像を読み込んで「動画を作る」を押してね'
    );
  }

  function chooseMimeType() {
    if (!window.MediaRecorder) return '';

    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];

    return (
      candidates.find((type) =>
        MediaRecorder.isTypeSupported?.(type)
      ) || ''
    );
  }

  function makeEven(value) {
    const rounded = Math.max(
      2,
      Math.round(value)
    );

    return rounded % 2 === 0
      ? rounded
      : rounded - 1;
  }

  function outputSize() {
    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;

    const maxSide = Number(
      $('nfVideoSize')?.value || 1080
    );

    if (!srcW || !srcH) {
      return {
        width: 0,
        height: 0
      };
    }

    const scale = Math.min(
      1,
      maxSide / Math.max(srcW, srcH)
    );

    return {
      width: makeEven(srcW * scale),
      height: makeEven(srcH * scale)
    };
  }

  function smoothstep(t) {
    const x = Math.max(
      0,
      Math.min(1, t)
    );

    return x * x * (3 - 2 * x);
  }

  function drawFrame(
    progress,
    motion
  ) {
    if (!renderCtx || !renderCanvas) {
      return;
    }

    const w = renderCanvas.width;
    const h = renderCanvas.height;

    const eased =
      smoothstep(progress);

    renderCtx.clearRect(
      0,
      0,
      w,
      h
    );

    renderCtx.fillStyle = '#000';

    renderCtx.fillRect(
      0,
      0,
      w,
      h
    );

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    if (motion === 'zoom-in') {
      scale =
        1 + 0.10 * eased;
    } else if (
      motion === 'zoom-out'
    ) {
      scale =
        1.10 - 0.10 * eased;
    } else if (
      motion === 'pan-x'
    ) {
      scale = 1.10;

      offsetX =
        (eased - 0.5) *
        w *
        0.10;
    } else if (
      motion === 'pan-y'
    ) {
      scale = 1.10;

      offsetY =
        (eased - 0.5) *
        h *
        0.10;
    }

    const drawW =
      w * scale;

    const drawH =
      h * scale;

    const dx =
      (w - drawW) / 2 -
      offsetX;

    const dy =
      (h - drawH) / 2 -
      offsetY;

    renderCtx.imageSmoothingEnabled =
      true;

    renderCtx.imageSmoothingQuality =
      'high';

    renderCtx.drawImage(
      sourceCanvas,
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
      dx,
      dy,
      drawW,
      drawH
    );
  }

  async function createVideo() {
    if (rendering) return;

    if (
      !sourceCanvas.width ||
      !sourceCanvas.height
    ) {
      setStatus(
        '先に画像を読み込んでね'
      );
      return;
    }

    if (
      !window.MediaRecorder ||
      !renderCanvas?.captureStream ||
      !renderCtx
    ) {
      setStatus(
        '⚠️ このブラウザは端末内動画作成に対応していないよ'
      );
      return;
    }

    const size =
      outputSize();

    if (
      !size.width ||
      !size.height
    ) {
      setStatus(
        '⚠️ 画像サイズを取得できなかったよ'
      );
      return;
    }

    const durationSec =
      Number(
        $('nfVideoDuration')
          ?.value || 6
      );

    const fps =
      Number(
        $('nfVideoFps')
          ?.value || 30
      );

    const motion =
      $('nfVideoMotion')
        ?.value || 'zoom-in';

    const mimeType =
      chooseMimeType();

    renderCanvas.width =
      size.width;

    renderCanvas.height =
      size.height;

    revokeVideoUrl();
    videoBlob = null;
    clearPreview();

    const createButton =
      $('nfCreateVideo');

    const saveButton =
      $('nfSaveVideo');

    rendering = true;

    if (createButton) {
      createButton.disabled = true;
    }

    if (saveButton) {
      saveButton.disabled = true;
    }

    setStatus(
      `🎞️ ${durationSec}秒の動画を作成中…`
    );

    // 最初のフレームを先に描画。
    // 録画冒頭の黒画面を防ぐ。
    drawFrame(
      0,
      motion
    );

    await new Promise(
      (resolve) =>
        requestAnimationFrame(
          resolve
        )
    );

    const stream =
      renderCanvas.captureStream(
        fps
      );

    const chunks = [];

    let recorder;

    try {
      recorder = mimeType
        ? new MediaRecorder(
            stream,
            {
              mimeType,
              videoBitsPerSecond:
                6000000
            }
          )
        : new MediaRecorder(
            stream,
            {
              videoBitsPerSecond:
                6000000
            }
          );
    } catch (error) {
      console.error(error);

      rendering = false;

      if (createButton) {
        createButton.disabled =
          false;
      }

      stream
        .getTracks()
        .forEach(
          (track) =>
            track.stop()
        );

      setStatus(
        `⚠️ 動画レコーダーを開始できなかったよ: ${error?.message || error}`
      );

      return;
    }

    recorder.ondataavailable =
      (event) => {
        if (event.data?.size) {
          chunks.push(
            event.data
          );
        }
      };

    const stopped =
      new Promise(
        (resolve, reject) => {
          recorder.onstop =
            resolve;

          recorder.onerror =
            (event) =>
              reject(
                event.error ||
                new Error(
                  '動画生成エラー'
                )
              );
        }
      );

    try {
      recorder.start(250);

      const start =
        performance.now();

      const durationMs =
        durationSec * 1000;

      await new Promise(
        (resolve) => {
          const render =
            (now) => {
              const elapsed =
                now - start;

              const progress =
                Math.min(
                  1,
                  elapsed /
                    durationMs
                );

              drawFrame(
                progress,
                motion
              );

              setStatus(
                `🎞️ 動画作成中… ${Math.round(progress * 100)}%`
              );

              if (
                progress < 1
              ) {
                requestAnimationFrame(
                  render
                );
              } else {
                resolve();
              }
            };

          requestAnimationFrame(
            render
          );
        }
      );

      // 最後のフレームを確実に入れる。
      drawFrame(
        1,
        motion
      );

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            150
          )
      );

      recorder.requestData?.();
      recorder.stop();

      await stopped;

      const finalType =
        recorder.mimeType ||
        mimeType ||
        'video/webm';

      videoBlob =
        new Blob(
          chunks,
          {
            type:
              finalType
          }
        );

      if (!videoBlob.size) {
        throw new Error(
          '動画データが空だったよ'
        );
      }

      videoUrl =
        URL.createObjectURL(
          videoBlob
        );

      const preview =
        $('nfVideoPreview');

      const wrap =
        $('nfVideoPreviewWrap');

      if (preview) {
        preview.src =
          videoUrl;

        preview.load();
      }

      if (wrap) {
        wrap.style.display =
          'block';
      }

      if (saveButton) {
        saveButton.disabled =
          false;
      }

      setStatus(
        `✅ 動画完成（${size.width} × ${size.height} / ${durationSec}秒）`
      );

      window.dispatchEvent(
        new CustomEvent(
          'naturalfix:video-ready',
          {
            detail: {
              blob:
                videoBlob,

              url:
                videoUrl,

              width:
                size.width,

              height:
                size.height,

              duration:
                durationSec,

              fps,

              motion
            }
          }
        )
      );
    } catch (error) {
      console.error(error);

      try {
        if (
          recorder.state !==
          'inactive'
        ) {
          recorder.stop();
        }
      } catch {}

      setStatus(
        `⚠️ 動画作成に失敗したよ: ${error?.message || error}`
      );
    } finally {
      stream
        .getTracks()
        .forEach(
          (track) =>
            track.stop()
        );

      rendering = false;

      if (createButton) {
        createButton.disabled =
          false;
      }
    }
  }

  function saveVideo() {
    if (
      !videoBlob ||
      !videoUrl
    ) {
      setStatus(
        '先に動画を作ってね'
      );
      return;
    }

    const a =
      document.createElement(
        'a'
      );

    a.href =
      videoUrl;

    a.download =
      `NaturalFix_video_${Date.now()}.webm`;

    a.click();
  }

  $('nfCreateVideo')
    ?.addEventListener(
      'click',
      createVideo
    );

  $('nfSaveVideo')
    ?.addEventListener(
      'click',
      saveVideo
    );

  $('fileInput')
    ?.addEventListener(
      'change',
      resetVideo
    );

  window.addEventListener(
    'beforeunload',
    revokeVideoUrl
  );

  window.NaturalFixVideo = {
    create:
      createVideo,

    save:
      saveVideo,

    reset:
      resetVideo
  };
})();
