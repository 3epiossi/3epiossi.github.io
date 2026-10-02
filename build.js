/**
 * 📦 誰會贏？ (Who will win?) - 零依賴打包建構腳本 (Zero-dependency Bundler)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, "dist");
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 收集所有 CSS 檔案
const cssFiles = [
  "styles/base.css",
  "styles/board.css",
  "styles/panels.css",
  "styles/modal.css",
  "styles/themes.css"
];

let bundledCss = "";
for (const file of cssFiles) {
  const fullPath = path.join(__dirname, file);
  if (fs.existsSync(fullPath)) {
    bundledCss += `\n/* ===== ${file} ===== */\n` + fs.readFileSync(fullPath, "utf8");
  }
}
fs.writeFileSync(path.join(distDir, "bundle.css"), bundledCss, "utf8");
console.log("✓ CSS bundle created: dist/bundle.css");

console.log("✓ Build complete!");
