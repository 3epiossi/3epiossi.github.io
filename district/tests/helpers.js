/**
 * 劃區爭霸 (District) - 測試輔助模組
 */

import { GameEngine } from "../src/core/game-engine.js";
import { createPRNG } from "../src/core/map-generator.js";

export function createTestEngine(numPlayers = 2, seed = 42, options = {}) {
  return new GameEngine({
    numPlayers,
    seed,
    rng: createPRNG(seed),
    ...options
  });
}

