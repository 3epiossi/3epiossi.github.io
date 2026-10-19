import test from "node:test";
import assert from "node:assert/strict";
import { DICTS as DISTRICT } from "../district/src/i18n.js";
import { DICTS as DISTRICT_LEARN } from "../district/learn/i18n.js";
import { DICTS as FIVE_LEARN } from "../five/learn/i18n.js";
import { DICTIONARY as WHOWINS } from "../whowins/src/i18n.js";
import fs from "node:fs";
import path from "node:path";

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

for (const [name, dicts] of Object.entries({ "傑利蠑螈": DISTRICT, "傑利蠑螈規則學院": DISTRICT_LEARN, "五連黑白棋規則學院": FIVE_LEARN, "誰會贏？": WHOWINS })) {
  test(`${name}：中英日三種語言的文字齊全，變數一致`, () => {
    const keys = Object.keys(dicts.zh);
    assert.ok(keys.length > 40, "字串數量不應太少");
    for (const lang of ["en", "ja"]) {
      assert.deepEqual(Object.keys(dicts[lang]).sort(), [...keys].sort(), `${lang} 的鍵要與 zh 完全相同`);
    }
    for (const key of keys) {
      const expected = placeholders(dicts.zh[key]);
      for (const lang of ["en", "ja"]) {
        assert.ok(String(dicts[lang][key]).trim().length > 0, `${lang}.${key} 不可空白`);
        assert.equal(placeholders(dicts[lang][key]), expected, `${lang}.${key} 的 {變數} 要與 zh 相同`);
      }
    }
  });
}

test("英文與日文的文字裡不應殘留中文字（專有名詞除外）", () => {
  const allowed = /台灣|台湾|五連|黑白棋|誰會贏|誰が勝つ/; // 台灣是內建圖形名稱，五連黑白棋是遊戲名
  for (const [name, dicts] of Object.entries({ DISTRICT, DISTRICT_LEARN, FIVE_LEARN, WHOWINS })) {
    for (const [key, text] of Object.entries(dicts.en)) {
      const stripped = String(text).replace(allowed, "");
      assert.ok(!/[一-鿿]/.test(stripped), `${name}.en.${key} 含中文：${text}`);
    }
  }
});

test("誰會贏？：程式與頁面用到的文字鍵都在字典裡，使用者看得到的字不含 emoji 與破折號", () => {
  const root = new URL("../whowins/", import.meta.url).pathname;
  const files = [path.join(root, "index.html")];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith(".js") && !p.endsWith("i18n.js")) files.push(p); } })(path.join(root, "src"));
  const text = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const used = new Set();
  for (const m of text.matchAll(/data-i18n(?:-title|-placeholder)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/\btr\("([A-Za-z0-9_]+)"(?!\s*\+)/g)) used.add(m[1]);
  for (const m of text.matchAll(/tr\([a-zA-Z.]+ \? "([A-Za-z0-9_]+)" : "([A-Za-z0-9_]+)"/g)) { used.add(m[1]); used.add(m[2]); }
  for (const m of text.matchAll(/\bmsg\("([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  for (const key of used) assert.ok(WHOWINS.zh[key] != null, `字典缺少 ${key}`);
  const symbolsOk = /[⚫⚪]/g; // 席位名稱會換成棋子圖示
  for (const lang of ["zh", "en", "ja"]) {
    for (const [key, text] of Object.entries(WHOWINS[lang])) {
      assert.ok(!/[—–]/.test(text), `${lang}.${key} 含破折號`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(String(text).replace(symbolsOk, "")), `${lang}.${key} 含 emoji`);
    }
  }
});
