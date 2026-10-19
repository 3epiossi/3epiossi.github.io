/**
 * 遊戲清單與切換器的多語文字（純資料，沒有 DOM 依賴，tests/games.test.js 會檢查）。
 * path 與 academy 相對於專案根目錄。
 */

export const LANGS = ["zh", "en", "ja"];

/** 遊戲清單：path 與 academy 相對於專案根目錄 */
export const GAMES = [
  { id: "five", path: "index.html", academy: "five/learn.html" },
  { id: "district", path: "district/index.html", academy: "district/learn.html" },
  { id: "whowins", path: "whowins/index.html", academy: "tutorial.html" }
];

export const TEXT = {
  zh: {
    menuTitle: "切換遊戲",
    academy: "規則學院",
    current: "目前",
    names: { five: "五連黑白棋", district: "傑利蠑螈", whowins: "誰會贏？" },
    taglines: {
      five: "4 組棋子，同一組連成五顆就獲勝",
      district: "用牆把地圖切成選區，贏者全拿",
      whowins: "骰子決定步數的增殖黑白棋"
    }
  },
  en: {
    menuTitle: "Switch game",
    academy: "Rules Academy",
    current: "Current",
    names: { five: "Flush Othello", district: "Gerrymander", whowins: "Who will win?" },
    taglines: {
      five: "Four groups of discs. Five of one group wins",
      district: "Cut the map into districts with walls. Winner takes all",
      whowins: "Othello where the dice decide how far you move"
    }
  },
  ja: {
    menuTitle: "ゲームを切り替え",
    academy: "ルール道場",
    current: "現在",
    names: { five: "五連オセロ", district: "ジェリーマンダー", whowins: "誰が勝つ？" },
    taglines: {
      five: "4つのグループ。同じグループで5連なら勝ち",
      district: "壁で地図を選挙区に区切る。勝者総取り",
      whowins: "サイコロで歩数が決まる増殖オセロ"
    }
  }
};

