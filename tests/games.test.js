import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GAMES, TEXT, LANGS } from "../shared/games.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("遊戲切換器：每個遊戲與規則學院的檔案都存在", () => {
  assert.deepEqual(GAMES.map((g) => g.id), ["five", "district", "whowins"]);
  for (const g of GAMES) {
    assert.ok(fs.existsSync(path.join(ROOT, g.path)), `${g.id} 首頁 ${g.path}`);
    assert.ok(fs.existsSync(path.join(ROOT, g.academy)), `${g.id} 規則學院 ${g.academy}`);
  }
});

test("遊戲切換器：三種語言的名稱與簡介齊全", () => {
  for (const lang of LANGS) {
    const t = TEXT[lang];
    assert.ok(t.menuTitle && t.academy && t.current, lang);
    for (const g of GAMES) {
      assert.ok(t.names[g.id], `${lang} 名稱 ${g.id}`);
      assert.ok(t.taglines[g.id], `${lang} 簡介 ${g.id}`);
    }
  }
});

test("遊戲切換器：每個頁面都有切換器並載入元件", () => {
  const pages = { five: "index.html", district: "district/index.html", whowins: "whowins/index.html" };
  for (const [id, file] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(html.includes(`<game-switcher current="${id}">`), `${file} 缺少切換器`);
    assert.ok(html.includes("shared/game-switcher.js"), `${file} 沒有載入元件`);
  }
  for (const [id, file] of Object.entries({ five: "five/learn.html", district: "district/learn.html", whowins: "tutorial.html" })) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(html.includes(`current="${id}"`), `${file} 缺少切換器`);
  }
});
