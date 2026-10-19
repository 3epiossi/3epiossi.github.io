/**
 * 規則學院共用骨架（五連黑白棋與劃區爭霸共用）
 *
 * startAcademy({ id, t, playHref, lessons, root })
 *   t(key)：該遊戲規則學院的翻譯函式；用到 "title"、"lead"，以及每課的 "<課程id>.title"、"<課程id>.summary"。
 *   lessons: [{ id, mount(ctx) }]，mount 回傳清理函式（可省略）；語言切換時會重新 mount 目前這一課。
 *   ctx: {
 *     stage      左側舞台（放棋盤）
 *     setText(html)            設定說明文字
 *     setGoals([{id, text}])   設定目標清單，回傳 { check(id), isChecked(id), all() }；全部達成會自動標記本課完成
 *     feedback(text, kind)     顯示回饋，kind: "info" | "ok" | "warn" | "bad"
 *     actions(buttons)         設定舞台下方的操作按鈕 [{label, onClick, primary}]
 *     complete()               直接標記本課完成
 *   }
 *
 * 進度存在 localStorage（academy.<id>.v1），網址 #課程id 可以直接開某一課。
 */

import { createT, onLang, initLang } from "./i18n.js";

const KEY = (id) => `academy.${id}.v1`;

const UI = createT({
  zh: { lesson: "第 {n} 課", prev: "上一課", next: "下一課", done: "這一課完成了", reset: "清除進度", nav: "課程", home: "回到遊戲", play: "開始對弈" },
  en: { lesson: "Lesson {n}", prev: "Previous", next: "Next", done: "Lesson complete", reset: "Reset progress", nav: "Lessons", home: "Back to game", play: "Start playing" },
  ja: { lesson: "第 {n} 課", prev: "前へ", next: "次へ", done: "このレッスンは完了です", reset: "進捗をリセット", nav: "レッスン", home: "ゲームに戻る", play: "対局を始める" }
});

function loadDone(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(id)) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch (_) {
    return new Set();
  }
}

function saveDone(id, done) {
  try { localStorage.setItem(KEY(id), JSON.stringify([...done])); } catch (_) { /* 私密瀏覽 */ }
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function startAcademy({ id, t, playHref, lessons, root }) {
  initLang();
  const done = loadDone(id);
  let index = Math.max(0, lessons.findIndex((l) => `#${l.id}` === location.hash));
  if (index < 0) index = 0;
  let cleanup = null;

  function renderShell() {
    root.innerHTML = `
      <div class="acadHead">
        <div class="acadTitle">
          <h1>${escapeHtml(t("title"))}</h1>
          <p>${escapeHtml(t("lead"))}</p>
        </div>
        <div class="acadProgress" aria-live="polite"><div class="acadBar"><i></i></div><span class="acadCount"></span></div>
      </div>
      <div class="acadBody">
        <nav class="acadNav" aria-label="${escapeHtml(UI("nav"))}"><ol></ol><button type="button" class="acadReset">${escapeHtml(UI("reset"))}</button></nav>
        <section class="acadLesson" aria-live="polite"></section>
      </div>`;
    list = root.querySelector(".acadNav ol");
    lessonEl = root.querySelector(".acadLesson");
    countEl = root.querySelector(".acadCount");
    barEl = root.querySelector(".acadBar i");
    root.querySelector(".acadReset").addEventListener("click", () => {
      done.clear();
      saveDone(id, done);
      go(0);
    });
    document.title = t("title");
    const home = document.querySelector("[data-academy-home]");
    if (home) home.textContent = UI("home");
  }
  let list, lessonEl, countEl, barEl;

  function renderNav() {
    list.innerHTML = lessons.map((l, i) => `
      <li><button type="button" class="acadStep ${i === index ? "on" : ""} ${done.has(l.id) ? "done" : ""}" data-i="${i}" ${i === index ? 'aria-current="step"' : ""}>
        <span class="acadDot">${done.has(l.id) ? "&#10003;" : i + 1}</span>
        <span class="acadStepText"><b>${escapeHtml(t(`${l.id}.title`))}</b><small>${escapeHtml(t(`${l.id}.summary`))}</small></span>
      </button></li>`).join("");
    list.querySelectorAll(".acadStep").forEach((btn) => btn.addEventListener("click", () => go(Number(btn.dataset.i))));
    const n = lessons.filter((l) => done.has(l.id)).length;
    countEl.textContent = `${n} / ${lessons.length}`;
    barEl.style.width = `${(n / lessons.length) * 100}%`;
  }

  function markDone(lessonId) {
    if (done.has(lessonId)) return;
    done.add(lessonId);
    saveDone(id, done);
    renderNav();
  }

  function go(i) {
    if (i < 0 || i >= lessons.length) return;
    cleanup?.();
    cleanup = null;
    index = i;
    const lesson = lessons[i];
    history.replaceState(null, "", `#${lesson.id}`);

    lessonEl.innerHTML = `
      <header class="lessonHead"><span class="lessonNo">${escapeHtml(UI("lesson", { n: i + 1 }))}</span><h2>${escapeHtml(t(`${lesson.id}.title`))}</h2></header>
      <div class="lessonGrid">
        <div class="lessonStage"><div class="stageBoard"></div><div class="stageActions"></div></div>
        <div class="lessonSide">
          <div class="lessonText"></div>
          <ul class="goalList"></ul>
          <div class="feedback" role="status"></div>
        </div>
      </div>
      <footer class="lessonFoot">
        <button type="button" class="btn" data-nav="prev" ${i === 0 ? "disabled" : ""}>${escapeHtml(UI("prev"))}</button>
        <span class="lessonDone"></span>
        ${i === lessons.length - 1
          ? `<a class="btn primary" href="${playHref}">${escapeHtml(UI("play"))}</a>`
          : `<button type="button" class="btn primary" data-nav="next">${escapeHtml(UI("next"))}</button>`}
      </footer>`;

    const stage = lessonEl.querySelector(".stageBoard");
    const actionsEl = lessonEl.querySelector(".stageActions");
    const textEl = lessonEl.querySelector(".lessonText");
    const goalsEl = lessonEl.querySelector(".goalList");
    const feedbackEl = lessonEl.querySelector(".feedback");
    const doneEl = lessonEl.querySelector(".lessonDone");

    const refreshDone = () => { doneEl.textContent = done.has(lesson.id) ? UI("done") : ""; };
    lessonEl.querySelector('[data-nav="prev"]')?.addEventListener("click", () => go(i - 1));
    lessonEl.querySelector('[data-nav="next"]')?.addEventListener("click", () => go(i + 1));

    const ctx = {
      stage,
      setText(html) { textEl.innerHTML = html; },
      setGoals(items) {
        const checked = new Set();
        goalsEl.innerHTML = items.map((g) => `<li data-id="${g.id}"><span class="goalMark"></span><span>${g.text}</span></li>`).join("");
        const api = {
          check(goalId) {
            if (checked.has(goalId)) return;
            checked.add(goalId);
            goalsEl.querySelector(`[data-id="${goalId}"]`)?.classList.add("on");
            if (checked.size === items.length) { markDone(lesson.id); refreshDone(); }
          },
          isChecked: (goalId) => checked.has(goalId),
          all: () => checked.size === items.length
        };
        return api;
      },
      feedback(text, kind = "info") {
        feedbackEl.className = `feedback ${text ? kind : ""}`;
        feedbackEl.innerHTML = text || "";
      },
      actions(buttons) {
        actionsEl.innerHTML = "";
        for (const b of buttons) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = `btn ${b.primary ? "primary" : ""}`;
          el.textContent = b.label;
          el.addEventListener("click", b.onClick);
          actionsEl.appendChild(el);
        }
      },
      complete() { markDone(lesson.id); refreshDone(); }
    };

    refreshDone();
    cleanup = lesson.mount(ctx) || null;
    renderNav();
    window.scrollTo({ top: 0 });
  }

  renderShell();
  renderNav();
  go(index);
  // 語言切換：整頁（標題、課程清單、本課內容）用新語言重畫，進度保留
  onLang(() => {
    renderShell();
    renderNav();
    go(index);
  });
  return { go, done };
}
