/* NaturalFix Face Tools v1.0
   - 選択した人物ごとの個別補正
   - 明るさ / コントラスト / 彩度
   - 顔の補正設定を人物ごとに保存
*/
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');

  if (!canvas) return;

  let selectedIndex = -1;
  const corrections = new Map();

  const style = document.createElement('style');

  style.textContent = `
    .nf-face-card {
      outline: 1px solid #8ba8ff22;
    }

    .nf-face-status {
      margin: 8px 0;
      font-size: 13px;
    }

    .nf-face-controls {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }

    .nf-face-control label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      font-size: 13px;
    }

    .nf-face-control input {
      width: 100%;
    }

    .nf-face-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
  `;

  document.head.appendChild(style);

  const peopleCard = $('nfPeopleTools');

  const card = document.createElement('section');
  card.id = 'nfFaceTools';
  card.className = 'card nf-face-card';

  card.innerHTML = `
    <h3>🎭 顔ごとの個別補正</h3>

    <p class="note">
      複数人物認識で選んだ人物だけに
      補正設定を持たせるよ。
    </p>

    <div
      id="nfFaceStatus"
      class="nf-face-status"
    >
      先に人物を認識して選択してね
    </div>

    <div class="nf-face-controls">

      <div class="nf-face-control">
        <label>
          <span>明るさ</span>
          <span id="nfFaceBrightnessValue">100</span>
        </label>

        <input
          id="nfFaceBrightness"
          type="range"
          min="60"
          max="140"
          value="100"
        >
      </div>

      <div class="nf-face-control">
        <label>
          <span>コントラスト</span>
          <span id="nfFaceContrastValue">100</span>
        </label>

        <input
          id="nfFaceContrast"
          type="range"
          min="60"
          max="140"
          value="100"
        >
      </div>

      <div class="nf-face-control">
        <label>
          <span>彩度</span>
          <span id="nfFaceSaturationValue">100</span>
        </label>

        <input
          id="nfFaceSaturation"
          type="range"
          min="0"
          max="160"
          value="100"
        >
      </div>

    </div>

    <div class="nf-face-actions">
      <button
        id="nfSaveFaceCorrection"
        type="button"
        class="primary"
      >
        💾 この人物の補正を保存
      </button>

      <button
        id="nfResetFaceCorrection"
        type="button"
      >
        ↩ この人物をリセット
      </button>
    </div>
  `;

  if (peopleCard) {
    peopleCard.insertAdjacentElement(
      'afterend',
      card
    );
  } else {
    document
      .querySelector('.container')
      ?.appendChild(card);
  }

  const brightness =
    $('nfFaceBrightness');

  const contrast =
    $('nfFaceContrast');

  const saturation =
    $('nfFaceSaturation');

  const brightnessValue =
    $('nfFaceBrightnessValue');

  const contrastValue =
    $('nfFaceContrastValue');

  const saturationValue =
    $('nfFaceSaturationValue');

  function setStatus(text) {
    const el = $('nfFaceStatus');

    if (el) {
      el.textContent = text;
    }
  }

  function updateLabels() {
    brightnessValue.textContent =
      brightness.value;

    contrastValue.textContent =
      contrast.value;

    saturationValue.textContent =
      saturation.value;
  }

  function defaultCorrection() {
    return {
      brightness: 100,
      contrast: 100,
      saturation: 100
    };
  }

  function loadSelectedCorrection() {
    if (selectedIndex < 0) {
      return;
    }

    const correction =
      corrections.get(selectedIndex) ||
      defaultCorrection();

    brightness.value =
      correction.brightness;

    contrast.value =
      correction.contrast;

    saturation.value =
      correction.saturation;

    updateLabels();

    setStatus(
      `👤 人物${selectedIndex + 1}を編集中`
    );
  }

  function saveCorrection() {
    if (selectedIndex < 0) {
      setStatus(
        '先に人物を選択してね'
      );

      return;
    }

    corrections.set(
      selectedIndex,
      {
        brightness:
          Number(brightness.value),

        contrast:
          Number(contrast.value),

        saturation:
          Number(saturation.value)
      }
    );

    setStatus(
      `✅ 人物${selectedIndex + 1}の補正を保存したよ`
    );

    window.dispatchEvent(
      new CustomEvent(
        'naturalfix:face-correction-changed',
        {
          detail: {
            index: selectedIndex,

            correction:
              corrections.get(
                selectedIndex
              )
          }
        }
      )
    );
  }

  function resetCorrection() {
    if (selectedIndex < 0) {
      return;
    }

    corrections.delete(
      selectedIndex
    );

    brightness.value = 100;
    contrast.value = 100;
    saturation.value = 100;

    updateLabels();

    setStatus(
      `↩ 人物${selectedIndex + 1}の補正をリセットしたよ`
    );
  }

  brightness.addEventListener(
    'input',
    updateLabels
  );

  contrast.addEventListener(
    'input',
    updateLabels
  );

  saturation.addEventListener(
    'input',
    updateLabels
  );

  $('nfSaveFaceCorrection')
  ?.addEventListener(
    'click',
    saveCorrection
  );

$('nfResetFaceCorrection')
  ?.addEventListener(
    'click',
    resetCorrection
  );

window.addEventListener(
  'naturalfix:person-selected',
  (event) => {
    selectedIndex =
      event.detail?.index ?? -1;

    loadSelectedCorrection();
  }
);

window.addEventListener(
  'naturalfix:people-detected',
  (event) => {
    selectedIndex =
      event.detail?.selectedIndex ?? -1;

    if (selectedIndex >= 0) {
      loadSelectedCorrection();
    }
  }
);

window.addEventListener(
  'naturalfix:people-cleared',
  () => {
    selectedIndex = -1;

    setStatus(
      '先に人物を認識して選択してね'
    );
  }
);

window.NaturalFixFaceTools = {
  getCorrection(index) {
    return (
      corrections.get(index) ||
      defaultCorrection()
    );
  },

  getAllCorrections() {
    return new Map(corrections);
  },

  clearAll() {
    corrections.clear();
    selectedIndex = -1;
  }
};

updateLabels();
})();
