/* NaturalFix Prompt Tools v1.0
   - プロンプト入力補助
   - プロンプト自動生成
   - プロンプト履歴
*/
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'naturalfix_prompt_history_v1';
  const MAX_HISTORY = 20;

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveHistory(text) {
    const prompt = String(text || '').trim();
    if (!prompt) return;

    const items = getHistory().filter((item) => item !== prompt);
    items.unshift(prompt);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(items.slice(0, MAX_HISTORY))
    );

    renderHistory();
  }

  function clearHistory() {
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
  }

  function createPrompt() {
    const subject = $('nfPromptSubject')?.value.trim();
    const style = $('nfPromptStyle')?.value.trim();
    const mood = $('nfPromptMood')?.value.trim();
    const background = $('nfPromptBackground')?.value.trim();
    const lighting = $('nfPromptLighting')?.value.trim();
    const camera = $('nfPromptCamera')?.value.trim();
    const extra = $('nfPromptExtra')?.value.trim();

    const parts = [];

    if (subject) parts.push(`Main subject: ${subject}`);
    if (style) parts.push(`Style: ${style}`);
    if (mood) parts.push(`Mood and expression: ${mood}`);
    if (background) parts.push(`Background: ${background}`);
    if (lighting) parts.push(`Lighting: ${lighting}`);
    if (camera) parts.push(`Camera and composition: ${camera}`);

    parts.push(
      'Keep the main subject natural and visually consistent.'
    );

    parts.push(
      'Preserve facial identity, proportions, colors and important details when reference images are used.'
    );

    if (extra) {
      parts.push(`Additional instruction: ${extra}`);
    }

    return parts.join('\n');
  }

  function renderHistory() {
    const area = $('nfPromptHistory');
    if (!area) return;

    const history = getHistory();

    if (!history.length) {
      area.innerHTML =
        '<div class="nf-prompt-empty">まだ履歴はないよ</div>';
      return;
    }

    area.innerHTML = '';

    history.forEach((text) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nf-prompt-history-item';

      button.textContent =
        text.length > 55
          ? `${text.slice(0, 55)}…`
          : text;

      button.title = text;

      button.addEventListener('click', () => {
        const target = $('multiRefPrompt');
        if (target) {
          target.value = text;
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }
      });

      area.appendChild(button);
    });
  }

  function createUi() {
    const target = $('multiRefPrompt');

    if (!target || $('nfPromptTools')) return;

    const style = document.createElement('style');

    style.textContent = `
      .nf-prompt-tools {
        margin-top: 12px;
        padding: 14px;
        border-radius: 14px;
        background: #292e38;
      }

      .nf-prompt-tools h4 {
        margin: 0 0 12px;
      }

      .nf-prompt-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
      }

      .nf-prompt-tools input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px;
        border-radius: 9px;
        border: 1px solid #464d59;
        background: #16191f;
        color: white;
      }

      .nf-prompt-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .nf-prompt-buttons button {
        padding: 10px 12px;
      }

      .nf-prompt-history {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin-top: 10px;
      }

      .nf-prompt-history-item {
        border: 1px solid #454c59;
        border-radius: 999px;
        background: #1a2029;
        color: white;
        padding: 7px 11px;
        font-size: 12px;
      }

      .nf-prompt-empty {
        font-size: 12px;
        opacity: .65;
      }

      @media (max-width: 700px) {
        .nf-prompt-grid {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);

    const panel = document.createElement('div');

    panel.id = 'nfPromptTools';
    panel.className = 'nf-prompt-tools';

    panel.innerHTML = `
      <h4>🪄 プロンプト作成アシスト</h4>

      <div class="nf-prompt-grid">
        <input
          id="nfPromptSubject"
          placeholder="主役・被写体"
        >

        <input
          id="nfPromptStyle"
          placeholder="スタイル 例：リアル / アニメ / 映画風"
        >

        <input
          id="nfPromptMood"
          placeholder="表情・雰囲気"
        >

        <input
          id="nfPromptBackground"
          placeholder="背景"
        >

        <input
          id="nfPromptLighting"
          placeholder="光・ライティング"
        >

        <input
          id="nfPromptCamera"
          placeholder="構図・カメラ"
        >

        <input
          id="nfPromptExtra"
          placeholder="追加指示"
        >
      </div>

      <div class="nf-prompt-buttons">
        <button
          id="nfPromptGenerate"
          type="button"
          class="primary"
        >
          🧠 プロンプト自動生成
        </button>

        <button
          id="nfPromptAppend"
          type="button"
        >
          ➕ 現在の指示に追加
        </button>

        <button
          id="nfPromptSave"
          type="button"
        >
          💾 履歴保存
        </button>

        <button
          id="nfPromptClear"
          type="button"
        >
          🗑 履歴削除
        </button>
      </div>

      <div style="margin-top:12px;">
        <strong>📚 プロンプト履歴</strong>

        <div
          id="nfPromptHistory"
          class="nf-prompt-history"
        ></div>
      </div>
    `;

    target.parentElement.insertAdjacentElement(
      'afterend',
      panel
    );

    $('nfPromptGenerate').addEventListener('click', () => {
      const prompt = createPrompt();
      target.value = prompt;
      saveHistory(prompt);
    });

    $('nfPromptAppend').addEventListener('click', () => {
      const prompt = createPrompt();

      target.value = target.value.trim()
        ? `${target.value.trim()}\n${prompt}`
        : prompt;
    });

    $('nfPromptSave').addEventListener('click', () => {
      saveHistory(target.value);
    });

    $('nfPromptClear').addEventListener('click', () => {
      if (confirm('プロンプト履歴を全部削除する？')) {
        clearHistory();
      }
    });

    renderHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      createUi
    );
  } else {
    createUi();
  }
})();
