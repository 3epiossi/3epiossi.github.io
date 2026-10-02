/**
 * 🤖 骰子黑白棋 (Dice Othello) - AI 決策與教練服務 (AI Engine & Coach Service)
 * 統一管理 v1～v4 演算法呼叫、候選走法評比排序 (👑 🥈 🥉) 與人類可讀理由產生器
 */

import { BLACK, WHITE, MOVE_TYPE, AI_MODELS } from "../core/constants.js";
import { getAllLegalMoves, posToCoord, opp } from "../core/rules.js";
import { evaluateMoveV1 } from "./v1.js";
import { evaluateMoveV2 } from "./v2.js";
import { evaluateMoveV3 } from "./v3.js";
import { evaluateMoveV4 } from "./v4.js";
import { evaluateMoveV5 } from "./v5.js";
import { countThreatsToSquare } from "./evaluator.js";
import { tr } from "../i18n.js";

/**
 * 根據指定演算法評估單步走法
 */
export function evaluateSingleMove(board, move, player, algo = "v4") {
  if (algo === "v1") return evaluateMoveV1(board, move, player);
  if (algo === "v2") return evaluateMoveV2(board, move, player);
  if (algo === "v3") return evaluateMoveV3(board, move, player);
  if (algo === "v5") return evaluateMoveV5(board, move, player);
  return evaluateMoveV4(board, move, player);
}

/**
 * 產生走法的人類可讀理由與戰術優缺點分析 (Move Explanation)
 */
export function generateMoveExplanation(board, move, player, evalInfo) {
  const fromCoord = posToCoord(move.fromR != null ? move.fromR : move.from.r, move.fromC != null ? move.fromC : move.from.c);
  const toCoord = posToCoord(move.toR != null ? move.toR : move.to.r, move.toC != null ? move.toC : move.to.c);
  const isCapture = move.type === MOVE_TYPE.CAPTURE;
  const targetR = move.toR != null ? move.toR : move.to.r;
  const targetC = move.toC != null ? move.toC : move.to.c;

  const pros = [];
  const cons = [];
  let summary = "";

  if (isCapture) {
    pros.push(tr("exCapture", { to: toCoord }));
    if (evalInfo && evalInfo.escapeBonus > 0) {
      pros.push(tr("exEscape", { from: fromCoord }));
    }
  } else {
    pros.push(tr("exSpawn", { to: toCoord }));
    if (evalInfo && evalInfo.marginalGain > 0) {
      pros.push(tr("exGain", { n: evalInfo.marginalGain }));
    }
    if (evalInfo && evalInfo.suppression > 0) {
      pros.push(tr("exSuppress", { n: evalInfo.suppression }));
    }
  }

  // 檢查落子安全性 (是否在對手直線射程內)
  const threats = countThreatsToSquare(board, targetR, targetC, player);
  if (threats === 0) {
    pros.push(tr("exSafe"));
  } else if (threats === 1) {
    cons.push(tr("exThreat1"));
  } else {
    cons.push(tr("exThreatN", { n: threats }));
  }

  if (evalInfo && evalInfo.forcedPassCount > 0) {
    pros.push(tr("exForced", { n: evalInfo.forcedPassCount }));
  }

  const diceHint = move.usedDiceVal != null ? " " + tr("needSteps", { n: move.usedDiceVal }) : "";
  if (isCapture) {
    summary = tr("sumCapture", { from: fromCoord, to: toCoord, dice: diceHint });
  } else {
    summary = tr("sumSpawn", { from: fromCoord, to: toCoord, dice: diceHint });
  }

  return {
    summary,
    pros,
    cons,
    score: evalInfo ? evalInfo.score : 0,
    threats
  };
}

/**
 * 評估當前所有合法走法，並輸出前 N 名候選排行榜 (Candidate Ranking)
 */
export function rankCandidateMoves(board, player, dice, algo = "v4", topN = 3) {
  let candidates = [];
  if (dice != null) {
    const legal = getAllLegalMoves(board, player, dice);
    candidates = legal.spawns.concat(legal.captures).map((m) => ({ ...m, usedDiceVal: dice }));
  } else {
    // 跨 1~6 步全面遍歷所有可能走法 (供未擲骰局面或復盤分析使用)
    for (let d = 1; d <= 6; d++) {
      const legal = getAllLegalMoves(board, player, d);
      const moves = legal.spawns.concat(legal.captures).map((m) => ({ ...m, usedDiceVal: d }));
      candidates.push(...moves);
    }
  }

  if (candidates.length === 0) return [];

  const screenAlgo = algo === "v5" ? "v4" : algo;
  const evaluated = candidates.map((m) => {
    const evalInfo = evaluateSingleMove(board, m, player, screenAlgo);
    const explanation = generateMoveExplanation(board, m, player, evalInfo);
    return {
      move: m,
      evalInfo,
      explanation,
      score: evalInfo.score
    };
  });

  // 按分數由大至小排序
  evaluated.sort((a, b) => b.score - a.score);

  if (algo === "v5" && evaluated.length > 1) {
    const reEvalN = Math.min(5, evaluated.length);
    const top = evaluated.slice(0, reEvalN);
    for (let i = 0; i < reEvalN; i++) {
      const deepEval = evaluateMoveV5(board, top[i].move, player);
      top[i].evalInfo = deepEval;
      top[i].score = deepEval.score;
      top[i].explanation = generateMoveExplanation(board, top[i].move, player, deepEval);
    }
    top.sort((a, b) => b.score - a.score);
    for (let i = 0; i < reEvalN; i++) evaluated[i] = top[i];
  }

  // 加上排名徽章
  const badges = [tr("rank1"), tr("rank2"), tr("rank3")];
  return evaluated.slice(0, topN).map((item, idx) => ({
    ...item,
    rank: idx + 1,
    rankBadge: badges[idx] || `#${idx + 1}`
  }));
}

/**
 * 尋找 CPU 最佳下子 (支援 tie-break 與回傳完整候選清單)
 */
export function findBestMoveForCPU(board, player, dice, algo = "v4") {
  const ranked = rankCandidateMoves(board, player, dice, algo, 64);
  if (ranked.length === 0) return null;

  const maxScore = ranked[0].score;
  const bestList = ranked.filter(x => x.score === maxScore);
  const chosenItem = bestList[Math.floor(Math.random() * bestList.length)];

  return {
    chosen: chosenItem.move,
    evalInfo: chosenItem.evalInfo,
    explanation: chosenItem.explanation,
    maxScore,
    totalCount: ranked.length,
    algo,
    topCandidates: ranked.slice(0, 3)
  };
}
