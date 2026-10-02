#!/usr/bin/env node
/**
 * 📦 Workspace File Exporter (工作區檔案匯出與內容記錄工具)
 * 遍歷當前工作區所有檔案，將檔案名稱、中繼資訊（路徑、大小、行數、修改時間）
 * 與完整檔案內容整合記錄至單一 .txt 文字檔中。
 *
 * 使用方式：
 *   node export_workspace.js                     # 預設輸出至 workspace_dump.txt
 *   node export_workspace.js my_backup.txt       # 指定輸出檔名
 *   npm run export                               # 透過 npm script 執行
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 預設忽略之目錄與系統檔案
const IGNORED_DIRS = new Set([".git", "node_modules", ".vscode", ".idea"]);
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);

// 已知純文字副檔名清單
const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".json", ".md", ".txt", ".yml", ".yaml", ".xml", ".svg",
  ".sh", ".zsh", ".bash", ".env", ".gitignore", ".nojekyll",
  "license"
]);

/**
 * 格式化位元組大小為易讀字串
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * 格式化時間戳記為 YYYY-MM-DD HH:mm:ss
 */
function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 判斷緩衝區是否可能為二進位檔案 (檢查前 512 bytes 是否含有空字元)
 */
function isBinaryBuffer(buffer) {
  const checkLen = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * 遞迴收集目錄下所有檔案資訊
 */
function collectFiles(dirPath, rootDir, outputPath) {
  const result = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    // 略過忽略目錄
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        result.push(...collectFiles(fullPath, rootDir, outputPath));
      }
      continue;
    }

    // 略過忽略檔案與目標輸出檔本身
    if (IGNORED_FILES.has(entry.name)) continue;
    if (path.resolve(fullPath) === path.resolve(outputPath)) continue;

    try {
      const stats = fs.statSync(fullPath);
      const ext = path.extname(entry.name).toLowerCase();
      const baseNameLower = entry.name.toLowerCase();

      let isText = TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(baseNameLower);
      const buffer = fs.readFileSync(fullPath);

      if (!isText && !isBinaryBuffer(buffer)) {
        isText = true;
      }

      let content = "";
      let lineCount = 0;

      if (isText) {
        content = buffer.toString("utf8");
        lineCount = content.length > 0 ? content.split(/\r?\n/).length : 0;
      }

      result.push({
        name: entry.name,
        relPath,
        fullPath,
        ext: ext || "(none)",
        sizeBytes: stats.size,
        sizeFormatted: formatBytes(stats.size),
        createdAt: formatDate(stats.birthtime),
        modifiedAt: formatDate(stats.mtime),
        isText,
        lineCount,
        content
      });
    } catch (err) {
      console.warn(`⚠️ 無法讀取檔案: ${relPath} (${err.message})`);
    }
  }

  return result;
}

/**
 * 主執行函式
 */
export function exportWorkspace(customOutputFile = "workspace_dump.txt", rootDir = __dirname) {
  const resolvedOutput = path.resolve(rootDir, customOutputFile);
  console.log(`\n🔍 開始掃描工作區: ${rootDir}`);
  console.log(`📄 目標輸出路徑: ${resolvedOutput}\n`);

  const files = collectFiles(rootDir, rootDir, resolvedOutput);

  // 排序檔案 (依相對路徑字母排序)
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const totalFiles = files.length;
  const totalBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0);
  const totalLines = files.reduce((acc, f) => acc + (f.isText ? f.lineCount : 0), 0);

  const dividerHeavy = "=".repeat(80);
  const dividerLight = "-".repeat(80);

  const lines = [];

  // 1. 檔頭資訊 (Header Summary)
  lines.push(dividerHeavy);
  lines.push("📦 工作區檔案內容總匯報告 (WORKSPACE DUMP REPORT)");
  lines.push(dividerHeavy);
  lines.push(`產生時間      : ${formatDate(new Date())}`);
  lines.push(`工作區目錄    : ${rootDir}`);
  lines.push(`目標輸出檔案  : ${resolvedOutput}`);
  lines.push(`檔案總數量    : ${totalFiles} 個檔案`);
  lines.push(`總檔案大小    : ${formatBytes(totalBytes)} (${totalBytes.toLocaleString()} bytes)`);
  lines.push(`純文字總行數  : ${totalLines.toLocaleString()} 行`);
  lines.push(dividerHeavy);
  lines.push("");

  // 2. 檔案目錄索引 (Table of Contents)
  lines.push("📋 [檔案目錄清單與索引]");
  lines.push(dividerLight);
  files.forEach((f, idx) => {
    const num = String(idx + 1).padStart(3, " ");
    const info = f.isText ? `${f.sizeFormatted}, ${f.lineCount} 行` : `${f.sizeFormatted} (二進位)`;
    lines.push(`${num}. [${f.relPath}] (${info})`);
  });
  lines.push(dividerLight);
  lines.push("");

  // 3. 各檔案詳細中繼資訊與完整內容
  files.forEach((f, idx) => {
    lines.push(dividerHeavy);
    lines.push(`【檔案 #${idx + 1} / ${totalFiles}】: ${f.relPath}`);
    lines.push(dividerHeavy);
    lines.push("[檔案中繼資訊 (Metadata)]");
    lines.push(`- 檔案名稱     : ${f.name}`);
    lines.push(`- 相對路徑     : ${f.relPath}`);
    lines.push(`- 絕對路徑     : ${f.fullPath}`);
    lines.push(`- 副檔名類型   : ${f.ext}`);
    lines.push(`- 檔案大小     : ${f.sizeFormatted} (${f.sizeBytes.toLocaleString()} bytes)`);
    lines.push(`- 內容格式     : ${f.isText ? "純文字檔 (UTF-8)" : "二進位檔案"}`);
    if (f.isText) {
      lines.push(`- 總文字行數   : ${f.lineCount.toLocaleString()} 行`);
    }
    lines.push(`- 建立時間     : ${f.createdAt}`);
    lines.push(`- 最後修改時間 : ${f.modifiedAt}`);
    lines.push(dividerLight);
    lines.push("[檔案內容 (File Content)]");
    lines.push(dividerLight);

    if (f.isText) {
      lines.push(f.content);
      if (!f.content.endsWith("\n")) {
        lines.push("");
      }
    } else {
      lines.push(`[二進位檔案或多媒體資源，略過原始碼內容輸出。檔案大小: ${f.sizeFormatted}]`);
      lines.push("");
    }
  });

  lines.push(dividerHeavy);
  lines.push("🏁 [工作區匯出結束 / END OF DUMP]");
  lines.push(dividerHeavy);

  // 寫入目標檔案
  fs.writeFileSync(resolvedOutput, lines.join("\n"), "utf8");

  console.log(`✅ 匯出完成！`);
  console.log(`📊 統計摘要:`);
  console.log(`   - 處理檔案數: ${totalFiles} 個`);
  console.log(`   - 純文字行數: ${totalLines.toLocaleString()} 行`);
  console.log(`   - 總資料大小: ${formatBytes(totalBytes)}`);
  console.log(`📁 輸出檔案位置: ${resolvedOutput}\n`);

  return {
    outputFile: resolvedOutput,
    totalFiles,
    totalBytes,
    totalLines
  };
}

// 支援直接執行: node export_workspace.js [target_filename.txt]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const targetOutput = process.argv[2] || "workspace_dump.txt";
  exportWorkspace(targetOutput);
}
