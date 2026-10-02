/**
 * 動態文字翻譯（JS 產生的文字）。靜態 HTML 仍由 index.html 的 TAKU_TR 處理。
 * tr(key, params) 依 window.currentLang 取字；tx(v) 可接受字串或 {k, p} 結構化訊息。
 */
const D = {
  zh: {
    cellEmpty: "{c} 空格", cellBlack: "{c} 黑棋", cellWhite: "{c} 白棋", cellSpawnable: "{c} 可生子{s}", cellCapturable: "{c} 可吃子{s}",
    tipSpawn: "生子至 {c}{s}", tipCapture: "吃掉 {c} 的敵棋{s}", notImage: "所選檔案並非圖片格式",
    confirmOk: "確認", confirmCancel: "取消", finalWin: "🏆 {name}獲勝 +{n}", finalDraw: "🤝 平手", vsCpu: "🤖 {name}變成 CPU", whoHuman: "👤 我", whoCpu: "🤖 CPU", renameTip: "點一下可自訂名稱", renamePrompt: "輸入自訂名稱（留空則恢復預設）：",
    black: "黑方", white: "白方", blackTurn: "輪到{bn}", whiteTurn: "輪到{wn}",
    steps: "{n} 步", stepsParen: "({n}步)", needSteps: "(需 {n} 步)", noSteps: "無步", unrolled: "未擲骰",
    // 對局紀錄
    logRoot: "開局初始局面 (#0)", logCapture: "吃掉 {to} 敵棋", logSpawn: "生子至 {to}",
    logMove: "#{idx} {side} ({dice}步)：{from} ➔ {to} {action}",
    logPass: "{side} ({dice})：無合法走法，PASS 給對手！{enemy} 獲得免擲骰自選特權",
    branchMain: "主線", branchFrom: "第 {n} 手起", branchFromDup: "第 {n} 手起 ({dup})", branchDefault: "🌿 分支 #{n}",
    reasonAnnihilate: "殲滅終局：{side} 棋子全滅！",
    reasonNatural: "自然幾何終局：雙方已不可能互相吃子，依規則一、二填滿勢力",
    reasonDefault: "終局結算",
    // 狀態列
    sideBlack: "⚫ {bn}", sideWhite: "⚪ {wn}",
    stReview: "🕘 檢視第 #{n} 步歷史局面 {tag}", stReviewDice: "（當時擲出 {d} 點 · 尚未改變對局）", stReviewStart: "（開局狀態 · 尚未改變對局）",
    stEnded: "🏁 對局已結束 · {reason}",
    stPaused: "⏸ 已暫停 · {turn} · 按 [▶ 繼續] 讓 CPU 相互對戰",
    stPausedOne: "⏸ 已暫停 · {turn} · 按 [▶ 繼續] 讓 CPU 走",
    stAssist: "🤖 代下中（剩 {n} 手）", stCpuVsCpu: "👁 CPU 對戰中", stCpu: "🤖 CPU ({algo})",
    stCpuThinking: "{actor} · {turn} · 擲出 {d} 點，思考落子中…", stCpuEval: "{actor} · {turn} · 評估擲骰與最佳行棋中…",
    stFree: "👤 你 · {turn} · 🎁 特權自選：請點選下方 1～6 點或點選盤上棋子",
    stRoll: "👤 你 · {turn} · 請擲骰子（點擊按鈕或按鍵盤 [R] 鍵）",
    stPick: "👤 你 · {turn} · 已擲出 {d} 點，請選取盤上任一顆己方棋子",
    stDest: "👤 你 · {turn} · 已擲出 {d} 點，請點選綠框目的地生子或直線吃子",
    startFromHere: "🌿 從這裡開始下", startFromHereTip: "以此盤面為起點開始下棋", restart: "🔄 再來一局", restartTip: "重新開局",
    roleReview: "🕘 歷史盤面 (唯讀)", roleEnded: "🏁 終局結算", roleAssist: "🤖 CPU 代下 ({algo})", roleCpu: "🤖 CPU ({algo})",
    rolePaused: "⏸ CPU (已暫停)", roleHuman: "👤 你來下",
    diceEnded: "終局", diceFree: "自選",
    leadBlack: "{bn}超前 {n}", leadWhite: "{wn}超前 {n}", leadTie: "平手",
    insEnded: "🏁 <b>對局已結束</b>：{reason}",
    insFree: "🎁 <b>自由選點特權</b>：對手被迫 PASS，請直接點選下方 1～6 點或點選盤上棋子生子/吃子！",
    insRolling: "🎲 骰子自動擲出中...",
    insPickPiece: "♟️ <b>請選擇棋子</b>：擲出 {d} 步，請點選盤上任一顆己方棋子。",
    insPickDest: "🎯 <b>請選擇目的地</b>：🌱 {s} 種生子，⚔️ {c} 種直線吃子。",
    pause: "⏸ 暫停", pauseTip: "暫停 CPU [空白鍵]", resume: "▶ 繼續", resumeTip: "繼續讓 CPU 下 [空白鍵]",
    // 結算
    winBlack: "🏆 {bn}獲得勝利！", winWhite: "🏆 {wn}獲得勝利！", draw: "🤝 雙方平手！", whiteWithKomi: "{n} (含貼目 +{k})",
    restartTitle: "重新開始新局？", restartMsg: "目前的棋局進度將重置回初始開局狀態。", restartOk: "重新開局",
    imgReadFail: "圖片讀取失敗：", customImage: "自訂圖片", customColor: "自訂色彩", importFail: "無效的棋譜檔案格式",
    // 提示 / 教練
    coachEmptyEnded: "對局已結束，點擊「📜 棋譜覆盤」或重播按鈕進行覆盤檢視。",
    coachEmptyRoll: "等待擲骰後才能計算建議走法。", coachEmptyNoMove: "此局面當前無任何合法走法（須 Pass 棄權）。",
    coachEmptyDefault: "點擊「💡 提示」按鈕，將為您即時分析目前局面的最佳走法建議。",
    coachThinking: "提示分析中，請稍候...", coachThinkingSub: "正在全面遍歷候選走法與預期搜尋樹",
    coachTitle: "💡 提示分析", coachTop: "評估首選", tCapture: "⚔️ 吃子", tSpawn: "🌱 生子",
    applyThis: "採用此步", coachOthers: "🥈 其他候選走法排行榜", preview: "👁 預覽", apply: "採用",
    rank1: "👑 首選", rank2: "🥈 次選", rank3: "🥉 備選",
    // 骰子面板
    diceDone: "🏁 終局結算完畢", diceHistory: "🕘 歷史步數：當時擲出 <b>{d}</b> 點", diceHistoryView: "🕘 歷史局面檢視中（唯讀）",
    freeBadge: "🎁 自由選點特權", freeDesc: "對手被迫 PASS，您可免骰直接指定 1～6 步數：",
    diceCpuRolled: "🤖 CPU 擲出 <b>{d}</b> 點（落子選點中…）", diceLocked: "🔒 步數 {d}（已由骰子鎖定）",
    diceCpuThinking: "🤖 CPU 思考與行動中...", dicePrompt: "請點擊擲骰或按 [R] 鍵開始本回合", rollBtn: "🎲 擲骰子",
    // 歷史
    manageTree: "檢視與管理對局樹...", noHistory: "尚無行動紀錄",
    // AI 解說
    exCapture: "⚔️ 直接吃掉敵方於 {to} 的棋子，消滅敵方戰力", exEscape: "🛡️ 成功令己方自原先受威脅的 {from} 脫身解圍",
    exSpawn: "🌱 成功向目標方向增殖生子至 {to}", exGain: "🗺️ 為全隊開拓 +{n} 格全新領地", exSuppress: "🚧 扼守動脈，壓縮敵方 {n} 格活動空間",
    exSafe: "✨ 目標格安全，無任何立即被反吃的直線威脅", exThreat1: "⚠️ 落子後目標格受到 1 條敵軍直線吃子射線瞄準 (1/6 被吃機率)",
    exThreatN: "🚨 受到 {n} 條交叉射線威脅，換子風險高", exForced: "🎯 成功限制對手走法，迫使對手在 {n} 種骰值下陷入 PASS",
    sumCapture: "從 {from} 發動直線突擊吃掉 {to} 的敵棋{dice}", sumSpawn: "從 {from} 推進生子至 {to}{dice}",
    // AI 型號
    "ai_v1_name": "入門型", "ai_v1_tech": "v1 經典地力", "ai_v1_desc": "純貪心地力最大化，注重立即可得之棋盤收益", "ai_v1_badge": "⚡ 激進",
    "ai_v2_name": "戰術型", "ai_v2_tech": "v2 戰術進階", "ai_v2_desc": "防守送子、邊際拓地、壓制動脈與防被罰 PASS", "ai_v2_badge": "🛡️ 戰術",
    "ai_v3_name": "預判型", "ai_v3_tech": "v3 預期搜尋", "ai_v3_desc": "Expectiminimax 深度2機率推演，考慮對手6骰最佳反應", "ai_v3_badge": "🎲 預判",
    "ai_v4_name": "反擊型", "ai_v4_tech": "v4 深度反擊", "ai_v4_desc": "3層博弈樹深搜、兌子反撲陷阱預警、抓破綻反殺", "ai_v4_badge": "⚔️ 反擊",
    "ai_v5_name": "宗師型", "ai_v5_tech": "v5 戰略宗師", "ai_v5_desc": "二階段深搜：v4 篩選全候選 → 前5名 depth-4 重新驗證，多看一層對手反擊", "ai_v5_badge": "🧠 宗師",
    // 色票
    p_obsidian: "經典黑曜", p_ruby: "烈焰赤紅", p_sapphire: "蔚藍深海", p_emerald: "翡翠墨玉", p_amethyst: "紫晶魅影", p_amber: "琥珀鎏金",
    p_pearl: "經典珍珠", p_crystal: "冰晶雪白", p_rose: "玫瑰粉晶", p_mint: "薄荷碧玉", p_ivory: "曜金象牙", p_topaz: "幻彩天藍"
  },
  en: {
    cellEmpty: "{c} empty", cellBlack: "{c} black", cellWhite: "{c} white", cellSpawnable: "{c} can spawn{s}", cellCapturable: "{c} can capture{s}",
    tipSpawn: "Spawn at {c}{s}", tipCapture: "Capture the enemy at {c}{s}", notImage: "The selected file is not an image",
    confirmOk: "Confirm", confirmCancel: "Cancel", finalWin: "🏆 {name} wins +{n}", finalDraw: "🤝 Draw", vsCpu: "🤖 {name} becomes CPU", whoHuman: "👤 Me", whoCpu: "🤖 CPU", renameTip: "Click to rename", renamePrompt: "Enter a custom name (blank = default):",
    black: "Black", white: "White", blackTurn: "{bn}'s turn", whiteTurn: "{wn}'s turn",
    steps: "{n} steps", stepsParen: "({n} steps)", needSteps: "(needs {n} steps)", noSteps: "no roll", unrolled: "Not rolled",
    logRoot: "Initial position (#0)", logCapture: "captures at {to}", logSpawn: "spawns at {to}",
    logMove: "#{idx} {side} ({dice} steps): {from} ➔ {to} {action}",
    logPass: "{side} ({dice}): no legal move, PASS! {enemy} gets a free dice pick",
    branchMain: "Main line", branchFrom: "From move {n}", branchFromDup: "From move {n} ({dup})", branchDefault: "🌿 Branch #{n}",
    reasonAnnihilate: "Annihilation: all {side} pieces are gone!",
    reasonNatural: "Natural end: neither side can capture anymore, territory filled by rules 1 & 2",
    reasonDefault: "Final settlement",
    sideBlack: "⚫ {bn}", sideWhite: "⚪ {wn}",
    stReview: "🕘 Viewing history at move #{n} {tag}", stReviewDice: "(rolled {d} then · game unchanged)", stReviewStart: "(start position · game unchanged)",
    stEnded: "🏁 Game over · {reason}",
    stPaused: "⏸ Paused · {turn} · Press [▶ Resume] to let the CPUs play each other",
    stPausedOne: "⏸ Paused · {turn} · Press [▶ Resume] to let the CPU move",
    stAssist: "🤖 Auto-playing ({n} moves left)", stCpuVsCpu: "👁 CPU vs CPU", stCpu: "🤖 CPU ({algo})",
    stCpuThinking: "{actor} · {turn} · Rolled {d}, choosing a move…", stCpuEval: "{actor} · {turn} · Evaluating the roll and best move…",
    stFree: "👤 You · {turn} · 🎁 Free pick: choose 1–6 below or click a piece on the board",
    stRoll: "👤 You · {turn} · Roll the dice (click the button or press [R])",
    stPick: "👤 You · {turn} · Rolled {d}. Select one of your pieces",
    stDest: "👤 You · {turn} · Rolled {d}. Click a green target to spawn or a straight line to capture",
    startFromHere: "🌿 Play from here", startFromHereTip: "Start playing from this position", restart: "🔄 New game", restartTip: "Start a new game",
    roleReview: "🕘 History (read-only)", roleEnded: "🏁 Settled", roleAssist: "🤖 CPU auto-play ({algo})", roleCpu: "🤖 CPU ({algo})",
    rolePaused: "⏸ CPU (paused)", roleHuman: "👤 Your move",
    diceEnded: "Ended", diceFree: "Free",
    leadBlack: "{bn} +{n}", leadWhite: "{wn} +{n}", leadTie: "Tie",
    insEnded: "🏁 <b>Game over</b>: {reason}",
    insFree: "🎁 <b>Free pick</b>: your opponent had to PASS. Click 1–6 below or a piece on the board to spawn/capture!",
    insRolling: "🎲 Rolling the dice...",
    insPickPiece: "♟️ <b>Select a piece</b>: rolled {d}. Click any of your pieces on the board.",
    insPickDest: "🎯 <b>Select a target</b>: 🌱 {s} spawns, ⚔️ {c} straight captures.",
    pause: "⏸ Pause", pauseTip: "Pause CPU [Space]", resume: "▶ Resume", resumeTip: "Resume CPU [Space]",
    winBlack: "🏆 {bn} wins!", winWhite: "🏆 {wn} wins!", draw: "🤝 It's a draw!", whiteWithKomi: "{n} (incl. komi +{k})",
    restartTitle: "Start a new game?", restartMsg: "The current game progress will be reset to the initial position.", restartOk: "New game",
    imgReadFail: "Failed to read image: ", customImage: "Custom image", customColor: "Custom color", importFail: "Invalid game record format",
    coachEmptyEnded: "The game is over. Use the replay controls to review it.",
    coachEmptyRoll: "Roll the dice first to get suggested moves.", coachEmptyNoMove: "No legal moves in this position (you must PASS).",
    coachEmptyDefault: "Click the 💡 Hint button for an instant analysis of the best moves.",
    coachThinking: "Analyzing, please wait...", coachThinkingSub: "Searching all candidate moves and the expectation tree",
    coachTitle: "💡 Hint analysis", coachTop: "Top pick", tCapture: "⚔️ Capture", tSpawn: "🌱 Spawn",
    applyThis: "Play this move", coachOthers: "🥈 Other candidate moves", preview: "👁 Preview", apply: "Play",
    rank1: "👑 1st", rank2: "🥈 2nd", rank3: "🥉 3rd",
    diceDone: "🏁 Game settled", diceHistory: "🕘 History: rolled <b>{d}</b> at that time", diceHistoryView: "🕘 Viewing history (read-only)",
    freeBadge: "🎁 Free pick", freeDesc: "Your opponent had to PASS. Choose 1–6 steps without rolling:",
    diceCpuRolled: "🤖 CPU rolled <b>{d}</b> (choosing a move…)", diceLocked: "🔒 Steps {d} (locked by the dice)",
    diceCpuThinking: "🤖 CPU is thinking...", dicePrompt: "Click Roll or press [R] to start the turn", rollBtn: "🎲 Roll dice",
    manageTree: "View & manage game tree...", noHistory: "No moves yet",
    exCapture: "⚔️ Captures the enemy piece at {to}, removing enemy strength", exEscape: "🛡️ Lets your piece escape the threat at {from}",
    exSpawn: "🌱 Spawns a new piece at {to} toward the target", exGain: "🗺️ Opens up +{n} new squares of territory", exSuppress: "🚧 Controls a key lane, squeezing {n} enemy squares",
    exSafe: "✨ Target square is safe from any immediate straight-line threat", exThreat1: "⚠️ The target is covered by 1 enemy capture line (1/6 chance to be taken)",
    exThreatN: "🚨 Threatened by {n} crossing lines, high risk of a trade", exForced: "🎯 Restricts the opponent, forcing PASS on {n} dice values",
    sumCapture: "Charge from {from} and capture the enemy at {to}{dice}", sumSpawn: "Advance from {from} and spawn at {to}{dice}",
    "ai_v1_name": "Beginner", "ai_v1_tech": "v1 Classic Territory", "ai_v1_desc": "Pure greedy territory maximizing, focusing on immediate board gains", "ai_v1_badge": "⚡ Aggressive",
    "ai_v2_name": "Tactical", "ai_v2_tech": "v2 Tactics", "ai_v2_desc": "Avoids blunders, expands edges, controls lanes and avoids forced PASS", "ai_v2_badge": "🛡️ Tactical",
    "ai_v3_name": "Predictive", "ai_v3_tech": "v3 Expectation Search", "ai_v3_desc": "Depth-2 Expectiminimax, considers the opponent's best reply on all 6 rolls", "ai_v3_badge": "🎲 Predictive",
    "ai_v4_name": "Counter", "ai_v4_tech": "v4 Deep Counter", "ai_v4_desc": "3-ply tree search, trade-trap warnings, punishes weaknesses", "ai_v4_badge": "⚔️ Counter",
    "ai_v5_name": "Grandmaster", "ai_v5_tech": "v5 Grandmaster", "ai_v5_desc": "Two-stage search: v4 screens all candidates, then the top 5 are re-verified at depth 4", "ai_v5_badge": "🧠 Master",
    p_obsidian: "Classic Obsidian", p_ruby: "Blazing Ruby", p_sapphire: "Deep Sapphire", p_emerald: "Emerald Jade", p_amethyst: "Amethyst Shadow", p_amber: "Golden Amber",
    p_pearl: "Classic Pearl", p_crystal: "Frost Crystal", p_rose: "Rose Quartz", p_mint: "Mint Jade", p_ivory: "Golden Ivory", p_topaz: "Sky Topaz"
  },
  ja: {
    cellEmpty: "{c} 空き", cellBlack: "{c} 黒石", cellWhite: "{c} 白石", cellSpawnable: "{c} 増殖可能{s}", cellCapturable: "{c} 取り可能{s}",
    tipSpawn: "{c} に増殖{s}", tipCapture: "{c} の敵駒を取る{s}", notImage: "選択したファイルは画像ではありません",
    confirmOk: "確認", confirmCancel: "キャンセル", finalWin: "🏆 {name}の勝ち +{n}", finalDraw: "🤝 引き分け", vsCpu: "🤖 {name}をCPUにする", whoHuman: "👤 自分", whoCpu: "🤖 CPU", renameTip: "クリックして名前を変更", renamePrompt: "名前を入力（空欄でデフォルト）：",
    black: "黒番", white: "白番", blackTurn: "{bn}の手番", whiteTurn: "{wn}の手番",
    steps: "{n} 歩", stepsParen: "({n}歩)", needSteps: "(必要 {n} 歩)", noSteps: "出目なし", unrolled: "未ロール",
    logRoot: "初期局面 (#0)", logCapture: "{to} の敵駒を取る", logSpawn: "{to} に増殖",
    logMove: "#{idx} {side} ({dice}歩)：{from} ➔ {to} {action}",
    logPass: "{side} ({dice})：合法手なし、パス！{enemy} はサイコロ免除の自由選択権を得る",
    branchMain: "本筋", branchFrom: "{n} 手目から", branchFromDup: "{n} 手目から ({dup})", branchDefault: "🌿 分岐 #{n}",
    reasonAnnihilate: "殲滅終局：{side}の駒が全滅！",
    reasonNatural: "自然終局：双方とも取り合えなくなったため、ルール1・2に従い勢力を埋めます",
    reasonDefault: "終局精算",
    sideBlack: "⚫ {bn}", sideWhite: "⚪ {wn}",
    stReview: "🕘 第 #{n} 手の履歴局面を表示中 {tag}", stReviewDice: "（当時の出目 {d} · 対局は変更されません）", stReviewStart: "（初期局面 · 対局は変更されません）",
    stEnded: "🏁 対局終了 · {reason}",
    stPaused: "⏸ 一時停止中 · {turn} · [▶ 再開] でCPU同士を対戦させる",
    stPausedOne: "⏸ 一時停止中 · {turn} · [▶ 再開] でCPUが指す",
    stAssist: "🤖 代打ち中（残り {n} 手）", stCpuVsCpu: "👁 CPU対戦中", stCpu: "🤖 CPU ({algo})",
    stCpuThinking: "{actor} · {turn} · 出目 {d}、着手を思考中…", stCpuEval: "{actor} · {turn} · ロールと最善手を評価中…",
    stFree: "👤 あなた · {turn} · 🎁 自由選択：下の1～6か盤上の駒をクリック",
    stRoll: "👤 あなた · {turn} · サイコロを振ってください（ボタンまたは [R] キー）",
    stPick: "👤 あなた · {turn} · 出目 {d}。盤上の自分の駒を選んでください",
    stDest: "👤 あなた · {turn} · 出目 {d}。緑の目的地で増殖、または直線で取ってください",
    startFromHere: "🌿 ここから指す", startFromHereTip: "この局面から対局を始める", restart: "🔄 もう一局", restartTip: "新しい対局を始める",
    roleReview: "🕘 履歴局面（閲覧のみ）", roleEnded: "🏁 終局精算", roleAssist: "🤖 CPU代打ち ({algo})", roleCpu: "🤖 CPU ({algo})",
    rolePaused: "⏸ CPU (一時停止)", roleHuman: "👤 あなたの番",
    diceEnded: "終局", diceFree: "自由",
    leadBlack: "{bn} +{n}", leadWhite: "{wn} +{n}", leadTie: "引き分け",
    insEnded: "🏁 <b>対局終了</b>：{reason}",
    insFree: "🎁 <b>自由選択</b>：相手がパスしました。下の1～6か盤上の駒をクリックして増殖/取りましょう！",
    insRolling: "🎲 サイコロを振っています...",
    insPickPiece: "♟️ <b>駒を選択</b>：出目 {d}。盤上の自分の駒を選んでください。",
    insPickDest: "🎯 <b>目的地を選択</b>：🌱 増殖 {s} 通り、⚔️ 直線取り {c} 通り。",
    pause: "⏸ 一時停止", pauseTip: "CPUを一時停止 [スペース]", resume: "▶ 再開", resumeTip: "CPUを再開 [スペース]",
    winBlack: "🏆 {bn}の勝ち！", winWhite: "🏆 {wn}の勝ち！", draw: "🤝 引き分け！", whiteWithKomi: "{n}（コミ +{k} 込み）",
    restartTitle: "新しい対局を始めますか？", restartMsg: "現在の対局は初期局面にリセットされます。", restartOk: "新しい対局",
    imgReadFail: "画像の読み込みに失敗：", customImage: "カスタム画像", customColor: "カスタムカラー", importFail: "無効な棋譜ファイル形式です",
    coachEmptyEnded: "対局は終了しました。リプレイ操作で振り返りができます。",
    coachEmptyRoll: "サイコロを振ると候補手を計算できます。", coachEmptyNoMove: "この局面に合法手はありません（パスが必要）。",
    coachEmptyDefault: "💡 ヒントボタンを押すと、最善手を即座に分析します。",
    coachThinking: "分析中です。しばらくお待ちください...", coachThinkingSub: "候補手と期待探索木を探索しています",
    coachTitle: "💡 ヒント分析", coachTop: "第一候補", tCapture: "⚔️ 取り", tSpawn: "🌱 増殖",
    applyThis: "この手を指す", coachOthers: "🥈 その他の候補手", preview: "👁 プレビュー", apply: "採用",
    rank1: "👑 第1候補", rank2: "🥈 第2候補", rank3: "🥉 第3候補",
    diceDone: "🏁 終局精算済み", diceHistory: "🕘 履歴：当時の出目 <b>{d}</b>", diceHistoryView: "🕘 履歴局面を表示中（閲覧のみ）",
    freeBadge: "🎁 自由選択権", freeDesc: "相手がパスしました。サイコロなしで1～6歩を指定できます：",
    diceCpuRolled: "🤖 CPU の出目 <b>{d}</b>（着手を選択中…）", diceLocked: "🔒 歩数 {d}（サイコロで確定）",
    diceCpuThinking: "🤖 CPUが思考中...", dicePrompt: "ロールするか [R] キーでこの手番を開始", rollBtn: "🎲 サイコロを振る",
    manageTree: "対局ツリーを表示・管理...", noHistory: "まだ記録がありません",
    exCapture: "⚔️ {to} の敵駒を取り、敵の戦力を削ぎます", exEscape: "🛡️ 脅威にさらされた {from} から脱出できます",
    exSpawn: "🌱 目標方向の {to} に増殖します", exGain: "🗺️ 新たに +{n} マスの領地を開拓", exSuppress: "🚧 要所を押さえ、敵の活動範囲を {n} マス圧縮",
    exSafe: "✨ 目標マスは安全で、直ちに取られる直線の脅威はありません", exThreat1: "⚠️ 目標マスは敵の直線取りライン1本に狙われています (1/6で取られる)",
    exThreatN: "🚨 {n} 本の交差ラインに脅かされ、交換リスクが高い", exForced: "🎯 相手の手を制限し、{n} 通りの出目でパスに追い込みます",
    sumCapture: "{from} から直線突撃で {to} の敵駒を取る{dice}", sumSpawn: "{from} から {to} に増殖{dice}",
    "ai_v1_name": "入門型", "ai_v1_tech": "v1 クラシック地力", "ai_v1_desc": "純粋な貪欲法で地を最大化し、目先の盤面利益を重視", "ai_v1_badge": "⚡ 攻撃的",
    "ai_v2_name": "戦術型", "ai_v2_tech": "v2 戦術強化", "ai_v2_desc": "悪手回避、辺の拡張、要所の制圧、強制パスの回避", "ai_v2_badge": "🛡️ 戦術",
    "ai_v3_name": "予測型", "ai_v3_tech": "v3 期待探索", "ai_v3_desc": "深さ2のExpectiminimaxで、相手の6通りの出目への最善応手を考慮", "ai_v3_badge": "🎲 予測",
    "ai_v4_name": "反撃型", "ai_v4_tech": "v4 深層反撃", "ai_v4_desc": "3手の探索木、交換の罠の警告、隙を突く反撃", "ai_v4_badge": "⚔️ 反撃",
    "ai_v5_name": "名人型", "ai_v5_tech": "v5 戦略名人", "ai_v5_desc": "二段階探索：v4で全候補を絞り、上位5手を深さ4で再検証", "ai_v5_badge": "🧠 名人",
    p_obsidian: "クラシック黒曜", p_ruby: "烈火の赤", p_sapphire: "蒼き深海", p_emerald: "翡翠墨玉", p_amethyst: "紫水晶の幻影", p_amber: "琥珀の黄金",
    p_pearl: "クラシック真珠", p_crystal: "氷晶の白", p_rose: "ローズクォーツ", p_mint: "ミント翡翠", p_ivory: "金色の象牙", p_topaz: "幻彩の空色"
  }
};

/** 自訂名稱：顯示寬度上限 20（英數 1、中日韓 2），並濾掉 HTML 特殊字元；實作在 index.html 的 window.takuClampName */
export function clampName(s) {
  return typeof window !== "undefined" && window.takuClampName ? window.takuClampName(s) : String(s || "").replace(/[<>&"']/g, "").slice(0, 10);
}

export function curLang() {
  return (typeof window !== "undefined" && window.currentLang) || "zh";
}

export function tr(key, params = {}) {
  const dict = D[curLang()] || D.zh;
  const names = (typeof window !== "undefined" && window.takuNames) || {};
  const clean = (n) => clampName(n);
  const bn = clean(names.black) || dict.black, wn = clean(names.white) || dict.white;
  if (key === "black") return bn;
  if (key === "white") return wn;
  let s = dict[key] != null ? dict[key] : (D.zh[key] != null ? D.zh[key] : key);
  const all = { bn, wn, ...params };
  for (const k in all) s = s.split(`{${k}}`).join(all[k]);
  return s;
}

/** 字串原樣回傳；{k, p} 結構化訊息依目前語言翻譯（p 內的 { $: key } 會遞迴翻譯）。 */
export function tx(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  const p = {};
  for (const k in (v.p || {})) {
    const x = v.p[k];
    p[k] = x && typeof x === "object" ? tx(x) : x;
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

export const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
