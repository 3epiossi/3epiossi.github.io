# 誰會贏？ 改版交辦書（給 Sonnet 5.5）

目標：把「誰會贏？」的對局介面、分析功能、引擎與難度分級，做到和五連黑白棋（five/）同一個水準與同一套操作習慣。規則本身不改。

這是大改版。請照階段做，每個階段結束都跑測試、在瀏覽器實際檢查，再進下一階段。

---

## 0. 現況地圖（動手前先讀）

**誰會贏？（要改的）**
- 頁面：`whowins/index.html`（728 行，內含 TAKU_TR 三語字典與 applyI18n）
- 程式：專案根目錄的 `src/`（歷史原因，不在 whowins/ 底下）
  - `src/app.js`（2019 行，主控）、`src/i18n.js`
  - `src/core/`：`rules.js`（規則：生子、吃子、PASS、終局填滿、結算）、`game-engine.js`、`constants.js`（AI_MODELS v1～v5、DEFAULT_KOMI 3.5、棋子外觀、主題）、`control-state.js`
  - `src/ai/`：`v1.js`～`v5.js`、`evaluator.js`、`ai-service.js`（v5 是 expectiminimax 深度 4，在主執行緒同步算）
  - `src/history/game-tree.js`、`src/ui/history-view.js`（已有分支，但介面與五連不同：branchPicker、branchModal）
  - `src/ui/coach-view.js`（候選步排行榜）、`dice-view.js`、`board-view.js`、`skin-workshop.js`、`sound.js`、`modal-manager.js`
- 規則學院：`tutorial.html`（根目錄）
- 測試：`tests/ai.test.js`、`control-state.test.js`、`features.test.js`、`history.test.js`、`rules.test.js`，另有 `tests/ai-tournament.js`、`v5-benchmark.js`
- 打包：`build.js` 會打包根目錄的 `styles/*.css` 與 `src/`

**五連黑白棋（照抄的範本，不要改它）**
- 頁面 `index.html`（根目錄），程式 `five/src/`，樣式 `five/styles/five.css`
- 勝率條 `five/src/ui/eval-bar.js`（含自我對戰校準的 `displayWinProb`）
- 勝率曲線 `five/src/ui/win-chart.js`（取代棋譜清單；點圖跳手、滑過顯示、分支紫線、走法評價彩點）
- 走法評價 `five/src/ai/move-quality.js`（!! ! !? ?! ? ??，含門檻與頻率校準方法）
- 對局樹 `five/src/history/game-tree.js`
- 引擎在 Worker：`five/src/ai/ai-client.js`、`ai-worker.js`、`ai-service.js`
- 分級 `five/src/ai/levels.js`（7 級，相鄰兩級實測勝率約 80%，數據寫在檔案註解）與校準腳本 `five/tests/level-ladder.js`
- `five/src/app.js` 值得對照的方法：`scheduleAnalysis`、`runAnalysis`、`storeAnalysis`、`updateMark`、`refreshMarksAround`、`renderEvalBar`、`chartData`、`goToStep`、`resumeHere`、`toggleHint`、`hintFromScores`、`startPonder`、`handleWatchCpuVsCpu`、`handlePauseCpu`、`exportRecord`、`setSeat`、`syncResearchMode`
- 計分卡上每一方的難度下拉（`settingBlackLevel`、`settingWhiteLevel`）

**三個遊戲共用（`shared/`）**
- `game-switcher.js`、`games.js`、`lang-select.js`、`i18n.js`（`takuLang`）、`tabs.js`、`ui.css`、`help.js` + `help-content.js` + `help-art.js`（規則視窗）
- 改 shared 只能「加」，不能弄壞五連與傑利蠑螈（district/）。

---

## 1. 範圍與限制

- **規則不能改**（生子、吃子、PASS 時對手免骰指定 1～6、雙方不可能再互吃時自動填滿結算、貼目 komi）。新引擎第一件事是做規則一致性測試，證明和舊 `src/core/rules.js` 完全相同。
- 不要動 `district/`、`five/` 的程式。
- 介面三語（中、英、日）全部要有，`tests/i18n.test.js` 的檢查要涵蓋新字典。
- 使用者看得到的文字不要用 emoji、不要用破折號（——、—）。
- 不要 commit、不要 push，除非使用者在對話裡要求。
- 不要下載任何東西（套件、資料檔），需要時先問使用者。
- 數據誠實回報：分級勝率量不到目標就照實寫，不要湊數字。

---

## 2. 階段一：搬家與整理（機械性）

1. 把 `src/` 搬到 `whowins/src/`，`styles/` 裡只有誰會贏用的 CSS 也一起搬到 `whowins/styles/`（搬之前確認五連與傑利蠑螈沒有引用）。
2. 更新所有引用：`whowins/index.html`、`tutorial.html`、`tests/*.js`、`build.js`、`README.md`、`package.json`。
3. 測試全過、瀏覽器打開 `whowins/index.html` 與 `tutorial.html` 都正常，才進下一階段。

---

## 3. 階段二：新引擎（取代 v1～v5）

放在 `whowins/src/engine/`（或 `ai/`，自行決定，但要一致）。

**3.1 快速規則核心**
- 8×8，用緊湊表示法（Uint8Array 64 格，或兩組 32 位元的位元板）做走法產生、落子、復原（make/unmake，不要每步複製整個棋盤）。
- 生子是「走滿 D 步、只能朝己方進攻方向、可轉彎、穿過友軍、敵棋阻斷、終點是空格」；吃子是直線走滿 D 步、中途不能有敵棋、終點恰為敵棋。細節以 `src/core/rules.js` 為準。
- **規則一致性測試**：隨機產生上萬個局面（含 PASS、終局），新核心與舊 `rules.js` 的合法步集合、落子結果、`canCaptureEver`、填滿與結算結果要完全一樣。這個測試要留在 repo 裡。

**3.2 搜尋**
- 這是有機率節點的遊戲：每回合先擲骰（6 種點數各 1/6）再走。用 expectimax，機率節點加 Star1/Star2 剪枝（Ballard 的 *-minimax），加迭代加深、時間上限、Zobrist 置換表、走法排序（吃子優先、歷史啟發）。
- PASS 的特殊規則：沒步可走時對手免骰自選 1～6，所以那一層是對手的 max 節點，不是機率節點。
- **終盤精確**：`canCaptureEver` 為否時結果已確定，直接算填滿結算，回傳精確值。
- 輸出：期望分差（含 komi）與勝率；對每個點數（1～6）分別回傳最佳步與分數，給介面的「骰子展望」用。

**3.3 評估函數**
- 先做手寫特徵（棋子數、可到達領域、被吃風險、前線推進、行動力等，可參考舊 `evaluator.js`），再用自我對戰資料訓練線性權重（迴歸到終局分差），流程照五連的 `gen-selfplay.js` → `train-eval.js` 的精神，腳本放 `whowins/tests/`（或 `tests/whowins/`）。
- 新引擎要明顯贏過舊 v5：同骰子序列、交換先後手成對對戰，至少 200 局，報告勝率。

**3.4 Worker**
- 照五連 `ai-client.js` / `ai-worker.js`：搜尋在 Web Worker，不支援時退回同步；可取消（新請求取消舊請求）；UI 永遠不卡。

---

## 4. 階段三：難度分級（重做）

- 照五連 `levels.js` 的做法：最高級是完整新引擎、吃滿思考時間；下面幾級用固定深度、終盤精確開關、隨機失誤率（eps）削弱；第 1 級接近隨機或只會貪心。
- 校準腳本 `level-ladder.js`：相鄰兩級成對對戰（**同一串骰子、交換黑白**，用共同隨機數降低運氣雜訊），目標上一級贏約 80%（±5%）。
- 骰子遊戲運氣成分大，強的幾級之間可能到不了 80%。到不了就減少級數，不要硬湊；實測數字寫在 `levels.js` 註解，格式同五連。
- 計分卡上每一方有難度下拉（同五連），設定頁不再放演算法選單。
- 舊存檔裡的 v1～v5 設定要遷移到新等級（寫對照表與測試）。

---

## 5. 階段四：介面對齊五連

逐項對照五連的實作與外觀：

1. **勝率條**：棋盤旁（桌面）或上方（手機），黑在下白在上；手機版方向照五連目前的做法（白左黑右）。勝率用自我對戰校準（同 `eval-bar.js` 的 `displayWinProb` 思路，依剩餘回合或棋盤狀態分段擬合），校準資料與方法寫在註解。
2. **勝率曲線**：取代現在的棋譜清單，直接重用或複製 `five/src/ui/win-chart.js` 的行為：點圖跳到那一手、滑過顯示那一手的棋譜與勝率、分支畫紫線、走法評價畫彩點。
3. **歷史與分岔**：改成五連那套（對局樹、上一手／下一手、← →、從這裡接手 `resumeHere`、研究模式），拿掉 branchPicker 與 branchModal 的舊介面，功能不能少（能回到任何分支）。
4. **背景分析**：每個局面在 Worker 裡用教練強度分析並快取在節點上（同 `scheduleAnalysis`／`storeAnalysis`），曲線與評價逐步補上。
5. **走法評價（!! ! !? ?! ? ??）**：比較對象是「同一個點數下」的最佳步，骰子好壞不算進評價。門檻參考 `move-quality.js`，再用 CPU 互下統計頻率，調到和五連差不多（每 100 步 ?? 約 0.7、! 約 1.2 這個量級），方法與數據寫在註解。
6. **提示（H）**：在棋盤上顯示每個合法目的地走下去的勝率，最佳步標出；取代現在的候選步排行榜（`coach-view.js`）或縮成和五連一樣精簡的樣子。
7. **CPU 對 CPU 觀戰、暫停／繼續（空白鍵）、思考時間與動畫速度設定**：同五連。
8. **匯出棋譜**：同五連的 `exportRecord`，格式要包含每一手的骰子點數；最好也能匯入（貼上棋譜重建對局樹）。
9. **設定視窗**：用 `shared/tabs.js` 的分頁，結構與五連一致（對局、外觀、聲音等）；保留誰會贏現有的棋子外觀、路徑顏色、主題、貼目設定。
10. **規則視窗**：`shared/help-content.js` 裡 whowins 的操作鍵說明更新成新快捷鍵。

---

## 6. 階段五：適合骰子遊戲的新機制（我建議加的）

1. **骰運與棋力分開算**：每一手把勝率變化拆成兩部分。骰運 = 擲出的點數讓勝率比「六種點數平均」高或低多少；棋力損失 = 這個點數下最佳步與實際走法的差。曲線的提示框兩個都顯示，終局總結顯示雙方累計骰運與平均棋力損失（準確度百分比）。這是骰子遊戲最常被問的「我是輸在運氣還是輸在下法」。
2. **骰子展望**：輪到某一方擲骰前，在骰子旁顯示 6 個小長條，各是擲出 1～6 時（走最佳步）的勝率，讓玩家看到這一擲的風險。
3. **研究模式指定點數**：在歷史中開分支時，可以自己指定這一手的骰子點數（「如果當時擲出 6 呢？」），不必重擲。正式對局時不能指定。
4. **可重現的骰子**：每局有種子，匯出棋譜時記錄，重播與分支時骰子一致。
5. **終局總結**：勝負、分差、雙方準確度、骰運、評價次數（!! ? ?? 各幾次），可一鍵跳到每個 ?? 或 !!。

做完前四階段再做這一階段；若時間不夠，先做 1、2、3。

---

## 7. 驗收

- `npm test`（`node --test tests/*.test.js`）與 `node --test district/tests/*.test.js`、五連的測試全部通過；新增的測試至少涵蓋：規則一致性、引擎終盤精確、Worker 取消、等級遷移、對局樹與分支、棋譜匯出匯入、i18n 字典一致。
- 瀏覽器實測（`.claude/launch.json` 的 `dice-othello`，port 8000；或已在跑的 8001）：桌面與手機寬度（375px，不能有橫向捲動）、三種語言、CPU 對 CPU 一整局、分支來回、提示、匯出匯入、主控台沒有錯誤。
- 效能：預設思考時間下 CPU 每步不超過設定時間；分析期間介面可以正常點擊。
- 回報時附上：新引擎對舊 v5 的勝率、各級相鄰勝率、走法評價頻率、勝率條校準方法。沒達標的項目照實寫。
