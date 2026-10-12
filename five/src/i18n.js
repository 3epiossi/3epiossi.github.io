/**
 * 🌐 五連黑白棋 - 多語系（中文 / English / 日本語）
 *
 * - tr(key, params)  依目前語言取字，{name} 占位符會被 params 取代，{bn}/{wn} 是雙方的自訂名稱
 * - msg(key, params) 建立結構化訊息，存進對局樹後切換語言也能重新翻譯；tx() 負責解開
 * - applyI18n()      翻譯 HTML 裡帶 data-i18n / data-i18n-title 的靜態文字
 *
 * 找不到的鍵會退回原專案的字典（外觀預設名稱 p_* 等共用字串）。
 */

import { tr as baseTr } from "../../src/i18n.js";
import { discLabel, letterOf } from "./core/five-rules.js";

const D = {
  zh: {
    btnRules: "說明", btnSettingsTop: "設定", actNew: "新局", actWatch: "▶ CPU 對下", tipFirst: "回到第一手", tipPrev: "上一手（←）", tipNext: "下一手（→）", tipLatest: "最新一手", tipWatch: "讓雙方都由 CPU 下", roleHuman: "我 ▾", roleCpu: "CPU {n} 級 ▾", roleResearch: "研究中", roleLockedReview: "正在看以前的棋步，不能切換。按「從這裡繼續下」或回到最新一手再改。", roleLockedResearch: "研究分支中雙方都是自己下，回到主線再改。", roleTip: "點一下切換「我／CPU」與 CPU 難度",
    lvl0: "敗定", lvl1: "劣勢", lvl2: "拉鋸", lvl3: "優勢", lvl4: "勝定", whyMissedFive: "錯過直接連成五（{at}）", whyAllowsFive: "讓對手下一手可以直接連成五（最佳：{at}）", whyGivesCorner: "讓對手可以佔角（最佳：{at}）", whyDrop: "局勢從{from}變成{to}（最佳：{at}）", whyLoose: "{lvl}裡讓掉 {n}%（最佳：{at}）", whyOnly: "唯一能拿到{to}的一步（其他格子最多{from}）", whyTurnaround: "反殺：局勢從{from}翻成{to}，其他格子都差 {n}% 以上", whyForce: "強迫手：對手只剩 {at} 一個好選擇，其他格子都差 {n}% 以上", whyOnlyFour: "做出四，唯一能拿到{to}的一步（其他格子最多{from}）",
    btnExport: "匯出棋譜", tipExport: "把目前這條線的棋譜存成 JSON 檔（含每一手的局面、走法評價與勝率）",
    v6TimeNote: "越長越準，但要等比較久。6、7 級 CPU 每步想這麼久；勝率條至少分析這麼久；AI 教練（提示）和走法評價的確認用兩倍時間，所以跟 7 級 CPU 一樣強。1～5 級 CPU 不受影響。",
   
        helpTitle: "說明", helpTabRules: "規則", helpTabGuide: "使用說明",
    btnResume: "從這裡繼續下", resumeTip: "把這一步變成最新一步，接著正常下棋（之後的棋譜會刪掉）", resumeTitle: "從這一步繼續下？", resumeMsg: "第 {n} 手之後的棋譜（包括分支）會刪掉，從這一步接著正常下棋。", resumeOk: "從這裡繼續",
    pageTitle: "五連黑白棋", brandName: "五連黑白棋",
    modePlay: "🎮 對局模式", modeRules: "📜 規則說明",
    btnDice: "另一個遊戲：誰會贏？", titleDice: "切換到「誰會贏？」骰子黑白棋",
    btnTheme: "🎨 主題與外觀", titleTheme: "切換棋盤主題風格與客製棋子外觀",
    seatWhite: "⚪ 白方", seatBlack: "⚫ 黑方", seatHuman: "我", seatCpu: "CPU", btnSettings: "⚙️ 設定", titleSettings: "進階對弈設定",
    btnTwoPlayer: "👥 雙人對戰", titleTwoPlayer: "黑白雙方都由人類操作", btnWatch: "👁 CPU 對戰", btnPause: "⏸ 暫停",
    historyTitle: "勝率走勢", branchLabel: "主線", btnRestart: "🔄 重設", titleRestart: "重新開局",
    historyFirst: "⏮ 首步", historyPrev: "◀ 上手", historyNext: "▶ 下手", historyLatest: "⏭ 最新",
    historyTip: "點圖上任一手可回到當時的局面；在歷史局面直接下棋會岔出一條分支。勝率只是參考，走法評價只評你的選擇。",
    coachBarTitle: "🧠 AI 提示", btnHint: "💡 提示",
    settingsTitle: "⚙️ 對弈進階設定",
    settingsHint: "💡 每一方可選「我」或 CPU；是 CPU 的那一方，旁邊的選單設定它的難度。",
    settingsDone: "完成設定",
    evalTitle: "勝率　黑方 {b}%　白方 {w}%", markBrilliant: "反殺", markGood: "唯一手", markInteresting: "強迫手", markDubious: "不精確", markMistake: "失誤", markBlunder: "大失誤",
    levelLabel: "CPU 難度（只對 CPU 有效）", level1: "1 級：只顧五連", level2: "2 級", level3: "3 級", level4: "4 級", level5: "5 級", level6: "6 級（滿力 v13）", level7: "7 級：最強（滿力 v14）",
    levelHint: "每高一級，大約十場能贏下一級八場。1 級只會抓眼前的五連，6 級是完整的 v13，7 級是黑白棋更強的 v14（6、7 級的思考時間見下方）。AI 教練不受難度影響，永遠給最強建議。",
    v6TimeLabel: "AI 思考時間", stPickManual: "還沒選組別（點格子可以逐組試）", stHumanTap: "👤 你 · {turn} · {pick}", stPickHint: "開著提示：點格子就下那格勝率最高的組別（也可以先選一組）", stPickHintHover: "這格勝率最高的是 {disc}，點一下就下", stTapPick: "這格試 {disc}：再點一下換下一組，長按就下這組，點別處取消", poolPickPrompt: "選一組，或直接點格子", pickerAria: "選要下在 {c} 的棋", openingStdNote: "標準：從中間四顆開始。", openingLabel: "開局", openingStandard: "標準", openingXot: "XOT 隨機開局", openingNote: "XOT：系統隨機替雙方下好前 6～10 手，而且雙方勝率都在 50% ± 5% 以內。背不了定石，從第一手就要靠計算和大局觀。", xotLog: "（XOT 開局）", paceLabel: "下棋節奏", paceSlow: "慢", paceNormal: "正常（預設）", paceFast: "快", paceInstant: "極速（不播動畫和落子音效）", paceNote: "CPU 落子的快慢，只影響看起來的速度，不影響棋力和分析。", time500: "0.5 秒（預設）", time1000: "1 秒", time2000: "2 秒", time4000: "4 秒",
    tutorialModalTitle: "60 秒掌握五連黑白棋！", tutorialOk: "我懂了，開始下棋！",
    rule2Title: "規則一：4 組棋，自己選組別", rule2Text: "64 顆棋分成 4 組（棋上的字就是組別），每組 16 顆，雙方共用。輪到你時，選一組還有剩的棋、下在合法位置（與黑白棋相同，必須夾住對手的棋）。開局中間四顆每組各一顆。沒有合法位置就 PASS。",
    confirmTitle: "請確認操作", confirmMsg: "您確定要執行這項操作嗎？", confirmCancel: "取消", confirmOk: "確認",
    branchModalTitle: "對局樹", branchClose: "關閉",
    skinTitle: "設定", skinSoundLabel: "🔊 遊戲音效",
    nameLabel: "🏷️ 自訂雙方名稱（左：黑方　右：白方，留空用預設）：",
    skinThemeSection: "🏞️ 棋盤場景風格主題",
    themeNeon: "霓虹深邃 (預設)", themeClassic: "經典翡翠", themeWood: "雅緻木紋", themeSlate: "玄武極簡",
    skinCustomHint: "替黑棋與白棋挑選寶石顏色，以及棋上文字的顏色。",
    skinBlackTitle: "⚫ 黑方棋子外觀", skinWhiteTitle: "⚪ 白方棋子外觀", skinPreviewLabel: "棋盤實際外觀預覽",
    skinTextColorSection: "🔤 棋子文字顏色", skinGemSection: "💎 寶石預設風格",
    skinReset: "🔄 還原預設外觀", skinDone: "完成設定",
    ariaClose: "關閉", ariaModes: "遊戲模式", ariaBoard: "8x8 五連黑白棋盤", ariaWhiteSeat: "白方由誰操作", ariaBlackSeat: "黑方由誰操作",
    poolCpuPick: "CPU 選了 {disc}", coachWinrate: "勝率 {p}%", btnHintOn: "💡 提示：開", hintHelp: "打開後，棋盤上每個可下的格子會標出 4 組裡最高的勝率；滑鼠移到格子上，可看到要下哪一組，以及每一組下在那格的勝率。", cellHint: "{c} 可落子，勝率 {p}%", chartAria: "勝率折線圖（白方在上、黑方在下）", chartTipBlack: "黑方勝率 {p}", stResearch: "🔬 分支研究（第 {n} 手起）· 輪到 {turn} · {pick}；退回第 {n} 手就結束研究", stHumanPick: "👤 你 · {turn} · {pick}，請點選格子落子（★5 = 直接連成五）", stPickDisc: "已選 {disc}（再點一次同一組就取消）", symbolSection: "🔣 棋子文字", symbolHint: "預設用撲克牌的四個花色 ♠ ♥ ♦ ♣（4 組各一個），也可以換成希臘字母 α β γ δ，或自訂 4 個字（中文、英文、希臘文、日文都行），每個字要不一樣。", chartTipBoth: "白方 {w} · 黑方 {b}", symGreek: "希臘字母", symSuits: "撲克花色", symCustom: "自訂", symCustomApply: "套用", symCustomPlaceholder: "輸入 4 個不同的字，例如：春夏秋冬", symCustomCount: "需要剛好 4 個字，現在是 {n} 個（空白不算）", symCustomDupe: "「{ch}」重複了，4 個字要都不一樣", symCustomReady: "4 個字都不一樣，按「套用」或 Enter 就會換上", symCustomOk: "已換成：{chars}", poolSelected: "已選 {disc}", poolWaiting: "等待對手選組別", poolGroupUsed: "{disc} 組已經用完", poolDisc: "{disc} 組（剩 {n} 顆）", poolDiscFive: "{disc} 組（剩 {n} 顆，能直接連成五）", exFiveDangerSure: "⚠️ 下完後，對手能用池子裡的 {disc} 直接連成五",
    handLabel: "選組別", handNone: "—", handBag: "共剩 {n} 顆",  handEnded: "終局",
    // 動態
    cellEmpty: "{c} 空格",  cellLegal: "{c} 可落子，翻 {n} 顆",
    black: "黑方", white: "白方",
    sideBlack: "⚫ {bn}", sideWhite: "⚪ {wn}",
    logRoot: "開局初始局面 (#0)", logMove: "#{idx} {side} 下在 {to}（{disc}）：翻 {n} 顆{five}", logPass: "{side} 無合法位置，PASS！輪到 {enemy}",
    branchMain: "主線", branchFrom: "第 {n} 手起", branchFromDup: "第 {n} 手起 ({dup})", branchDefault: "🌿 分支 #{n}",
    reasonFull: "棋盤已填滿", reasonNoMoves: "雙方都沒有合法位置", reasonDefault: "終局結算",
    stReview: "🕘 檢視第 #{n} 手；直接下棋會從這裡岔出分支", stEnded: "🏁 對局已結束 · {reason}",
    stPaused: "⏸ 已暫停 · {turn} · 按 [▶ 繼續] 讓 CPU 相互對戰", stPausedOne: "⏸ 已暫停 · {turn} · 按 [▶ 繼續] 讓 CPU 走",
    stCpuVsCpu: "👁 CPU 對戰中", stCpu: "🤖 CPU",
    stCpuThinking: "{actor} · {turn} · 抽到 {w} 分的棋，思考落子中…",
    stPassing: "{turn} 沒有合法位置，PASS…",
    startFromHere: "🌿 從這裡開始下", startFromHereTip: "以此盤面為起點開始下棋", restart: "🔄 再來一局", restartTip: "重新開局",
    vsCpu: "🤖 {name}變成 CPU", pause: "⏸ 暫停", pauseTip: "暫停 CPU [空白鍵]", resume: "▶ 繼續", resumeTip: "繼續讓 CPU 下 [空白鍵]",
    restartTitle: "重新開始新局？", restartMsg: "目前的棋局進度將重置，重新開始一局。", restartOk: "重新開局",
    renameTip: "點一下可自訂名稱", renamePrompt: "輸入自訂名稱（留空則恢復預設）：",
    noHistory: "尚無棋譜", manageTree: "🌳 管理對局樹…",
    // 教練
    coachEmptyEnded: "對局已結束，點擊歷史棋譜可回顧任一手。", coachEmptyNoMove: "此局面當前無任何合法位置（須 PASS）。",
    coachEmptyDefault: "點擊「💡 提示」按鈕，將為您即時分析目前局面的最佳落子位置。",
    coachThinking: "提示分析中，請稍候...", coachThinkingSub: "正在遍歷候選位置與預期搜尋樹",
    coachTitle: "💡 提示分析", coachTop: "評估首選", applyThis: "採用此步", coachOthers: "🥈 其他候選位置排行榜",
    preview: "👁 預覽", apply: "採用", rank1: "👑 首選", rank2: "🥈 次選", rank3: "🥉 備選",
    // 慶祝 / 其他
    stCpuThinkingFive: "{actor} · {turn} · 選組別，思考落子中…",
    reasonFive: "{side} 完成 {v} 五連，直接獲勝！", fxFive: "五連 {v}！",
    exFiveWin: "🏆 直接完成五連 {v}，獲勝！",  
    exFiveForced: "引擎判斷：這步之後必勝", exFiveLost: "引擎判斷：怎麼下都難逃落敗", exFiveWinrate: "引擎估計勝率約 {p}%",
    exFiveDanger: "下完後，補進池子的棋如果合適，對手就能直接連成五",
    legendFiveNote: "前兩顆都是 {x}（同一組，顏色不同沒關係，翻面只換顏色）；{y} 是另一組。同色、同一組的五顆連成一線就是五連。",
    logFive: "　🏆 {v} 五連！",
    cellDiscFivePlain: "{c} {side} {disc}",
    exFivePlainGain: "落下 {disc}，翻 {n} 顆",
    exSummaryFivePlain: "{disc} 落在 {coord} 後，棋子數 {mine} 比 {theirs}",
    rule6Title: "規則二：同一組連成五直接獲勝", rule6Text: "每顆棋只有一個字，就是它的組別（兩面相同，翻面只換顏色）。同一直線（橫、直、斜）上連續 5 顆己方、同一組的棋就直接獲勝，翻面造成的也算。整局沒人連成五就比棋子數（每顆 1 分，雙方合計 64 分）。",
    p_placeholder: ""
  },
  en: {
    btnRules: "Help", btnSettingsTop: "Settings", actNew: "New game", actWatch: "▶ CPU vs CPU", tipFirst: "First move", tipPrev: "Previous move (←)", tipNext: "Next move (→)", tipLatest: "Latest move", tipWatch: "Let the CPU play both sides", roleHuman: "Me ▾", roleCpu: "CPU Lv {n} ▾", roleResearch: "Studying", roleLockedReview: "You are viewing an earlier move, so this can't be changed. Press \"Continue from here\" or go to the latest move first.", roleLockedResearch: "While studying a branch you play both sides. Return to the game to change this.", roleTip: "Click to switch between Me and CPU, and set the CPU level",
    lvl0: "lost", lvl1: "behind", lvl2: "balanced", lvl3: "ahead", lvl4: "won", whyMissedFive: "Missed an immediate five ({at})", whyAllowsFive: "Lets the opponent make five next move (best: {at})", whyGivesCorner: "Gives the opponent a corner (best: {at})", whyDrop: "Position went from {from} to {to} (best: {at})", whyLoose: "Gave away {n}% while {lvl} (best: {at})", whyOnly: "The only move that keeps you {to} (others: {from} at best)", whyTurnaround: "Turnaround: {from} → {to}; every other square is at least {n}% worse", whyForce: "Forcing move: the opponent's only good reply is {at}; everything else is at least {n}% worse", whyOnlyFour: "Makes a four, the only move that keeps you {to} (others: {from} at best)",
    btnExport: "Export record", tipExport: "Save the current line as a JSON file (each position, move marks and win chances)",
    v6TimeNote: "Longer is more accurate but slower. The Level 6 and 7 CPUs think this long per move; the win bar analyses at least this long; the AI coach (hints) and move-mark checks use twice as long, so they match the Level 7 CPU. Levels 1–5 are not affected.",
   
        helpTitle: "Help", helpTabRules: "Rules", helpTabGuide: "How to use",
    btnResume: "Continue from here", resumeTip: "Make this the latest move and carry on playing normally (later moves are deleted)", resumeTitle: "Continue from this move?", resumeMsg: "Everything after move {n} (including branches) is deleted, and the game carries on normally from here.", resumeOk: "Continue from here",
    pageTitle: "Flush Othello", brandName: "Flush Othello",
    modePlay: "🎮 Play", modeRules: "📜 Rules",
    btnDice: "Another game: Who will win?", titleDice: "Switch to “Who will win?” dice Othello",
    btnTheme: "🎨 Theme & Skin", titleTheme: "Board theme and custom piece look",
    seatWhite: "⚪ White", seatBlack: "⚫ Black", seatHuman: "Me", seatCpu: "CPU", btnSettings: "⚙️ Settings", titleSettings: "Advanced game settings",
    btnTwoPlayer: "👥 Two players", titleTwoPlayer: "Both sides played by humans", btnWatch: "👁 CPU vs CPU", btnPause: "⏸ Pause",
    historyTitle: "Win chance", branchLabel: "Main line", btnRestart: "🔄 Reset", titleRestart: "Start a new game",
    historyFirst: "⏮ First", historyPrev: "◀ Prev", historyNext: "▶ Next", historyLatest: "⏭ Latest",
    historyTip: "Click any move on the chart to go back to it; playing a move from a past position branches off a new line. Win chances are only a guide; move marks judge your choices.",
    coachBarTitle: "🧠 AI hints", btnHint: "💡 Hints",
    settingsTitle: "⚙️ Game settings",
    settingsHint: "💡 Choose You or CPU for each side; for a CPU side, the menu next to it sets its level.",
    settingsDone: "Done",
    evalTitle: "Win chance  Black {b}%  White {w}%", markBrilliant: "Turnaround", markGood: "Only move", markInteresting: "Forcing move", markDubious: "Inaccuracy", markMistake: "Mistake", markBlunder: "Blunder",
    levelLabel: "CPU level (applies when this side is the CPU)", level1: "Level 1: five-only", level2: "Level 2", level3: "Level 3", level4: "Level 4", level5: "Level 5", level6: "Level 6 (full v13)", level7: "Level 7: strongest (full v14)",
    levelHint: "Each level up wins about 8 of 10 games against the one below. Level 1 only grabs an immediate five; Level 6 is the full v13 and Level 7 is v14, which plays much stronger Othello (thinking time for 6 and 7 below). The AI coach is unaffected and always gives the best advice.",
    v6TimeLabel: "AI thinking time", stPickManual: "no group chosen yet (click a square to try the groups one by one)", stHumanTap: "👤 You · {turn} · {pick}", stPickHint: "hints on: click a square to play its best group (or pick a group first)", stPickHintHover: "best group here is {disc}; click to play it", stTapPick: "trying {disc} here: click again for the next group, press and hold to play it, click elsewhere to cancel", poolPickPrompt: "Pick a group, or click a square", pickerAria: "Choose the disc to play on {c}", openingStdNote: "Standard: start from the four centre discs.", openingLabel: "Opening", openingStandard: "Standard", openingXot: "XOT random opening", openingNote: "XOT: 6–10 random moves are already played for both sides, chosen so that both sides' win chances are within 50% ± 5%. No memorised openings — you calculate from the first move.", xotLog: " (XOT opening)", paceLabel: "Game pace", paceSlow: "Slow", paceNormal: "Normal (default)", paceFast: "Fast", paceInstant: "Instant (no animation or stone sounds)", paceNote: "How quickly the CPU plays its moves. Only changes how fast it looks, not strength or analysis.", time500: "0.5 s (default)", time1000: "1 s", time2000: "2 s", time4000: "4 s",
    tutorialModalTitle: "Learn Flush Othello in 60 seconds!", tutorialOk: "Got it, let's play!",
    rule2Title: "Rule 1: four groups — choose your own", rule2Text: "The 64 discs form 4 groups of 16 (the symbol on a disc is its group), shared by both players. On your turn choose any group that still has discs and play it on a legal square (as in Othello you must outflank the opponent). The four starting discs are one from each group. With no legal square you pass.",
    confirmTitle: "Please confirm", confirmMsg: "Are you sure you want to do this?", confirmCancel: "Cancel", confirmOk: "Confirm",
    branchModalTitle: "Game tree", branchClose: "Close",
    skinTitle: "Settings", skinSoundLabel: "🔊 Game sounds",
    nameLabel: "🏷️ Custom names (left: Black, right: White; blank = default):",
    skinThemeSection: "🏞️ Board theme",
    themeNeon: "Neon Deep (default)", themeClassic: "Classic Jade", themeWood: "Elegant Wood", themeSlate: "Minimal Slate",
    skinCustomHint: "Pick a gem color for the black and white pieces, and a color for the symbols on them.",
    skinBlackTitle: "⚫ Black piece look", skinWhiteTitle: "⚪ White piece look", skinPreviewLabel: "Live board preview",
    skinTextColorSection: "🔤 Symbol color", skinGemSection: "💎 Gem presets",
    skinReset: "🔄 Restore defaults", skinDone: "Done",
    ariaClose: "Close", ariaModes: "Game mode", ariaBoard: "8x8 Flush Othello board", ariaWhiteSeat: "Who plays White", ariaBlackSeat: "Who plays Black",
    poolCpuPick: "CPU picks {disc}", coachWinrate: "Win {p}%", btnHintOn: "💡 Hints: on", hintHelp: "When on, every playable square shows the best win chance among the four groups; hover a square to see which group that is and each group's win chance there.", cellHint: "{c} playable, win chance {p}%", chartAria: "Win chance by move (White above, Black below)", chartTipBlack: "Black win chance {p}", stResearch: "🔬 Branch study (from move {n}) · {turn} to move · {pick}; go back to move {n} to end the study", stHumanPick: "👤 You · {turn} · {pick}; click a square (★5 = makes five)", stPickDisc: "{disc} chosen (click it again to cancel)", symbolSection: "🔣 Disc symbols", symbolHint: "Card suits ♠ ♥ ♦ ♣ by default (one per group). You can switch to Greek letters α β γ δ, or use any 4 characters of your own (Chinese, English, Greek, Japanese…), all different.", chartTipBoth: "White {w} · Black {b}", symGreek: "Greek letters", symSuits: "Card suits", symCustom: "Custom", symCustomApply: "Apply", symCustomPlaceholder: "Type 4 different characters, e.g. 春夏秋冬", symCustomCount: "Exactly 4 characters needed — you have {n} (spaces don't count)", symCustomDupe: "“{ch}” appears twice — all 4 must be different", symCustomReady: "All 4 are different — press Apply or Enter", symCustomOk: "Now using: {chars}", poolSelected: "{disc} selected", poolWaiting: "Waiting for the opponent to choose", poolGroupUsed: "Group {disc} is used up", poolDisc: "Group {disc} ({n} left)", poolDiscFive: "Group {disc} ({n} left, makes five now)", exFiveDangerSure: "⚠️ Afterwards the opponent can make five with {disc} from the pool",
    handLabel: "Groups", handNone: "—", handBag: "{n} discs left",  handEnded: "Game over",
    cellEmpty: "{c} empty",  cellLegal: "{c} playable, flips {n}",
    black: "Black", white: "White",
    sideBlack: "⚫ {bn}", sideWhite: "⚪ {wn}",
    logRoot: "Starting position (#0)", logMove: "#{idx} {side} plays {to} ({disc}): flips {n}{five}", logPass: "{side} has no legal square and passes! {enemy} is up",
    branchMain: "Main line", branchFrom: "From move {n}", branchFromDup: "From move {n} ({dup})", branchDefault: "🌿 Branch #{n}",
    reasonFull: "The board is full", reasonNoMoves: "Neither side has a legal square", reasonDefault: "Final result",
    stReview: "🕘 Viewing move #{n}; playing here branches off a new line", stEnded: "🏁 Game over · {reason}",
    stPaused: "⏸ Paused · {turn} · press [▶ Resume] to let the CPUs play", stPausedOne: "⏸ Paused · {turn} · press [▶ Resume] to let the CPU move",
    stCpuVsCpu: "👁 CPU vs CPU", stCpu: "🤖 CPU",
    stCpuThinking: "{actor} · {turn} · drew a {w}-point disc, thinking…",
    stPassing: "{turn} has no legal square, passing…",
    startFromHere: "🌿 Play from here", startFromHereTip: "Start playing from this position", restart: "🔄 Play again", restartTip: "New game",
    vsCpu: "🤖 {name} becomes CPU", pause: "⏸ Pause", pauseTip: "Pause the CPU [Space]", resume: "▶ Resume", resumeTip: "Let the CPU play [Space]",
    restartTitle: "Start a new game?", restartMsg: "The current game is reset and a new one starts.", restartOk: "New game",
    renameTip: "Click to rename", renamePrompt: "Enter a custom name (blank restores the default):",
    noHistory: "No moves yet", manageTree: "🌳 Manage game tree…",
    coachEmptyEnded: "The game is over. Click a move in the record to review it.", coachEmptyNoMove: "No legal square in this position (must pass).",
    coachEmptyDefault: "Press “💡 Hint” to analyze the best squares for this position.",
    coachThinking: "Analyzing…", coachThinkingSub: "Walking through candidate squares and the expectation tree",
    coachTitle: "💡 Hint analysis", coachTop: "Top pick", applyThis: "Play this", coachOthers: "🥈 Other candidates",
    preview: "👁 Preview", apply: "Play", rank1: "👑 Best", rank2: "🥈 2nd", rank3: "🥉 3rd",
    stCpuThinkingFive: "{actor} · {turn} · choosing a group, thinking…",
    reasonFive: "{side} made five {v}s and wins!", fxFive: "Five {v}s!",
    exFiveWin: "🏆 Makes five {v}s: instant win!",  
    exFiveForced: "Engine: a forced win after this move", exFiveLost: "Engine: every move loses", exFiveWinrate: "Engine estimates about {p}% to win",
    exFiveDanger: "Afterwards the opponent can make five if the refill disc fits",
    legendFiveNote: "The first two are both {x} (same group — the color doesn't matter, flipping only changes it); {y} is another group. Five of your discs of one group in a line make five.",
    logFive: "  🏆 Five {v}s!",
    cellDiscFivePlain: "{c} {side} {disc}",
    exFivePlainGain: "Places {disc}, flips {n}",
    exSummaryFivePlain: "{disc} on {coord}: discs {mine} vs {theirs}",
    rule6Title: "Rule 2: five of one group in a row wins instantly", rule6Text: "Each disc carries one symbol: its group (same on both sides; flipping only changes the color). Five of your discs of the same group in a straight line (row, column or diagonal) win instantly — flips count too. If nobody makes five, compare disc counts (1 point each, 64 in total).",
    p_placeholder: ""
  },
  ja: {
    btnRules: "説明", btnSettingsTop: "設定", actNew: "新規対局", actWatch: "▶ CPU 同士", tipFirst: "最初の手へ", tipPrev: "1手戻る（←）", tipNext: "1手進む（→）", tipLatest: "最新の手へ", tipWatch: "両方を CPU に打たせる", roleHuman: "自分 ▾", roleCpu: "CPU {n} 級 ▾", roleResearch: "研究中", roleLockedReview: "過去の手を見ているので切り替えられません。「ここから続ける」を押すか、最新の手に戻ってから変更してください。", roleLockedResearch: "分岐の研究中は両方とも自分で打ちます。対局に戻ってから変更してください。", roleTip: "クリックで「自分／CPU」と CPU の強さを切り替え",
    lvl0: "負け確定", lvl1: "劣勢", lvl2: "互角", lvl3: "優勢", lvl4: "勝ち確定", whyMissedFive: "直接五連を逃した（{at}）", whyAllowsFive: "相手に次の手で五連を許す（最善：{at}）", whyGivesCorner: "相手に隅を取らせる（最善：{at}）", whyDrop: "形勢が{from}から{to}に（最善：{at}）", whyLoose: "{lvl}のまま {n}% 損した（最善：{at}）", whyOnly: "{to}を保てる唯一の手（他の手は最高でも{from}）", whyTurnaround: "逆転：形勢が{from}から{to}に（他のマスは {n}% 以上悪い）", whyForce: "強制手：相手の良い応手は {at} だけ（他は {n}% 以上悪い）", whyOnlyFour: "四を作る、{to}を保てる唯一の手（他の手は最高でも{from}）",
    btnExport: "棋譜を書き出す", tipExport: "今の手順を JSON ファイルに保存（各局面・評価記号・勝率を含む）",
    v6TimeNote: "長いほど正確ですが、待ち時間も長くなります。レベル6・7の CPU は1手にこの時間考え、勝率バーは少なくともこの時間分析します。AI コーチ（ヒント）と評価記号の確認は 2 倍の時間を使うので、レベル7の CPU と同じ強さです。レベル1～5には影響しません。",
   
        helpTitle: "説明", helpTabRules: "ルール", helpTabGuide: "使い方",
    btnResume: "ここから続ける", resumeTip: "この手を最新の手にして通常の対局を続けます（以降の棋譜は削除）", resumeTitle: "この手から続けますか？", resumeMsg: "{n} 手目より後の棋譜（分岐を含む）は削除され、ここから通常の対局を続けます。", resumeOk: "ここから続ける",
    pageTitle: "五連オセロ", brandName: "五連オセロ",
    modePlay: "🎮 対局", modeRules: "📜 ルール",
    btnDice: "別のゲーム：誰が勝つ？", titleDice: "「誰が勝つ？」サイコロオセロに切り替え",
    btnTheme: "🎨 テーマと外観", titleTheme: "盤テーマと石の外観を変更",
    seatWhite: "⚪ 白番", seatBlack: "⚫ 黒番", seatHuman: "自分", seatCpu: "CPU", btnSettings: "⚙️ 設定", titleSettings: "詳細設定",
    btnTwoPlayer: "👥 二人対戦", titleTwoPlayer: "黒白とも人間が操作", btnWatch: "👁 CPU対戦", btnPause: "⏸ 一時停止",
    historyTitle: "勝率の推移", branchLabel: "本線", btnRestart: "🔄 リセット", titleRestart: "新しい対局",
    historyFirst: "⏮ 最初", historyPrev: "◀ 前へ", historyNext: "▶ 次へ", historyLatest: "⏭ 最新",
    historyTip: "グラフの任意の手をクリックするとその局面に戻れます。過去の局面から打つと分岐します。勝率は目安で、評価記号はあなたの選択だけを評価します。",
    coachBarTitle: "🧠 AI ヒント", btnHint: "💡 ヒント",
    settingsTitle: "⚙️ 対局の詳細設定",
    settingsHint: "💡 それぞれ「自分」か CPU を選べます。CPU の側は横のメニューで強さを設定します。",
    settingsDone: "完了",
    evalTitle: "勝率　黒 {b}%　白 {w}%", markBrilliant: "逆転の一手", markGood: "唯一手", markInteresting: "強制手", markDubious: "緩手", markMistake: "悪手", markBlunder: "大悪手",
    levelLabel: "CPU の強さ（CPU のときだけ有効）", level1: "レベル1：五連だけ", level2: "レベル2", level3: "レベル3", level4: "レベル4", level5: "レベル5", level6: "レベル6（フル v13）", level7: "レベル7：最強（フル v14）",
    levelHint: "1 つ上のレベルは下のレベルに 10 戦で約 8 勝します。レベル1は目の前の五連を取るだけ、レベル6はフルの v13、レベル7はオセロがずっと強い v14（レベル6・7の思考時間は下）。AI コーチは強さの影響を受けず、常に最善の助言をします。",
    v6TimeLabel: "AI の思考時間", stPickManual: "組は未選択（マスをクリックすると順に試せます）", stHumanTap: "👤 あなた · {turn} · {pick}", stPickHint: "ヒント中：マスをクリックするとそのマスで勝率最高の組を打ちます（先に組を選ぶことも可）", stPickHintHover: "このマスの最善は {disc} の組。クリックで打つ", stTapPick: "このマスで {disc} を試し中：もう一度クリックで次の組、長押しで打つ、他をクリックで取消", poolPickPrompt: "組を選ぶか、マスをクリック", pickerAria: "{c} に打つ石を選ぶ", openingStdNote: "標準：中央の 4 枚から始めます。", openingLabel: "開局", openingStandard: "標準", openingXot: "XOT ランダム開局", openingNote: "XOT：両者の勝率が 50% ± 5% に収まるランダムな 6～10 手がすでに打たれた状態から始まります。定石は使えず、最初の一手から読みと大局観の勝負。", xotLog: "（XOT 開局）", paceLabel: "対局のテンポ", paceSlow: "遅い", paceNormal: "標準", paceFast: "速い", paceInstant: "最速（アニメーションと着手音なし）", paceNote: "CPU が石を置く速さです。見た目の速さだけが変わり、強さや分析には影響しません。", time500: "0.5 秒（標準）", time1000: "1 秒", time2000: "2 秒", time4000: "4 秒",
    tutorialModalTitle: "60秒で覚える五連オセロ！", tutorialOk: "分かった、始めよう！",
    rule2Title: "ルール1：4 組の石から自由に選ぶ", rule2Text: "64 枚の石は 4 組（石の文字が組）で各 16 枚、両者共用です。手番では残っている組を 1 つ選び、合法手に置きます（オセロと同じく相手を挟む必要あり）。開始の 4 枚は各組 1 枚ずつ。打てる場所がなければパス。",
    confirmTitle: "操作の確認", confirmMsg: "この操作を実行してよろしいですか？", confirmCancel: "キャンセル", confirmOk: "確認",
    branchModalTitle: "対局ツリー", branchClose: "閉じる",
    skinTitle: "設定", skinSoundLabel: "🔊 効果音",
    nameLabel: "🏷️ 名前のカスタム（左：黒番　右：白番、空欄でデフォルト）：",
    skinThemeSection: "🏞️ ボードテーマ",
    themeNeon: "ネオンディープ（デフォルト）", themeClassic: "クラシックジェイド", themeWood: "エレガントウッド", themeSlate: "ミニマルスレート",
    skinCustomHint: "黒石・白石の宝石カラーと、石の上の文字の色を選べます。",
    skinBlackTitle: "⚫ 黒石の外観", skinWhiteTitle: "⚪ 白石の外観", skinPreviewLabel: "ライブボードプレビュー",
    skinTextColorSection: "🔤 文字の色", skinGemSection: "💎 宝石プリセット",
    skinReset: "🔄 デフォルトに戻す", skinDone: "完了",
    ariaClose: "閉じる", ariaModes: "ゲームモード", ariaBoard: "8x8 五連オセロ盤", ariaWhiteSeat: "白番の操作者", ariaBlackSeat: "黒番の操作者",
    poolCpuPick: "CPU は {disc} を選択", coachWinrate: "勝率 {p}%", btnHintOn: "💡 ヒント：オン", hintHelp: "オンにすると、打てるマスに 4 組のうち最も高い勝率を表示。マスにカーソルを合わせると、置く組と各組の勝率が見られます。", cellHint: "{c} 着手可、勝率 {p}%", chartAria: "勝率の推移（白が上、黒が下）", chartTipBlack: "黒の勝率 {p}", stResearch: "🔬 分岐研究（第 {n} 手から）· {turn} の番 · {pick}。第 {n} 手に戻ると研究終了", stHumanPick: "👤 あなた · {turn} · {pick}。マスをクリック（★5 = 五連完成）", stPickDisc: "{disc} を選択中（もう一度クリックで解除）", symbolSection: "🔣 石の記号", symbolHint: "既定はトランプの 4 つのマーク ♠ ♥ ♦ ♣（組ごとに 1 つ）。ギリシャ文字 α β γ δ や、好きな 4 文字（漢字・英字・ギリシャ文字・かな）にも変更できます。すべて異なる文字にしてください。", chartTipBoth: "白 {w} · 黒 {b}", symGreek: "ギリシャ文字", symSuits: "トランプのマーク", symCustom: "カスタム", symCustomApply: "適用", symCustomPlaceholder: "異なる 4 文字を入力（例：春夏秋冬）", symCustomCount: "ちょうど 4 文字必要です。現在 {n} 文字（空白は数えません）", symCustomDupe: "「{ch}」が重複しています。4 文字はすべて異なる必要があります", symCustomReady: "4 文字すべて OK。「適用」か Enter で反映", symCustomOk: "変更しました：{chars}", poolSelected: "{disc} を選択中", poolWaiting: "相手が組を選んでいます", poolGroupUsed: "{disc} 組は使い切り", poolDisc: "{disc} 組（残り {n} 枚）", poolDiscFive: "{disc} 組（残り {n} 枚、すぐ五連完成）", exFiveDangerSure: "⚠️ この後、相手はプールの {disc} で五連を完成できる",
    handLabel: "組を選ぶ", handNone: "—", handBag: "残り {n} 枚",  handEnded: "終局",
    cellEmpty: "{c} 空き",  cellLegal: "{c} 着手可、{n}枚返る",
    black: "黒番", white: "白番",
    sideBlack: "⚫ {bn}", sideWhite: "⚪ {wn}",
    logRoot: "開始局面 (#0)", logMove: "#{idx} {side} {to}（{disc}）：{n}枚返す{five}", logPass: "{side} 打てる場所なし、パス！{enemy} の番",
    branchMain: "本線", branchFrom: "{n}手目から", branchFromDup: "{n}手目から ({dup})", branchDefault: "🌿 分岐 #{n}",
    reasonFull: "盤面が埋まりました", reasonNoMoves: "双方とも打てる場所がありません", reasonDefault: "終局結果",
    stReview: "🕘 第 #{n} 手を表示中。ここで打つと分岐します", stEnded: "🏁 対局終了 · {reason}",
    stPaused: "⏸ 一時停止中 · {turn} · [▶ 再開] でCPU同士が対戦", stPausedOne: "⏸ 一時停止中 · {turn} · [▶ 再開] でCPUが打ちます",
    stCpuVsCpu: "👁 CPU対戦中", stCpu: "🤖 CPU",
    stCpuThinking: "{actor} · {turn} · {w}点の石を引いて、思考中…",
    stPassing: "{turn} は打てる場所がなくパス…",
    startFromHere: "🌿 ここから打つ", startFromHereTip: "この局面から対局を始める", restart: "🔄 もう一局", restartTip: "新しい対局",
    vsCpu: "🤖 {name}をCPUに", pause: "⏸ 一時停止", pauseTip: "CPUを一時停止 [スペース]", resume: "▶ 再開", resumeTip: "CPUを再開 [スペース]",
    restartTitle: "新しい対局を始めますか？", restartMsg: "現在の対局はリセットされ、新しい対局を始めます。", restartOk: "新しい対局",
    renameTip: "クリックで名前を変更", renamePrompt: "名前を入力（空欄でデフォルト）：",
    noHistory: "まだ手がありません", manageTree: "🌳 対局ツリーを管理…",
    coachEmptyEnded: "対局は終了しました。棋譜の手をクリックして振り返れます。", coachEmptyNoMove: "この局面には打てる場所がありません（パス）。",
    coachEmptyDefault: "「💡 ヒント」を押すと、この局面の最善手を分析します。",
    coachThinking: "分析中…", coachThinkingSub: "候補手と期待値探索木をたどっています",
    coachTitle: "💡 ヒント分析", coachTop: "最有力", applyThis: "この手を打つ", coachOthers: "🥈 その他の候補",
    preview: "👁 プレビュー", apply: "採用", rank1: "👑 最善", rank2: "🥈 次善", rank3: "🥉 三番手",
    stCpuThinkingFive: "{actor} · {turn} · 組を選んで思考中…",
    reasonFive: "{side} が {v} の五連を完成、即勝利！", fxFive: "{v} の五連！",
    exFiveWin: "🏆 {v} の五連が完成、即勝利！",  
    exFiveForced: "エンジン判定：この手の後は必勝", exFiveLost: "エンジン判定：どう打っても負け", exFiveWinrate: "エンジンの推定勝率 約 {p}%",
    exFiveDanger: "この後、補充される石が合えば相手は五連を完成できる",
    legendFiveNote: "最初の 2 つはどちらも {x}（同じ組。色は関係なく、裏返しは色だけ変わる）、{y} は別の組。自分の同じ組の石が一直線に 5 つで五連。",
    logFive: "　🏆 {v} の五連！",
    cellDiscFivePlain: "{c} {side} {disc}",
    exFivePlainGain: "{disc} を置き、{n} 枚返す",
    exSummaryFivePlain: "{disc} を {coord} に置くと、石の数 {mine} 対 {theirs}",
    rule6Title: "ルール2：同じ組の五連で即勝利", rule6Text: "石には文字が 1 つ、それが組です（表裏同じ、裏返しは色だけ変わる）。一直線（横・縦・斜め）に自分の同じ組の石が 5 つ並べば即勝利、返して並んだ場合も含む。誰もできなければ石の数で比べる（1 枚 1 点、合計 64 点）。",
    p_placeholder: ""
  }
};

export function clampName(s) {
  return typeof window !== "undefined" && window.takuClampName
    ? window.takuClampName(s)
    : String(s || "").replace(/[<>&"']/g, "").slice(0, 10);
}

export function curLang() {
  return (typeof window !== "undefined" && window.currentLang) || "zh";
}

export function tr(key, params = {}) {
  const dict = D[curLang()] || D.zh;
  const has = dict[key] != null || D.zh[key] != null;
  if (!has) return baseTr(key, params); // 共用字串（外觀預設名稱等）
  const names = (typeof window !== "undefined" && window.takuNames) || {};
  const bn = clampName(names.black) || (dict.black), wn = clampName(names.white) || (dict.white);
  if (key === "black") return bn;
  if (key === "white") return wn;
  let s = dict[key] != null ? dict[key] : D.zh[key];
  const all = { bn, wn, ...params };
  for (const k in all) s = s.split(`{${k}}`).join(all[k]);
  return s;
}

/** 字串原樣回傳；{k, p} 結構化訊息依目前語言翻譯（p 內的 { k, p } 會遞迴翻譯，陣列會翻譯後串接） */
export function tx(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  const p = {};
  for (const k in (v.p || {})) {
    const x = v.p[k];
    if (Array.isArray(x)) p[k] = x.map(tx).join(tr("listSep")); // 清單（例如多組牌型）
    else if (x && typeof x === "object" && "$disc" in x) p[k] = discLabel(x.$disc, true);   // 棋子（依目前的符號組顯示）
    else if (x && typeof x === "object" && "$sym" in x) p[k] = letterOf(x.$sym);              // 單一符號（五連的那個字）
    else p[k] = x && typeof x === "object" ? tx(x) : (x == null ? "" : x);
  }
  return tr(v.k, p);
}

export const msg = (k, p) => ({ k, p });

/** 把文字裡的 ⚫ ⚪ 換成使用者自訂外觀的小棋子（輸入須是已可安全放進 HTML 的文字） */
export function pieceify(html) {
  return String(html)
    .replace(/⚫/g, '<span class="pieceDot black"></span>')
    .replace(/⚪/g, '<span class="pieceDot white"></span>');
}

/** 跳脫 HTML 特殊字元（文字內容與屬性值都能用：引號也要跳脫，不然放進 aria-label="…" 這類屬性會被截斷） */
export const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ===== 靜態 HTML 翻譯與語言切換 =====

/** 顯示寬度上限 20（英數 1、中日韓 2），並濾掉 HTML 特殊字元 */
function clampWidth(s, max = 20) {
  let out = "", w = 0;
  for (const ch of String(s || "").replace(/[<>&"']/g, "")) {
    const cp = ch.codePointAt(0);
    const cw = (cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3) ||
      (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60) ||
      (cp >= 0xFFE0 && cp <= 0xFFE6) || cp >= 0x1F300 ? 2 : 1;
    if (w + cw > max) break;
    out += ch; w += cw;
  }
  return out;
}

const SIDE_KEYS = { seatWhite: "white", seatBlack: "black" };
const SIDE_WORDS = { zh: { black: ["黑方"], white: ["白方"] }, en: { black: ["Black"], white: ["White"] }, ja: { black: ["黒番"], white: ["白番"] } };

/** 靜態文字專用：支援自訂名稱與 ⚫⚪ 轉棋子圖示 */
export function t(key) {
  const lang = curLang();
  let s = (D[lang] || D.zh)[key] != null ? (D[lang] || D.zh)[key] : (D.zh[key] != null ? D.zh[key] : key);
  const side = SIDE_KEYS[key];
  const custom = side && window.takuNames && window.takuNames[side];
  if (custom) {
    const w = (SIDE_WORDS[lang] || SIDE_WORDS.zh)[side].find(x => s.includes(x));
    if (w) s = s.replace(w, custom.replace(/</g, "&lt;"));
  }
  if (key === "seatBlack" || key === "seatWhite") {
    s = s.replace(/^[⚫⚪]\s*/, '<span class="pieceDot ' + (key === "seatBlack" ? "black" : "white") + '"></span>');
  }
  return s;
}

export function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll(".modalCloseBtn").forEach(el => el.setAttribute("aria-label", t("ariaClose")));
  const setAria = (sel, key) => { const el = document.querySelector(sel); if (el) el.setAttribute("aria-label", t(key)); };
  setAria(".modeTabs", "ariaModes");
  setAria("#boardContainer", "ariaBoard");
  document.querySelectorAll(".seatToggle").forEach((el, i) => el.setAttribute("aria-label", t(i === 0 ? "ariaWhiteSeat" : "ariaBlackSeat")));
  document.title = t("pageTitle");
  const lang = curLang();
  document.documentElement.lang = lang === "ja" ? "ja" : (lang === "en" ? "en" : "zh-Hant");
  const langSel = document.getElementById("langSelect");
  if (langSel) langSel.value = lang;
}

export function setLang(lang) {
  window.currentLang = lang;
  try { localStorage.setItem("takuLang", lang); } catch (e) {}
  applyI18n();
  window.dispatchEvent(new Event("langchange"));
}

/** 初始化：語言偏好與自訂名稱需要在第一次渲染前就備妥 */
export function initI18n(savedNames = {}) {
  window.takuClampName = clampWidth;
  window.takuNames = { black: clampWidth(savedNames.black), white: clampWidth(savedNames.white) };
  let lang = "zh";
  try { lang = localStorage.getItem("takuLang") || "zh"; } catch (e) {}
  window.currentLang = D[lang] ? lang : "zh";
  window.t = t;
  window.setLang = setLang;
  window.applyI18n = applyI18n;
}

export const DICTIONARY = D;
