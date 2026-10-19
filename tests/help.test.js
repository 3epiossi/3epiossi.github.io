import test from "node:test";
import assert from "node:assert/strict";
import { HELP, UI_TEXT } from "../shared/help-content.js";
import { ART } from "../shared/help-art.js";
import { GAMES, LANGS } from "../shared/games.js";

test("共用規則視窗：每個遊戲、每種語言都有完整內容", () => {
  for (const g of GAMES) {
    for (const lang of LANGS) {
      const c = HELP[g.id][lang];
      assert.ok(c, `${g.id}/${lang}`);
      assert.ok(c.goal && c.goal.length > 4, `${g.id}/${lang} 目標`);
      assert.equal(c.steps.length, 4, `${g.id}/${lang} 應有 4 張規則卡`);
      for (const s of c.steps) {
        assert.ok(s.title && s.text, `${g.id}/${lang} 規則卡文字`);
        assert.ok(ART[s.art], `${g.id}/${lang} 缺少示意圖 ${s.art}`);
      }
      assert.ok(c.keys.length >= 4, `${g.id}/${lang} 操作說明`);
      for (const [k, v] of c.keys) assert.ok(k && v);
    }
  }
});

test("共用規則視窗：三種語言的介面文字齊全，且三個遊戲的規則卡示意圖相同", () => {
  for (const lang of LANGS) {
    for (const key of ["title", "tabRules", "tabKeys", "academy", "start", "close", "fullGuide"]) {
      assert.ok(UI_TEXT[lang][key], `${lang}.${key}`);
    }
  }
  for (const g of GAMES) {
    const arts = HELP[g.id].zh.steps.map((s) => s.art);
    for (const lang of LANGS) {
      assert.deepEqual(HELP[g.id][lang].steps.map((s) => s.art), arts, `${g.id}/${lang} 示意圖順序一致`);
    }
  }
  for (const art of Object.values(ART)) assert.ok(art.startsWith("<svg") && art.endsWith("</svg>"));
});
