/* NaturalFix Person Tools v1.0
   - 複数人物（顔ベース）自動認識
   - 最大8人
   - 人物1 / 人物2... の選択
   - 次の「顔ごとの個別補正」機能から再利用できる共有データ
*/
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const mainCanvas = $('canvas');
  if (!mainCanvas) return;

  let multiFaceLandmarker = null;
  let detectedPeople = [];
  let selectedPersonIndex = -1;
  let busy = false;

  const style = document.createElement('style');
  style.textContent = `
    .nf-people-card { outline: 1px solid #8ba8ff22; }
    .nf-people-actions {
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin:10px 0;
    }
    .nf-people-status {
      margin:8px 0;
      font-size:13px;
    }
    .nf-people-list {
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:8px;
      margin-top:10px;
    }
    .nf-person-button {
      text-align:left;
      padding:10px;
      border-radius:12px;
      border:1px solid #454c59;
      background:#1a2029;
      color:#fff;
    }
    .nf-person-button.active {
      outline:2px solid #8bb7ff;
      background:#243248;
    }
    .nf-person-meta {
      display:block;
      margin-top:4px;
      font-size:11px;
      opacity:.72;
    }
    .nf-people-note {
      font-size:12px;
      opacity:.72;
      line-height:1.5;
    }
    .nf-people-overlay {
      position:absolute;
      inset:0;
      width:100%;
      height:100%;
      pointer-events:none;
    }

    @media (max-width:700px) {
      .nf-people-list {
        grid-template-columns:1fr;
      }
    }
  `;

  document.head.appendChild(style);

  const faceAnalysisCard = $('tiltResult')?.closest('.card');

  const card = document.createElement('section');
  card.id = 'nfPeopleTools';
  card.className = 'card nf-people-card';

  card.innerHTML = `
    <h3>👥 複数人物の自動認識</h3>

    <p class="nf-people-note">
      画像内の顔を最大8人まで検出して
      「人物1・人物2…」に分けるよ。
      ここで選んだ人物は、次に追加する
      顔ごとの個別補正でそのまま使える。
    </p>

    <div class="nf-people-actions">
      <button
        id="nfDetectPeople"
        type="button"
        class="primary"
      >
        🔍 複数人物を認識
      </button>

      <button
        id="nfClearPeople"
        type="button"
      >
        ♻️ 認識結果をクリア
      </button>
    </div>

    <div
      id="nfPeopleStatus"
      class="nf-people-status"
    >
      AI準備中…
    </div>

    <div
      id="nfPeopleList"
      class="nf-people-list"
    ></div>
  `;

  if (faceAnalysisCard) {
    faceAnalysisCard.insertAdjacentElement(
      'afterend',
      card
    );
  } else {
    document
      .querySelector('.container')
      ?.appendChild(card);
  }

  const wrap = mainCanvas.closest('.canvas-wrap');

  let overlay = null;
  let overlayCtx = null;

  if (wrap) {
    if (
      getComputedStyle(wrap).position === 'static'
    ) {
      wrap.style.position = 'relative';
    }

    overlay = document.createElement('canvas');

    overlay.id = 'nfPeopleOverlay';
    overlay.className = 'nf-people-overlay';

    wrap.appendChild(overlay);

    overlayCtx = overlay.getContext('2d');
  }

  function setStatus(text) {
    const el = $('nfPeopleStatus');

    if (el) {
      el.textContent = text;
    }
  }

  function faceBox(landmarks) {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;

    for (const p of landmarks) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);

      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const w = Math.max(
      0.01,
      maxX - minX
    );

    const h = Math.max(
      0.01,
      maxY - minY
    );

    const padX = w * 0.18;
    const padY = h * 0.22;

    const x = Math.max(
      0,
      minX - padX
    );

    const y = Math.max(
      0,
      minY - padY
    );

    const x2 = Math.min(
      1,
      maxX + padX
    );

    const y2 = Math.min(
      1,
      maxY + padY
    );

    return {
      x,
      y,

      w: Math.max(
        0.01,
        x2 - x
      ),

      h: Math.max(
        0.01,
        y2 - y
      )
    };
  }

  function syncOverlaySize() {
    if (!overlay) return;

    if (
      overlay.width !== mainCanvas.width
    ) {
      overlay.width = mainCanvas.width;
    }

    if (
      overlay.height !== mainCanvas.height
    ) {
      overlay.height = mainCanvas.height;
    }
  }

  function drawOverlay() {
    if (!overlayCtx || !overlay) return;

    syncOverlaySize();

    overlayCtx.clearRect(
      0,
      0,
      overlay.width,
      overlay.height
    );

    detectedPeople.forEach(
      (person, index) => {
        const box = person.box;

        const x =
          box.x * overlay.width;

        const y =
          box.y * overlay.height;

        const w =
          box.w * overlay.width;

        const h =
          box.h * overlay.height;

        const active =
          index === selectedPersonIndex;

        overlayCtx.save();

        overlayCtx.lineWidth =
          active ? 5 : 3;

        overlayCtx.strokeStyle =
          active
            ? '#8bb7ff'
            : '#00e0a4';

        overlayCtx.fillStyle =
          active
            ? 'rgba(139,183,255,.18)'
            : 'rgba(0,224,164,.10)';

        overlayCtx.fillRect(
          x,
          y,
          w,
          h
        );

        overlayCtx.strokeRect(
          x,
          y,
          w,
          h
        );

        const label =
          `人物${index + 1}`;

        overlayCtx.font =
          'bold 22px sans-serif';

        const textW =
          overlayCtx
            .measureText(label)
            .width;

        const labelH = 30;

        const labelY =
          Math.max(labelH, y);

        overlayCtx.fillStyle =
          active
            ? '#8bb7ff'
            : '#00e0a4';

        overlayCtx.fillRect(
          x,
          labelY - labelH,
          textW + 16,
          labelH
        );

        overlayCtx.fillStyle =
          '#0b1017';

        overlayCtx.fillText(
          label,
          x + 8,
          labelY - 7
        );

        overlayCtx.restore();
      }
    );
  }

  function renderPeopleList() {
    const list = $('nfPeopleList');

    if (!list) return;

    list.innerHTML = '';

    if (!detectedPeople.length) {
      return;
    }

    detectedPeople.forEach(
      (person, index) => {
        const button =
          document.createElement(
            'button'
          );

        button.type = 'button';

        button.className =
          `nf-person-button${
            index === selectedPersonIndex
              ? ' active'
              : ''
          }`;

        const size =
          Math.round(
            person.box.w *
            person.box.h *
            10000
          ) / 100;

        button.innerHTML = `
          <strong>
            👤 人物${index + 1}
          </strong>

          <span class="nf-person-meta">
            顔領域の目安 ${size}%
          </span>
        `;

        button.addEventListener(
          'click',
          () => selectPerson(index)
        );

        list.appendChild(button);
      }
    );
  }

  function selectPerson(index) {
    if (!detectedPeople[index]) {
      return;
    }

    selectedPersonIndex = index;

    renderPeopleList();
    drawOverlay();

    window.dispatchEvent(
      new CustomEvent(
        'naturalfix:person-selected',
        {
          detail: {
            index,
            person:
              detectedPeople[index]
          }
        }
      )
    );
  }

  function clearPeople() {
    detectedPeople = [];

    selectedPersonIndex = -1;

    renderPeopleList();

    if (overlayCtx && overlay) {
      syncOverlaySize();

      overlayCtx.clearRect(
        0,
        0,
        overlay.width,
        overlay.height
      );
    }

    setStatus(
      multiFaceLandmarker
        ? '画像を読み込んで「複数人物を認識」を押してね'
        : 'AI準備中…'
    );

    window.dispatchEvent(
      new CustomEvent(
        'naturalfix:people-cleared'
      )
    );
  }

  async function initMultiFaceModel() {
    try {
      setStatus(
        '複数人物認識AIを準備中…'
      );

      const {
        FilesetResolver,
        FaceLandmarker
      } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm'
      );

      const vision =
        await FilesetResolver
          .forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
          );

      multiFaceLandmarker =
        await FaceLandmarker
          .createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath:
                  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
              },

              runningMode: 'IMAGE',
              numFaces: 8,
              minFaceDetectionConfidence: 0.45,
              minFacePresenceConfidence: 0.45,
              minTrackingConfidence: 0.45
            }
          );

      setStatus(
        '✅ 複数人物認識AI準備OK'
      );
    } catch (error) {
      console.error(error);

      setStatus(
        '⚠️ 複数人物認識AIを読み込めなかったよ'
      );
    }
  }

  async function detectPeople() {
    if (busy) return;

    if (!multiFaceLandmarker) {
      setStatus(
        'まだAIを準備中だよ。少し待ってからもう一度押してね'
      );
      return;
    }

    if (
      !mainCanvas.width ||
      !mainCanvas.height
    ) {
      setStatus(
        '先に画像を読み込んでね'
      );
      return;
    }

    busy = true;

    const button =
      $('nfDetectPeople');

    if (button) {
      button.disabled = true;
    }

    setStatus(
      '🔍 複数人物を認識中…'
    );

    try {
      const result =
        multiFaceLandmarker
          .detect(mainCanvas);

      const faces =
        result.faceLandmarks || [];

      detectedPeople =
        faces.map(
          (landmarks) => ({
            landmarks,
            box: faceBox(landmarks)
          })
        );

      detectedPeople.sort(
        (a, b) => {
          const ay =
            a.box.y +
            a.box.h / 2;

          const by =
            b.box.y +
            b.box.h / 2;

          if (
            Math.abs(ay - by) >
            0.18
          ) {
            return ay - by;
          }

          return (
            a.box.x -
            b.box.x
          );
        }
      );

      selectedPersonIndex =
        detectedPeople.length
          ? 0
          : -1;

      renderPeopleList();
      drawOverlay();

      if (!detectedPeople.length) {
        setStatus(
          '顔を検出できなかったよ。顔が見える画像で試してね'
        );
      } else {
        setStatus(
          `✅ ${detectedPeople.length}人を認識したよ`
        );

        window.dispatchEvent(
          new CustomEvent(
            'naturalfix:people-detected',
            {
              detail: {
                people: detectedPeople,
                selectedIndex:
                  selectedPersonIndex
              }
            }
          )
        );
      }
    } catch (error) {
      console.error(error);

      clearPeople();

      setStatus(
        `⚠️ 認識エラー: ${
          error.message ||
          'unknown error'
        }`
      );
    } finally {
      busy = false;

      if (button) {
        button.disabled = false;
      }
    }
  }

  $('nfDetectPeople')
    ?.addEventListener(
      'click',
      detectPeople
    );

  $('nfClearPeople')
    ?.addEventListener(
      'click',
      clearPeople
    );

  $('fileInput')
    ?.addEventListener(
      'change',
      clearPeople
    );

  window.addEventListener(
    'resize',
    drawOverlay
  );

  window.NaturalFixPersons = {
    getPeople:
      () => detectedPeople,

    getSelectedIndex:
      () => selectedPersonIndex,

    getSelectedPerson:
      () =>
        detectedPeople[
          selectedPersonIndex
        ] || null,

    selectPerson,
    clear: clearPeople,
    detect: detectPeople
  };

  initMultiFaceModel();
})();
