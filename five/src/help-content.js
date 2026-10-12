/**
 * 📖 使用說明（「說明」視窗的第二個分頁）：畫面、操作、威脅連線、勝率、走法標記、AI 教練、設定。
 * 內容較長，所以不放在 i18n.js；各語言一份 HTML。走法標記的色塊與棋盤上的標記同色（見 win-chart.js 的 MARK_COLOR）。
 */

const MARK = { "!!": "#1baca6", "!": "#22a06b", "!?": "#4f8cdb", "?!": "#ca8a04", "?": "#f59e0b", "??": "#dc2626" };
const badge = (sym) => `<span class="helpMark" style="background:${MARK[sym]}">${sym}</span>`;
const kbd = (k) => `<kbd>${k}</kbd>`;
const section = (title, body) => `<section class="helpSection"><h3>${title}</h3>${body}</section>`;
const markTable = (rows) => `<table class="helpMarks">${rows.map(([s, name, text]) => `<tr><td>${badge(s)}</td><td><b>${name}</b></td><td>${text}</td></tr>`).join("")}</table>`;

const ZH = [
  section("畫面", `<ul>
    <li><b>玩家卡</b>（棋盤上方）：名稱、「我」或「CPU 幾級」、目前的棋子數。輪到誰，誰的卡會亮起來。點「我 ▾ / CPU ▾」可以切換由你下或交給 CPU，以及 CPU 的難度（1～7 級，越高越強）；點名稱可以改名。</li>
    <li><b>勝率條</b>（棋盤左邊）：白方在上、黑方在下，數字是目前局面雙方的勝率。</li>
    <li><b>選組別</b>（棋盤右邊，手機在下方）：4 組棋（雙方共用），每組左上角是還剩幾顆，用完的組別會變淡。</li>
    <li><b>狀態列</b>：現在輪到誰、該做什麼。左邊的色帶：藍＝輪到你、紫＝CPU 思考中、橘＝暫停或正在看歷史、灰＝棋局結束。</li>
    <li><b>操作列</b>：新局、${kbd("⏮")} ${kbd("◀")} ${kbd("▶")} ${kbd("⏭")}（第一手／上一手／下一手／最新一手）、💡 提示、▶ CPU 對下（雙方都交給 CPU，之後可以暫停或繼續）。手機上這列固定在畫面底部。</li>
    <li><b>勝率走勢</b>（右欄，手機在下方）：整盤棋的勝率變化，見下面「勝率與勝率走勢」。</li>
  </ul>`),
  section("怎麼下", `<ul>
    <li>點有綠點的格子就落子。標 ★5 的格子，下了就直接連成五。</li>
    <li><b>選組別</b>：還沒選組別時，點一下可下的格子，格子上會顯示第 1 組（右下角標「1/4」）；再點一下換下一組，依序循環。<b>按住那一格不放</b>（約半秒，棋子外圍的虛線圈被黃色填滿，同時一根指針順時針掃過，掃過的地方棋子變成不透明、放大並發光）就下目前顯示的那組；點別的地方（包括其他格子）就不下在這格。也可以先點右邊的組別（或按 ${kbd("1")}～${kbd("4")}）再點格子；選組別中按 ${kbd("1")}～${kbd("4")} 或點組別，就直接下在那格。<b>開著 💡 提示時</b>：滑鼠移到格子上會預覽這格勝率最高的那組，點一下格子就直接下（手機上點一下就下）；先選了某一組的話，就用你選的。</li>
    <li><b>快捷鍵</b>：${kbd("1")}～${kbd("4")} 選第幾組、${kbd("←")} ${kbd("→")} 上一手／下一手、${kbd("空白鍵")} 暫停／繼續 CPU、${kbd("H")} 開關提示。</li>
    <li>沒有地方可下時會自動跳過（PASS）。</li>
    <li><b>開局</b>：按「新局」時可以選<b>標準</b>，或 <b>XOT 隨機開局</b>：系統隨機替雙方下好前 6～10 手，雙方勝率都在 50% ± 5% 以內，背不了定石，從第一手就要靠計算和大局觀。會記住上次選的。</li>
  </ul>`),
  section("威脅連線", `<ul>
    <li>同一條直線上出現「三」（3 顆同一組，旁邊 2 格空著）或「四」（4 顆，只剩 1 格），會畫出那一組顏色的線，「四」的線比較粗。不分黑白，因為棋子還可能被翻面（翻面只換顏色，組別不變）。</li>
    <li>「四」的缺口（再補一顆就連成五的空格）會畫虛線框，裡面的小棋表示<b>哪一方下在那裡真的能連成五</b>：白棋、黑棋，或半白半黑（雙方都可以）。雙方都連不成的缺口不畫。</li>
    <li><b>花五</b>：5 顆同一組已經排成一直線，可是黑白混在一起，所以還不算贏。會用一條那一組顏色的鐵鍊串起來。哪一方把另一色的棋全部翻過來，就立刻連成五獲勝，要特別注意。</li>
    <li>在連線裡的棋，字會加上那一組顏色的底線。滑鼠移到某一條連線，只突顯那一條。</li>
  </ul>`),
  section("勝率與勝率走勢", `<ul>
    <li>勝率是引擎估計的，只是參考。輪到你、還沒下的時候，引擎會繼續往下算，勝率條、提示和走法標記會跟著變得更準。</li>
    <li>勝率走勢：白方在上、黑方在下，每一手一個點；有走法標記的點會用標記的顏色畫大一點。滑鼠移上去可以看那一手的紀錄、標記和原因。</li>
    <li>點圖上任一手就回到那時的局面。在歷史局面直接下棋，會岔出一條分支（分支研究：雙方都由你下）；退回分岔點或更早，分支就結束，回到原本的對局。</li>
    <li>看歷史（或分支研究）時按「<b>從這裡繼續下</b>」：這一步變成最新一步，之後的棋譜刪掉，座位換回原本的設定，接著正常下棋。</li>
  </ul>`),
  section("走法標記", `<p>每一手下完，那顆棋的右上角可能出現標記，雙方的棋都會評。滑鼠移到標記上會顯示原因，例如「局勢從優勢變成拉鋸（最佳：E3 ♥）」，最佳那一步會寫出格子和組別。</p>
    <p>局勢分五級：<b>勝定</b>、<b>優勢</b>、<b>拉鋸</b>、<b>劣勢</b>、<b>敗定</b>。</p>
    ${markTable([
      ["!!", "反殺", "連續好幾手都被壓著打（往前三個局面勝率都在 35% 以下），這一步突然翻成很好（75% 以上），而且只有這一步做得到（其他格子都差 25% 以上）。"],
      ["!", "唯一手", "最好的一步，其他格子都差一截（10% 以上），局勢沒有變差；而且不是被對方逼出來的明顯應手（只看盤面、或多想兩手就看得出來的不算）。"],
      ["!?", "強迫手", "不一定是最好的一步，但下完後對手只剩一個好格子，其他格子都差很多（20% 以上）。做出「四」逼對手擋的不算。"],
      ["?!", "不精確", "比最佳的一步少了將近三成的勝率。"],
      ["?", "失誤", "局勢掉了一級，而且勝率少了四成半以上。"],
      ["??", "大漏著", "局勢掉了兩級以上，而且勝率少了八成以上（例如從快贏變成快輸）。"]
    ])}
    <ul>
      <li>不標的情況：勝負已經分出來的局面、只有一格可下、直接連成五的那一步。下在最佳的格子（或下的當下提示顯示的最佳格）不會被標失誤，組別選得不同也一樣。原本已經快贏的局面不標好手；終盤（剩 7 格以內）只標反殺。</li>
      <li>標記要等更完整的分析確認，通常晚一兩秒出現；偶爾出現後又改變，是因為更準的分析到了。</li>
    </ul>`),
  section("AI 教練（提示）", `<ul>
    <li>按「💡 提示」打開。每個可下的格子會顯示「這格配最好的那一組」的勝率，最高的那格有框。</li>
    <li>滑鼠移到格子上，右邊每一組旁邊會顯示它下在這格的勝率。點某一組可以固定看那一組在各格的勝率。</li>
    <li>數字很淡表示還在算；你還在想的時候引擎會繼續往下算，算得夠深（約 3 倍思考時間）數字就會變清楚，之後也可能小幅更新。</li>
    <li>教練的思考時間是「AI 思考時間」的兩倍，跟 7 級 CPU 差不多強。開著提示時，CPU 落子之前就會先替你算，所以通常很快出現。</li>
  </ul>`),
  section("設定", `<ul>
    <li><b>AI 思考時間</b>：越長越準，但要等比較久。6、7 級 CPU 每步想這麼久，勝率條至少分析這麼久，AI 教練用兩倍的時間。1～5 級 CPU 不受影響。</li>
    <li><b>下棋節奏</b>：CPU 落子的快慢（慢／正常／快／極速），只影響看起來的速度，不影響棋力和分析。極速不播動畫和落子音效，適合快轉看結果。CPU 對下時切到別的分頁會自動暫停。</li>
    <li><b>遊戲音效</b>、<b>雙方名稱</b>、<b>棋盤主題</b>。</li>
    <li><b>棋子文字</b>：4 組各一個，預設是撲克牌的四個花色 ♠ ♥ ♦ ♣（連線顏色：♠ 金黃、♥ 血紅、♦ 水藍、♣ 葉綠），也可以換成希臘字母 α β γ δ，或自訂 4 個不同的字（中文、英文、日文都行）。</li>
    <li><b>棋子顏色與文字顏色</b>：黑白棋子各自的寶石顏色，以及棋上文字的顏色。「還原預設外觀」可以全部改回來。</li>
  </ul>`),
  section("其他", `<ul>
    <li><b>匯出棋譜</b>（勝率走勢右上角）：把目前這條線存成 JSON 檔，裡面有每一手的局面、走法標記和勝率。電腦版 Chrome、Edge 可以自己選要存在哪個資料夾（預設是「下載」，下次會從上次的資料夾開始）；手機會跳出分享選單，可以存到「檔案」或雲端硬碟；其他瀏覽器存到下載資料夾。</li>
    <li><b>自動存檔</b>：對局（包括分支）會存在這個瀏覽器裡，重新整理或關掉頁面再打開，會接著上次的局面。按「新局」才會清掉。</li>
    <li><b>語言</b>：右上角可以切換中文、English、日本語。</li>
    <li>設定也會記在這台電腦的瀏覽器裡。</li>
    <li>頁尾有另一個遊戲「誰會贏？」。</li>
  </ul>`)
];

const EN = [
  section("The screen", `<ul>
    <li><b>Player cards</b> (above the board): name, "Me" or "CPU level", and disc count. The card of the side to move lights up. Click "Me ▾ / CPU ▾" to switch between playing yourself and letting the CPU play, and to set the CPU level (1–7, higher is stronger); click a name to rename it.</li>
    <li><b>Win bar</b> (left of the board): White on top, Black at the bottom, with each side's current win chance.</li>
    <li><b>Groups</b> (right of the board, below it on phones): the 4 groups of discs both sides share; the top-left number is how many are left, and a used-up group fades out.</li>
    <li><b>Status line</b>: whose turn it is and what to do. The colour on the left: blue = your turn, purple = CPU thinking, orange = paused or viewing history, grey = game over.</li>
    <li><b>Action bar</b>: New game, ${kbd("⏮")} ${kbd("◀")} ${kbd("▶")} ${kbd("⏭")} (first / previous / next / latest move), 💡 Hints, ▶ CPU vs CPU (pause and resume afterwards). On phones it stays at the bottom of the screen.</li>
    <li><b>Win-chance chart</b> (right column, below on phones): see "Win chance and the chart" below.</li>
  </ul>`),
  section("Playing", `<ul>
    <li>Click a square with a green dot to play there. A square marked ★5 makes five in a row straight away.</li>
    <li><b>Choosing a group</b>: without a chosen group, click a playable square and it previews the first group (marked “1/4” in the corner); click again for the next one, cycling round. <b>Press and hold</b> that square (about half a second; the dashed circle around the disc fills up in yellow while a sweeping hand makes the disc opaque, bigger and glowing as it passes) to play the group shown; click anywhere else (including another square) to cancel. You can also click a group first (or press ${kbd("1")}–${kbd("4")}) and then a square; while trying groups, pressing ${kbd("1")}–${kbd("4")} or clicking a group plays it there. <b>With 💡 Hints on</b>: hovering a square previews its best group and a single click plays it (a single tap on a phone); if you picked a group first, that one is used.</li>
    <li><b>Shortcuts</b>: ${kbd("1")}–${kbd("4")} pick a group, ${kbd("←")} ${kbd("→")} previous / next move, ${kbd("Space")} pause / resume the CPU, ${kbd("H")} toggle hints.</li>
    <li>With no legal move you pass automatically.</li>
    <li><b>Opening</b>: when you press "New game" you can choose <b>Standard</b> or <b>XOT random opening</b> — 6–10 random moves are already played for both sides, chosen so both sides' win chances are within 50% ± 5%; no memorised openings. Your last choice is remembered.</li>
  </ul>`),
  section("Threat lines", `<ul>
    <li>A "three" (3 discs of one group with 2 empty squares) or a "four" (4 discs, 1 empty square) on a line is drawn in that group's colour; fours are thicker. Black and white are ignored because discs can still be flipped (flipping changes the colour, never the group).</li>
    <li>The gap of a four (the empty square that would complete five) gets a dashed box, and the small disc inside shows <b>which side can really make five there</b>: White, Black, or half and half (both). Gaps nobody can complete are not drawn.</li>
    <li><b>Mixed five</b>: 5 discs of one group already stand in a line, but black and white are mixed, so nobody has won yet. It is bound by a chain in the group's colour. Whoever flips the other colour's discs in it to their own colour makes five and wins at once, so keep an eye on it.</li>
    <li>Discs in a line get an underline in the group's colour. Hover a line to highlight just that line.</li>
  </ul>`),
  section("Win chance and the chart", `<ul>
    <li>Win chances are the engine's estimate and only a guide. While it is your turn and you are still thinking, the engine keeps analysing, so the bar, hints and move marks become more accurate.</li>
    <li>The chart shows White on top and Black at the bottom, one dot per move; moves with a mark get a larger dot in the mark's colour. Hover to see the move, its mark and the reason.</li>
    <li>Click any move to go back to it. Playing a move from a past position starts a branch (study mode: you play both sides); going back to the fork or earlier ends the branch and returns to the game.</li>
    <li>While viewing history (or studying a branch), press "<b>Continue from here</b>": this move becomes the latest, later moves are deleted, the seats go back to your settings, and the game carries on normally.</li>
  </ul>`),
  section("Move marks", `<p>After each move a mark may appear at the disc's top-right corner, for both sides. Hover it to see why, e.g. "Position went from ahead to balanced (best: E3 ♥)" — the best move names a square and a group.</p>
    <p>Positions come in five levels: <b>won</b>, <b>ahead</b>, <b>balanced</b>, <b>behind</b>, <b>lost</b>.</p>
    ${markTable([
      ["!!", "Turnaround", "You had been under pressure for several moves (the last three positions all at 35% or less) and this move suddenly makes it strong (75% or more) — and it is the only move that does (every other square is at least 25% worse)."],
      ["!", "Only move", "The best move, with every other square clearly worse (10% or more), and the position does not get worse — and it is not an obvious forced reply (one you can see from the board or by looking two moves ahead)."],
      ["!?", "Forcing move", "Not necessarily the best move, but afterwards the opponent has only one good square and everything else is much worse (20% or more). Making a four that must be blocked does not count."],
      ["?!", "Inaccuracy", "Gives away nearly 30% win chance compared with the best move."],
      ["?", "Mistake", "The position drops one level and loses 45% or more win chance."],
      ["??", "Blunder", "The position drops two levels or more and loses 80% or more win chance (e.g. from nearly won to nearly lost)."]
    ])}
    <ul>
      <li>No mark when: the game is already decided, there is only one legal square, or the move makes five. Playing the best square (or the square the hint showed as best when you moved) is never marked as a mistake, even with a different group. No good-move marks when you were already nearly winning; in the endgame (7 or fewer empty squares) only turnarounds are marked.</li>
      <li>Marks wait for a more thorough analysis, so they usually appear a second or two later; occasionally a mark changes once a more accurate analysis arrives.</li>
    </ul>`),
  section("AI coach (hints)", `<ul>
    <li>Press "💡 Hints". Each legal square shows the win chance of its best group; the best square is outlined.</li>
    <li>Hover a square to see each group's win chance there. Click a group to see that group's win chance on every square.</li>
    <li>Faint numbers are still being worked out. The engine keeps going while you think, and the numbers turn solid once it has gone deep enough (about 3× the thinking time); they may still update slightly afterwards.</li>
    <li>The coach thinks for twice the AI thinking time, so it is about as strong as the Level 7 CPU. With hints on it starts working on your position before the CPU's move lands, so hints usually appear quickly.</li>
  </ul>`),
  section("Settings", `<ul>
    <li><b>AI thinking time</b>: longer is more accurate but slower. The Level 6 and 7 CPUs think this long per move, the win bar analyses at least this long, and the AI coach uses twice as long. Levels 1–5 are not affected.</li>
    <li><b>Game pace</b>: how quickly the CPU plays (slow / normal / fast / instant). It only changes how fast things look, not strength or analysis. Instant skips animations and stone sounds, handy for fast-forwarding. CPU vs CPU pauses itself when you switch to another tab.</li>
    <li><b>Sound</b>, <b>player names</b>, <b>board theme</b>.</li>
    <li><b>Symbols on the discs</b>: one per group: card suits ♠ ♥ ♦ ♣ by default (line colours: ♠ gold, ♥ blood red, ♦ water blue, ♣ leaf green), or Greek letters α β γ δ, or any 4 different characters of your own.</li>
    <li><b>Disc and symbol colours</b>: a gem colour for each side and the colour of the symbols on them. "Restore defaults" brings back the default look.</li>
  </ul>`),
  section("Other", `<ul>
    <li><b>Export record</b> (top right of the chart): saves the current line as a JSON file with every position, move mark and win chance. In desktop Chrome and Edge you choose the folder (Downloads by default, and next time it starts in the folder you used last); on phones a share sheet opens so you can save to Files or a cloud drive; other browsers save to the Downloads folder.</li>
    <li><b>Auto-save</b>: the game (including branches) is kept in this browser. Reload or reopen the page and you continue where you left off. Only “New game” clears it.</li>
    <li><b>Language</b>: switch between 中文, English and 日本語 at the top right.</li>
    <li>Settings are kept in this browser too.</li>
    <li>Another game, "Who will win?", is linked at the bottom of the page.</li>
  </ul>`)
];

const JA = [
  section("画面", `<ul>
    <li><b>プレイヤーカード</b>（盤の上）：名前、「自分」または「CPU のレベル」、石の数。手番の側のカードが光ります。「自分 ▾ / CPU ▾」をクリックすると、自分で打つか CPU に任せるか、CPU の強さ（1～7、高いほど強い）を切り替えられます。名前をクリックすると名前を変えられます。</li>
    <li><b>勝率バー</b>（盤の左）：白が上、黒が下で、現在の局面の両者の勝率を表示します。</li>
    <li><b>組を選ぶ</b>（盤の右、スマホでは下）：両者共通の 4 組の石。左上の数字は残り枚数で、使い切った組は薄くなります。</li>
    <li><b>ステータス行</b>：手番とやること。左の色帯：青＝あなたの番、紫＝CPU 思考中、橙＝一時停止中または履歴を表示中、灰＝対局終了。</li>
    <li><b>操作バー</b>：新規対局、${kbd("⏮")} ${kbd("◀")} ${kbd("▶")} ${kbd("⏭")}（最初／1 手戻る／1 手進む／最新）、💡 ヒント、▶ CPU 同士（あとで一時停止・再開できます）。スマホでは画面下に固定されます。</li>
    <li><b>勝率の推移</b>（右の欄、スマホでは下）：下の「勝率と勝率の推移」を参照。</li>
  </ul>`),
  section("打ち方", `<ul>
    <li>緑の点があるマスをクリックすると打てます。★5 のマスは打つとすぐ五連になります。</li>
    <li><b>組の選択</b>：組を選んでいないとき、打てるマスを 1 回クリックすると 1 組目がプレビューされます（右下に「1/4」）。もう一度クリックで次の組へ（順に循環）。<b>そのマスを長押し</b>（約 0.5 秒、石の周りの点線の円が黄色で満ち、針が時計回りに掃くように石が不透明になり、大きく光ります）すると表示中の組を打ちます。他の場所（他のマスを含む）をクリックするとこのマスには打ちません。先に右の組をクリック（または ${kbd("1")}～${kbd("4")}）してからマスをクリックしても打てます。試している間に ${kbd("1")}～${kbd("4")} か組をクリックすると、その組をそこに打ちます。<b>💡 ヒントがオンのとき</b>：マスにマウスを乗せるとそのマスで勝率最高の組がプレビューされ、1 回クリックでそれを打ちます（スマホでは 1 回タップ）。先に選んだ組があればそれを使います。</li>
    <li><b>ショートカット</b>：${kbd("1")}～${kbd("4")} 組を選ぶ、${kbd("←")} ${kbd("→")} 1 手戻る／進む、${kbd("スペース")} CPU の一時停止／再開、${kbd("H")} ヒントの切り替え。</li>
    <li>打てる場所がないときは自動でパスします。</li>
    <li><b>開局</b>：「新規対局」を押したときに <b>標準</b> か <b>XOT ランダム開局</b> を選べます。XOT は両者の勝率が 50% ± 5% に収まるランダムな 6～10 手が打たれた状態から始まり、定石は使えません。前回の選択を覚えています。</li>
  </ul>`),
  section("脅威ライン", `<ul>
    <li>一直線上に「三」（同じ組の石 3 枚と空き 2 マス）や「四」（4 枚と空き 1 マス）ができると、その組の色で線を引きます。四の線は太めです。石はまだ裏返る可能性があるので（裏返しで変わるのは色だけで、組は変わりません）、白黒は区別しません。</li>
    <li>四の空き（あと 1 枚で五連になるマス）には点線の枠を描き、中の小さな石で<b>どちらがそこに打つと本当に五連になるか</b>を示します：白、黒、または半分ずつ（両方）。どちらも五連にできない空きは描きません。</li>
    <li><b>混色の五</b>：同じ組の石 5 枚がすでに一直線に並んでいるのに、白黒が混ざっているのでまだ勝ちではありません。その組の色の鎖でつなぎます。もう一方の色の石を全部自分の色に裏返した側が、その場で五連になって勝つので要注意です。</li>
    <li>ラインに入っている石の文字には、その組の色の下線が付きます。ラインにマウスを乗せると、そのラインだけが強調されます。</li>
  </ul>`),
  section("勝率と勝率の推移", `<ul>
    <li>勝率はエンジンの見積もりで、あくまで目安です。あなたの番で考えている間もエンジンは計算を続けるので、勝率バー・ヒント・評価記号はだんだん正確になります。</li>
    <li>グラフは白が上・黒が下で、1 手に 1 つの点。評価記号の付いた手は、その色で大きめの点になります。マウスを乗せると、その手の記録・記号・理由が見られます。</li>
    <li>グラフの任意の手をクリックするとその局面に戻ります。過去の局面から打つと分岐（研究モード：両方を自分で打つ）になり、分岐点かそれより前に戻ると分岐は終わり、元の対局に戻ります。</li>
    <li>履歴（または分岐の研究）を見ているときに「<b>ここから続ける</b>」を押すと、この手が最新の手になり、以降の棋譜は削除され、席は元の設定に戻って通常の対局を続けます。</li>
  </ul>`),
  section("評価記号", `<p>各手のあと、その石の右上に記号が付くことがあります（両者の手が対象）。記号にマウスを乗せると理由が表示されます。例：「形勢が優勢から互角に（最善：E3 ♥）」。最善手はマスと組で示されます。</p>
    <p>形勢は 5 段階です：<b>勝ち確定</b>、<b>優勢</b>、<b>互角</b>、<b>劣勢</b>、<b>負け確定</b>。</p>
    ${markTable([
      ["!!", "逆転の一手", "何手も押され続けていた（直前 3 局面の勝率がすべて 35% 以下）のを、この一手で一気に良い形勢（75% 以上）に変える。しかもそれができるのはこの手だけ（他のマスはすべて 25% 以上悪い）。"],
      ["!", "唯一手", "最善手で、他のマスはすべてはっきり悪く（10% 以上）、形勢も悪くならない。しかも相手に強いられた明らかな応手ではない（盤面を見るだけ、または 2 手先まで読めば分かる手は除く）。"],
      ["!?", "強制手", "最善とは限らないが、打ったあと相手には良いマスが 1 つしかなく、他はすべて大きく悪い（20% 以上）。四を作って止めさせる手は除く。"],
      ["?!", "緩手", "最善手より勝率を 3 割近く失った。"],
      ["?", "悪手", "形勢が 1 段階下がり、勝率を 4.5 割以上失った。"],
      ["??", "大悪手", "形勢が 2 段階以上下がり、勝率を 8 割以上失った（勝ち寸前から負け寸前など）。"]
    ])}
    <ul>
      <li>記号を付けない場合：勝敗がすでに決まっている、打てるマスが 1 つだけ、その手で五連になる。最善のマス（または打った時点でヒントが最善と示したマス）に打った手は、組が違っても悪手にはなりません。すでに勝ち寸前の局面では好手記号を付けず、終盤（空き 7 マス以内）は逆転の一手だけに付けます。</li>
      <li>記号はより詳しい分析で確認してから付くので、たいてい 1～2 秒遅れて表示されます。より正確な分析が届いて記号が変わることもあります。</li>
    </ul>`),
  section("AI コーチ（ヒント）", `<ul>
    <li>「💡 ヒント」でオン。打てるマスごとに、最善の組を打ったときの勝率を表示し、最も高いマスには枠が付きます。</li>
    <li>マスにマウスを乗せると、各組をそのマスに打ったときの勝率が表示されます。組をクリックすると、その組の各マスでの勝率を固定表示します。</li>
    <li>数字が薄いときはまだ計算中です。考えている間もエンジンは計算を続け、十分深くなると（思考時間の約 3 倍）はっきり表示されます。その後も少し更新されることがあります。</li>
    <li>コーチは「AI の思考時間」の 2 倍で考えるので、レベル7の CPU とほぼ同じ強さです。ヒントがオンのときは CPU が打つ前からあなたの局面を計算し始めるので、たいていすぐに表示されます。</li>
  </ul>`),
  section("設定", `<ul>
    <li><b>AI の思考時間</b>：長いほど正確ですが待ち時間も長くなります。レベル6・7の CPU は1手にこの時間考え、勝率バーは少なくともこの時間分析し、AI コーチは 2 倍の時間を使います。レベル1～5には影響しません。</li>
    <li><b>対局のテンポ</b>：CPU が石を置く速さ（遅い／標準／速い／最速）。見た目の速さだけが変わり、強さや分析には影響しません。最速はアニメーションと着手音を省くので、早送りに便利です。CPU 同士の対局は別のタブに切り替えると自動で一時停止します。</li>
    <li><b>効果音</b>、<b>両者の名前</b>、<b>盤のテーマ</b>。</li>
    <li><b>石の文字</b>：組ごとに 1 つ、既定はトランプのマーク ♠ ♥ ♦ ♣（ラインの色：♠ 金、♥ 血の赤、♦ 水色、♣ 葉の緑）。ギリシャ文字 α β γ δ や、異なる 4 文字を自分で指定することもできます。</li>
    <li><b>石の色と文字の色</b>：白黒それぞれの宝石の色と、石の上の文字の色。「デフォルトに戻す」で元に戻せます。</li>
  </ul>`),
  section("その他", `<ul>
    <li><b>棋譜を書き出す</b>（勝率の推移の右上）：今の手順を JSON ファイルに保存します。各局面・評価記号・勝率が入っています。パソコンの Chrome・Edge では保存先のフォルダを選べます（既定は「ダウンロード」、次回は前回のフォルダから）。スマホでは共有メニューが開き、「ファイル」やクラウドに保存できます。その他のブラウザはダウンロードフォルダに保存します。</li>
    <li><b>自動保存</b>：対局（分岐を含む）はこのブラウザに保存されます。再読み込みしたりページを開き直したりしても、前回の局面から続けられます。「新規対局」を押したときだけ消えます。</li>
    <li><b>言語</b>：右上で中文・English・日本語を切り替えられます。</li>
    <li>設定もこのブラウザに保存されます。</li>
    <li>ページの下に、もう一つのゲーム「誰が勝つ？」へのリンクがあります。</li>
  </ul>`)
];

const CONTENT = { zh: ZH, en: EN, ja: JA };

/** 目前語言的使用說明 HTML */
export function helpGuideHtml(lang) {
  return (CONTENT[lang] || ZH).join("");
}
