/**
 * 規則說明內容（三個遊戲共用同一個視窗，只換這裡的資料）。
 * 每個遊戲每種語言：goal 一句話目標、steps 4 個規則（art 對應 help-art.js）、note 補充、keys 操作與快捷鍵。
 * 文字盡量精簡，完整說明放在各遊戲的規則學院。
 */

export const UI_TEXT = {
  zh: { title: "規則", tabRules: "規則", tabKeys: "操作", academy: "完整規則學院", start: "我懂了，開始", close: "關閉", fullGuide: "完整使用說明", steps: "步" },
  en: { title: "Rules", tabRules: "Rules", tabKeys: "Controls", academy: "Full Rules Academy", start: "Got it", close: "Close", fullGuide: "Full user guide", steps: "step" },
  ja: { title: "ルール", tabRules: "ルール", tabKeys: "操作", academy: "ルール道場へ", start: "分かった", close: "閉じる", fullGuide: "詳しい使い方", steps: "歩" }
};

export const HELP = {
  five: {
    zh: {
      goal: "同一組的棋連成五顆就贏。",
      steps: [
        { art: "five-groups", title: "64 顆棋，分 4 組", text: "棋上的字就是組別，每組 16 顆，雙方共用。輪到你時，自己選一組下。" },
        { art: "five-flank", title: "夾住才能下", text: "和黑白棋一樣，要夾住對手的棋，被夾住的全部翻成你的顏色。沒位置就 PASS。" },
        { art: "five-line", title: "同組五連，立刻獲勝", text: "橫、直、斜都算。要連續 5 顆你的顏色、同一組，翻面造成的也算。" },
        { art: "five-count", title: "沒人連成五就數棋子", text: "整局沒有五連，比盤上棋子數，多的人贏（雙方合計 64）。" }
      ],
      keys: [["點綠點", "落子（先選組別，或點格子逐組試）"], ["1～4", "選第幾組"], ["← →", "上一手、下一手"], ["空白", "暫停、繼續 CPU"], ["H", "開關提示"]]
    },
    en: {
      goal: "Connect five discs of the same group to win.",
      steps: [
        { art: "five-groups", title: "64 discs, 4 groups", text: "The symbol on a disc is its group. 16 per group, shared by both players. On your turn, pick a group to play." },
        { art: "five-flank", title: "Flank to place", text: "Same as Othello: you must flank enemy discs, and every flanked disc turns your color. No legal spot means PASS." },
        { art: "five-line", title: "Five of a group wins at once", text: "Row, column or diagonal: five in a row of your color and the same group. Flips count too." },
        { art: "five-count", title: "No five? Count discs", text: "If nobody connects five, the player with more discs wins (64 in total)." }
      ],
      keys: [["Click a dot", "Place (pick a group first, or click a cell to cycle groups)"], ["1-4", "Pick group"], ["← →", "Previous / next move"], ["Space", "Pause / resume CPU"], ["H", "Toggle hints"]]
    },
    ja: {
      goal: "同じグループの石を5つ並べたら勝ちです。",
      steps: [
        { art: "five-groups", title: "64個の石、4グループ", text: "石の文字がグループです。各16個を両者で共有します。自分の番にグループを選んで打ちます。" },
        { art: "five-flank", title: "挟んで置く", text: "オセロと同じで、相手の石を挟める場所にだけ置け、挟んだ石は全て自分の色になります。置けなければパス。" },
        { art: "five-line", title: "同グループの5連で即勝利", text: "縦・横・斜めのどれでも、自分の色で同じグループが5つ連続すれば勝ち。裏返しで揃った場合も有効です。" },
        { art: "five-count", title: "5連なしなら石の数", text: "誰も5連を作れなければ、盤上の石が多い方の勝ちです（合計64個）。" }
      ],
      keys: [["緑の点", "置く（先にグループを選ぶか、マスを押して順に切り替え）"], ["1～4", "グループ選択"], ["← →", "前の手、次の手"], ["Space", "CPUの一時停止・再開"], ["H", "ヒントの切り替え"]]
    }
  },

  district: {
    zh: {
      goal: "用牆把地圖切成選區，選舉人票最多的政黨獲勝。",
      steps: [
        { art: "district-map", title: "每格是社區，每點是選民", text: "格子裡的點是選民（1 點 = 1 票），底色是這一帶支持的政黨，越深領先越多。" },
        { art: "district-walls", title: "放牆，切出選區", text: "輪流放 I4、S4、T4 牆塊。外框和海岸線本身就是牆，新牆不能沿著它放，也不能重疊。" },
        { art: "district-win", title: "贏者全拿", text: "每個選區得票最多的政黨，拿走該區全部選舉人票。最後票數最多的政黨勝選。" },
        { art: "district-gerry", title: "集中與打散", text: "把對手的票倉圍進少數選區，或把他的支持者切進你小贏的選區，就算普選票落後也能贏。" }
      ],
      note: "選區小於最小選區（預設 2 格）時，選舉人票平分給所有政黨；區內平手也平分。",
      keys: [["點棋盤", "移到格線上預覽，點擊放置"], ["空白", "放棄並跳過"], ["1～3", "選候選池裡的牆塊"], ["Z", "悔棋"], ["H", "提示"], ["Esc", "關閉視窗"]]
    },
    en: {
      goal: "Cut the map into districts with walls. The party with the most electoral votes wins.",
      steps: [
        { art: "district-map", title: "Cells are towns, dots are voters", text: "Each dot is a voter (1 dot = 1 vote). The color shows who leads there; darker means a bigger lead." },
        { art: "district-walls", title: "Place walls to cut districts", text: "Take turns placing I4, S4 and T4 walls. The border and coastline are walls too, so new walls can't run along them or overlap." },
        { art: "district-win", title: "Winner takes all", text: "In each district the party with the most votes takes all its electoral votes. The most electoral votes wins the game." },
        { art: "district-gerry", title: "Packing and cracking", text: "Pack the opponent's strongholds into a few districts, or crack their voters across districts you win narrowly, and you can win while behind in total votes." }
      ],
      note: "Districts smaller than the minimum size (default 2 cells) split their electoral votes evenly among all parties; so do tied districts.",
      keys: [["Board", "Hover on grid lines to preview, click to place"], ["Space", "Discard this wall"], ["1-3", "Pick a wall from the pool"], ["Z", "Undo"], ["H", "Hint"], ["Esc", "Close dialog"]]
    },
    ja: {
      goal: "壁で地図を選挙区に区切り、選挙人票が最も多い政党が勝ちです。",
      steps: [
        { art: "district-map", title: "マスは地域、点は有権者", text: "点は有権者（1点＝1票）。色はその地域で優勢な政党で、濃いほど差が大きいです。" },
        { art: "district-walls", title: "壁を置いて選挙区を作る", text: "I4・S4・T4の壁を順に置きます。外枠と海岸線も壁なので、沿って置いたり重ねたりはできません。" },
        { art: "district-win", title: "勝者総取り", text: "各選挙区で最多得票の政党がその区の選挙人票を全て獲得します。合計が最多の政党の勝ちです。" },
        { art: "district-gerry", title: "集中と分断", text: "相手の票田を少数の選挙区に閉じ込める、または支持者を自分が僅差で勝つ区に分ければ、得票数で負けても勝てます。" }
      ],
      note: "最小選挙区（初期値2マス）より小さい区と、同数の区は、選挙人票を全政党で等分します。",
      keys: [["盤面", "格子線に合わせてプレビュー、クリックで設置"], ["Space", "この壁を捨てる"], ["1～3", "候補の壁を選ぶ"], ["Z", "取り消し"], ["H", "ヒント"], ["Esc", "ダイアログを閉じる"]]
    }
  },

  whowins: {
    zh: {
      goal: "骰子決定步數，終局時勢力範圍最大的一方獲勝。",
      steps: [
        { art: "dice-roll", title: "每回合擲 1 顆骰子", text: "點數 D 就是這一步要走滿的步數。黑棋朝左、上進攻，白棋朝右、下進攻。" },
        { art: "dice-spawn", title: "生子", text: "選一顆己方棋，走滿 D 步到空格，原棋保留，目標格生出一顆新棋。途中可穿過友軍。" },
        { art: "dice-capture", title: "吃子", text: "像象棋的車，只能直線走滿 D 步，剛好停在敵棋上就吃掉它。原本的格子會變空。" },
        { art: "dice-pass", title: "PASS 與終局", text: "沒步可走就 PASS，對手可免骰指定 1～6 步。雙方不可能再互吃時，自動結算勢力。" }
      ],
      keys: [["點棋子", "先點己方棋子，再點亮起的格子"], ["空白、R", "輪到你時擲骰子；CPU 在下時暫停、繼續"], ["← →", "上一手、下一手"], ["H", "提示：落點標出走下去的勝率"], ["1-6", "自選點數；研究模式指定這一手的點數"], ["Esc", "取消選取"]]
    },
    en: {
      goal: "The dice set how far you move. The side with the larger territory at the end wins.",
      steps: [
        { art: "dice-roll", title: "Roll one die each turn", text: "The result D is the exact number of steps you must take. Black attacks left/up, White attacks right/down." },
        { art: "dice-spawn", title: "Spawn", text: "Move a piece exactly D steps to an empty cell. The original stays and a new piece appears at the destination. You may pass through friends." },
        { art: "dice-capture", title: "Capture", text: "Like a rook: move in a straight line exactly D steps and land on an enemy to remove it. Your start cell becomes empty." },
        { art: "dice-pass", title: "PASS and the ending", text: "No legal move means PASS, and your opponent may choose any 1-6 without rolling. When nobody can capture anymore, territory is counted automatically." }
      ],
      keys: [["Click a piece", "Click your piece, then a highlighted cell"], ["Space, R", "Roll the die on your turn; pause / resume the CPU"], ["← →", "Previous / next move"], ["H", "Hint: win rate on each target square"], ["1-6", "Free pick of the die; study mode sets this turn's die"], ["Esc", "Deselect"]]
    },
    ja: {
      goal: "サイコロで進む歩数が決まり、最後に勢力が大きい方が勝ちです。",
      steps: [
        { art: "dice-roll", title: "毎ターン、サイコロを1つ振る", text: "出た目Dがちょうど進む歩数です。黒は左・上へ、白は右・下へ攻めます。" },
        { art: "dice-spawn", title: "増殖", text: "自分の駒をD歩進めて空きマスへ。元の駒は残り、目的地に新しい駒が増えます。味方は通り抜けできます。" },
        { art: "dice-capture", title: "取る", text: "ルークのように直線でD歩進み、ちょうど敵駒の上に止まると取れます。元のマスは空になります。" },
        { art: "dice-pass", title: "パスと終局", text: "動けなければパス。相手は振らずに1～6を選べます。互いに取れなくなると自動で勢力を集計します。" }
      ],
      keys: [["駒をクリック", "自分の駒、次に光ったマスをクリック"], ["Space、R", "自分の番はサイコロを振る、CPU対局中は一時停止・再開"], ["← →", "前の手、次の手"], ["H", "ヒント：着手先に勝率を表示"], ["1-6", "目の自選、研究モードでこの手の目を指定"], ["Esc", "選択解除"]]
    }
  }
};
