/**
 * 🌐 誰會贏？ (Who will win?) - 零依賴本地靜態伺服器 (Zero-dependency Local Dev Server)
 *
 * 只供本機開發使用：預設只監聽 127.0.0.1、只服務白名單副檔名、不公開隱藏檔（如 .git），
 * 並拒絕非本機的 Host 標頭（避免 DNS rebinding）。
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || "127.0.0.1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function isInside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "405 Method Not Allowed");
  }

  const host = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return send(res, 403, "403 Forbidden");
  }

  let reqPath;
  try {
    reqPath = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  } catch {
    return send(res, 400, "400 Bad Request");
  }
  if (reqPath.includes("\0") || reqPath.includes("\\")) {
    return send(res, 400, "400 Bad Request");
  }
  if (reqPath === "/") reqPath = "/index.html";

  // 任何以「.」開頭的路徑片段（.git、.claude、.env…）一律不提供
  if (reqPath.split("/").some((seg) => seg.startsWith("."))) {
    return send(res, 404, "404 Not Found");
  }

  const ext = path.extname(reqPath).toLowerCase();
  const contentType = MIME_TYPES[ext];
  if (!contentType) {
    return send(res, 404, "404 Not Found");
  }

  const filePath = path.resolve(ROOT, "." + reqPath);
  if (!isInside(ROOT, filePath)) {
    return send(res, 403, "403 Forbidden");
  }

  // realpath 可擋掉專案內指向外部的符號連結
  fs.realpath(filePath, (err, realPath) => {
    if (err || !isInside(ROOT, realPath)) {
      return send(res, 404, "404 Not Found");
    }
    fs.stat(realPath, (statErr, stats) => {
      if (statErr || !stats.isFile()) {
        return send(res, 404, "404 Not Found");
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": stats.size,
        "X-Content-Type-Options": "nosniff"
      });
      if (req.method === "HEAD") return res.end();
      const stream = fs.createReadStream(realPath);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    });
  });
});

server.on("clientError", (_err, socket) => {
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`\n誰會贏？ 本地伺服器已啟動！`);
  console.log(`請在瀏覽器開啟: http://localhost:${PORT}`);
  console.log(`按 Ctrl+C 可停止伺服器\n`);
});
