// ================================
// Dungeon Instruction Game — Lava Edition
// Auto-Run + Ghost Trail + Player Token
// ================================

console.log("app.js loaded");

// ----------------
// Element grabs
// ----------------
const gridEl = document.getElementById("grid");
const runBtn = document.getElementById("runBtn");
const stepBtn = document.getElementById("stepBtn"); // optional (can be hidden)
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const instructionsEl = document.getElementById("instructions");
const modeIndicatorEl = document.getElementById("modeIndicator");

const cmdF = document.getElementById("cmdF");
const cmdL = document.getElementById("cmdL");
const cmdR = document.getElementById("cmdR");
const cmdSTOP = document.getElementById("cmdSTOP");

// ----------------
// Level (6×6, 1..6 coords)
// ----------------
let level = {
  start: { row: 6, col: 1 },
  startFacing: "N",
  goal: { row: 1, col: 6 },
  lava: [
    // default layout (can be replaced by generator)
    { row: 5, col: 2 },
    { row: 4, col: 2 },
    { row: 3, col: 4 },
    { row: 2, col: 4 },
    { row: 2, col: 5 },
  ],
};

// ----------------
// Player state
// ----------------
let player = {
  row: level.start.row,
  col: level.start.col,
  facing: level.startFacing,
};

// ----------------
// Mode state machine
// ----------------
let mode = "EDITING"; // EDITING | RUNNING

function hasProgram() {
  return instructionsEl.value.trim().length > 0;
}

function setMode(nextMode) {
  mode = nextMode;
  modeIndicatorEl.textContent = mode;

  const editing = mode === "EDITING";
  const running = mode === "RUNNING";

  // Lock editing while running
  instructionsEl.readOnly = !editing;

  cmdF.disabled = !editing;
  cmdL.disabled = !editing;
  cmdR.disabled = !editing;
  cmdSTOP.disabled = !editing;

  runBtn.disabled = running || !hasProgram();
  if (stepBtn) stepBtn.disabled = running || !hasProgram();

  resetBtn.disabled = false;
}

// ----------------
// Parsing
// ----------------
function parseProgram() {
  const lines = instructionsEl.value
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const parsed = [];

  for (let i = 0; i < lines.length; i++) {
    const cmd = lines[i].toUpperCase();
    if (cmd === "F" || cmd === "L" || cmd === "R" || cmd === "STOP") {
      parsed.push(cmd);
    } else {
      return { error: `Unknown command '${lines[i]}' at line ${i + 1}` };
    }
  }

  return { program: parsed };
}

// ----------------
// Execution state
// ----------------
let program = [];
let ip = 0;
let programSource = "";
let timerId = null;

// Trails
let trailCurrent = new Set(); // "r,c"
let trailGhost = new Set();   // "r,c"

function keyOf(row, col) {
  return `${row},${col}`;
}

// ----------------
// Helpers: movement
// ----------------
function turnLeft(f) {
  if (f === "N") return "W";
  if (f === "W") return "S";
  if (f === "S") return "E";
  return "N";
}

function turnRight(f) {
  if (f === "N") return "E";
  if (f === "E") return "S";
  if (f === "S") return "W";
  return "N";
}

function forwardPosition(p) {
  if (p.facing === "N") return { row: p.row - 1, col: p.col };
  if (p.facing === "E") return { row: p.row, col: p.col + 1 };
  if (p.facing === "S") return { row: p.row + 1, col: p.col };
  return { row: p.row, col: p.col - 1 }; // W
}

function isInsideGrid(row, col) {
  return row >= 1 && row <= 6 && col >= 1 && col <= 6;
}

function isLava(row, col) {
  return level.lava.some(l => l.row === row && l.col === col);
}

// ----------------
// Grid creation (once) + tileAt
// ----------------
function initGrid() {
  gridEl.innerHTML = "";
  for (let row = 1; row <= 6; row++) {
    for (let col = 1; col <= 6; col++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.row = row;
      tile.dataset.col = col;
      gridEl.appendChild(tile);
    }
  }
}

function tileAt(row, col) {
  return gridEl.querySelector(`.tile[data-row="${row}"][data-col="${col}"]`);
}

// ----------------
// Paint level tiles (reusable)
// ----------------
function renderStaticElements() {
  gridEl.querySelectorAll(".tile").forEach(t => {
    t.classList.remove("lava", "wall", "start", "goal", "trigger");
  });

  // Paint triggers
  if (level.triggers) {
    level.triggers.forEach(({ row, col, active }) => {
      if (active !== false) { // render if not yet consumed/deactivated
        const t = tileAt(row, col);
        if (t) t.classList.add("trigger");
      }
    });
  }

  // Paint lava (add .wall too so it shows even if CSS lacks .lava)
  level.lava.forEach(({ row, col, hidden }) => {
    if (hidden) return; // Skip hidden lava
    const t = tileAt(row, col);
    if (t) {
      t.classList.add("lava");
      t.classList.add("wall"); // fallback styling
    }
  });

  tileAt(level.start.row, level.start.col)?.classList.add("start");
  tileAt(level.goal.row, level.goal.col)?.classList.add("goal");
}

// ----------------
// Trails rendering
// ----------------
function clearTrailClasses() {
  gridEl.querySelectorAll(".tile.trail").forEach(t => t.classList.remove("trail", "ghost"));
}

function renderTrails() {
  clearTrailClasses();

  // ghost first (faded)
  trailGhost.forEach(k => {
    const [r, c] = k.split(",").map(Number);
    tileAt(r, c)?.classList.add("trail", "ghost");
  });

  // current on top (solid)
  trailCurrent.forEach(k => {
    const [r, c] = k.split(",").map(Number);
    const t = tileAt(r, c);
    if (t) {
      t.classList.add("trail");
      t.classList.remove("ghost");
    }
  });
}

// ----------------
// Player rendering: arrow inside a shape
// ----------------
function clearPlayerRender() {
  gridEl.querySelectorAll(".tile.player").forEach(t => {
    t.classList.remove("player");
    t.textContent = "";
  });
}

function renderPlayer() {
  clearPlayerRender();
  const t = tileAt(player.row, player.col);
  if (!t) return;

  t.classList.add("player");

  const token = document.createElement("div");
  token.className = `playerToken facing-${player.facing.toLowerCase()}`;

  const arrow = document.createElement("div");
  arrow.className = "arrow";
  arrow.textContent = "➜";

  token.appendChild(arrow);
  t.appendChild(token);
}

// ----------------
// Apply / reset to current level
// ----------------
function resetToLevelStart({ clearProgram = true, clearTrails = true } = {}) {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }

  // Reset player
  player = {
    row: level.start.row,
    col: level.start.col,
    facing: level.startFacing,
    hasKey: false // Reset key state
  };

  // Trails
  if (clearTrails) {
    trailCurrent.clear();
    trailGhost.clear();
    renderTrails();
  }

  // Program state
  if (clearProgram) {
    instructionsEl.value = "";
    clearProgramState();
  } else {
    clearProgramState();
  }

  renderStaticElements();
  renderPlayer();

  statusEl.textContent = "Ready.";
  setMode("EDITING");
}

function clearProgramState() {
  program = [];
  programSource = "";
  ip = 0;
}

function startNewRunTrail() {
  trailGhost = new Set(trailCurrent);
  trailCurrent = new Set([keyOf(player.row, player.col)]);
  renderTrails();
}

// ----------------
// Step execution (one instruction)
// ----------------
function step() {
  if (ip >= program.length) return { stop: "Out of instructions" };

  const cmd = program[ip];

  if (cmd === "STOP") return { stop: "Stopped by STOP" };

  if (cmd === "L") {
    player.facing = turnLeft(player.facing);
    ip++;
    renderPlayer();
    return { continue: true };
  }

  if (cmd === "R") {
    player.facing = turnRight(player.facing);
    ip++;
    renderPlayer();
    return { continue: true };
  }

  if (cmd === "F") {
    const next = forwardPosition(player);

    if (!isInsideGrid(next.row, next.col)) {
      return { stop: `Stopped: Off-grid at (${next.row}, ${next.col})` };
    }

    // Check specific lava object for 'hidden' property
    const lavaTile = level.lava.find(l => l.row === next.row && l.col === next.col);

    if (lavaTile) {
      if (lavaTile.hidden) {
        lavaTile.hidden = false;

        // Visually reveal
        const t = tileAt(next.row, next.col);
        if (t) {
          t.classList.add("lava", "wall");
        }

        return { stop: `Stopped: Hidden Mine hit at (${next.row}, ${next.col})` };
      }

      // Check for Illusion (Fake Lava)
      if (lavaTile.fake) {
        // Reveal it's safe!
        const t = tileAt(next.row, next.col);
        if (t) {
          t.classList.remove("lava");
          t.classList.add("illusion");
          spawnParticles(t, ['#3b82f6', '#bfdbfe', '#ffffff'], 20); // Blue "safe" puff
        }
        console.log("Walked through illusion!");

        // ALLOW MOVEMENT (Do not return stop)
      } else {
        // Real Lava
        return { stop: `Stopped: Lava at (${next.row}, ${next.col})` };
      }
    }

    // Check Triggers
    if (level.triggers) {
      const trigger = level.triggers.find(t => t.row === next.row && t.col === next.col && t.active !== false);
      if (trigger) {
        trigger.active = false; // consume it
        // Remove visual class
        tileAt(trigger.row, trigger.col)?.classList.remove("trigger");

        // Activate Trap: Add new lava
        if (trigger.addsLava) {
          trigger.addsLava.forEach(pos => {
            level.lava.push(pos);
            // Animate appearance?
            const t = tileAt(pos.row, pos.col);
            if (t) {
              t.classList.add("lava", "wall");
              spawnParticles(t, ['#f59e0b', '#7f1d1d'], 20); // Poof effect
            }
          });
          console.log("Trap triggered! Lava added.");
        }
      }
    }

    // Check False Goals
    if (level.falseGoals && level.falseGoals.some(fg => fg.row === next.row && fg.col === next.col)) {
      return { stop: `Stopped: Trap! False Goal at (${next.row}, ${next.col})` };
    }

    // Check Key Collection
    if (level.needsKey && !player.hasKey &&
      level.keyPos && level.keyPos.row === next.row && level.keyPos.col === next.col) {
      player.hasKey = true;
      console.log("Key collected!");
      renderStaticElements(); // Update visuals (hide key, unlock goal)
      spawnParticles(tileAt(next.row, next.col), ['#fcd34d', '#fbbf24'], 30);
    }

    player.row = next.row;
    player.col = next.col;
    ip++;

    trailCurrent.add(keyOf(player.row, player.col));
    renderTrails();
    renderPlayer();

    if (player.row === level.goal.row && player.col === level.goal.col) {
      if (level.needsKey && !player.hasKey) {
        return { stop: "Goal Locked! You need the Key 🗝️" };
      }
      return { stop: "Goal reached!" };
    }

    return { continue: true };
  }

  return { stop: `Unknown internal command: ${cmd}` };
}

// ----------------
// Program loading + runner
// ----------------
function ensureProgramLoaded() {
  const currentSource = instructionsEl.value.trimEnd();

  if (program.length === 0 || currentSource !== programSource) {
    const result = parseProgram();
    if (result.error) {
      statusEl.textContent = result.error;
      return false;
    }
    program = result.program;
    programSource = currentSource;
    ip = 0;
  }

  return true;
}

function doOneStep() {
  if (!ensureProgramLoaded()) return { stop: true };

  const beforeIp = ip;
  const outcome = step();

  if (outcome.stop) {
    statusEl.textContent = outcome.stop;
    if (outcome.stop === "Goal reached!") {
      triggerWinEffect();
    } else if (outcome.stop.includes("Lava") || outcome.stop.includes("Mine")) {
      // Extract coords for fire effect
      const match = outcome.stop.match(/at \((\d+), (\d+)\)/);
      if (match) {
        triggerBurnEffect(Number(match[1]), Number(match[2]));
      }
    }
    clearProgramState();
    return { stop: true };
  }

  const cmd = program[beforeIp];
  statusEl.textContent = `OK: step ${beforeIp + 1} (${cmd})`;
  return { stop: false };
}

// ----------------
// FX
// ----------------
function triggerWinEffect() {
  const count = 60;
  const colors = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#ffffff'];

  // Find goal position to explode FROM
  const goalTile = document.querySelector('.tile.goal');
  spawnParticles(goalTile, colors, count);
}

function triggerBurnEffect(r, c) {
  const count = 40;
  const colors = ['#f97316', '#ef4444', '#f59e0b', '#7f1d1d', '#374151']; // Fire & Smoke

  const lavaTile = tileAt(r, c);
  spawnParticles(lavaTile, colors, count);
}

function spawnParticles(element, colors, count) {
  let startX = window.innerWidth / 2;
  let startY = window.innerHeight / 2;

  if (element) {
    const rect = element.getBoundingClientRect();
    startX = rect.left + rect.width / 2;
    startY = rect.top + rect.height / 2;
  }

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.classList.add('particle');
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    p.style.left = startX + 'px';
    p.style.top = startY + 'px';

    // Random direction
    const angle = Math.random() * Math.PI * 2;
    // Random distance (velocity)
    const velocity = 30 + Math.random() * 100;

    const tx = Math.cos(angle) * velocity + 'px';
    const ty = Math.sin(angle) * velocity + 'px';

    p.style.setProperty('--tx', tx);
    p.style.setProperty('--ty', ty);

    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }
}

// ----------------
// Command pad (adds tokens to textarea)
// ----------------
function appendCommand(token) {
  const current = instructionsEl.value.trimEnd();
  instructionsEl.value = current ? `${current}\n${token}` : token;
  instructionsEl.focus();
  if (mode === "EDITING") setMode("EDITING");
}

cmdF.addEventListener("click", () => appendCommand("F"));
cmdL.addEventListener("click", () => appendCommand("L"));
cmdR.addEventListener("click", () => appendCommand("R"));
cmdSTOP.addEventListener("click", () => appendCommand("STOP"));

instructionsEl.addEventListener("input", () => {
  if (mode === "EDITING") setMode("EDITING");
});

// ----------------
// Step button (optional)
// ----------------
if (stepBtn) {
  stepBtn.addEventListener("click", () => {
    if (mode !== "EDITING") return;

    if (ip === 0) startNewRunTrail();

    setMode("RUNNING");
    doOneStep();
    setMode("EDITING");
  });
}

// ----------------
// Run button: autoplay until stop
// ----------------
runBtn.addEventListener("click", () => {
  if (mode !== "EDITING") return;
  if (!ensureProgramLoaded()) return;

  startNewRunTrail();
  setMode("RUNNING");

  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    const { stop } = doOneStep();
    if (stop) {
      clearInterval(timerId);
      timerId = null;
      setMode("EDITING");
    }
  }, 500);
});

// ----------------
// Reset button
// ----------------
resetBtn.addEventListener("click", () => {
  resetToLevelStart({ clearProgram: true, clearTrails: true });
});

// ----------------
// Level Bank
// ----------------
const LEVEL_BANK = {
  1: [
    {
      // Fail State 1: Intent articulation (Simple path, goal visible)
      start: { row: 6, col: 1 },
      startFacing: "N",
      goal: { row: 1, col: 6 },
      lava: [
        { row: 2, col: 5 },
        { row: 3, col: 6 },
        { row: 4, col: 4 },
      ],
    },
    {
      // Fail State 1: Variation (The Blocked Start)
      // Forces an immediate "Intent" check: "I can't just go forward."
      start: { row: 6, col: 3 },
      startFacing: "N",
      goal: { row: 1, col: 3 },
      lava: [
        { row: 5, col: 3 }, // Immediate block
        { row: 3, col: 2 }, { row: 3, col: 4 },
      ],
    }
  ],
  2: [
    {
      // Fail State 2: Instruction Precision (The Zig-Zag)
      start: { row: 6, col: 2 },
      startFacing: "N",
      goal: { row: 1, col: 5 },
      lava: [
        { row: 5, col: 2 }, { row: 5, col: 3 }, { row: 5, col: 5 },
        { row: 4, col: 1 }, { row: 4, col: 4 },
        { row: 3, col: 3 }, { row: 3, col: 4 }, { row: 3, col: 5 },
        { row: 2, col: 1 }, { row: 2, col: 2 },
      ],
    },
    {
      // Fail State 2: Instruction Precision (The Winding Hall) - Variation
      start: { row: 6, col: 5 },
      startFacing: "N",
      goal: { row: 1, col: 2 },
      lava: [
        { row: 6, col: 4 }, { row: 6, col: 6 },
        { row: 5, col: 2 }, { row: 5, col: 4 },
        { row: 4, col: 2 }, { row: 4, col: 6 },
        { row: 3, col: 4 }, { row: 3, col: 6 },
        { row: 2, col: 2 }, { row: 2, col: 4 },
      ],
    }
  ],
  3: [
    {
      // Fail State 3: Anticipation & Visualization (The Trap)
      // Stepping on (4,3) closes the path!
      start: { row: 6, col: 3 },
      startFacing: "N",
      goal: { row: 2, col: 3 },
      lava: [
        { row: 5, col: 2 }, { row: 5, col: 4 },
        { row: 4, col: 1 }, { row: 4, col: 5 },
        // { row: 4, col: 3 } REMOVED: Now it's a trigger zone
        { row: 3, col: 2 }, { row: 3, col: 4 },
      ],
      triggers: [
        {
          row: 4, col: 3,
          addsLava: [{ row: 3, col: 3 }] // Blocks the goal directly in front!
        }
      ]
    },
    {
      // Fail State 3: Variation (The Cul-de-sac)
      // Looks wide open to the left, but it's a dead end.
      start: { row: 6, col: 3 },
      startFacing: "N",
      goal: { row: 1, col: 6 },
      lava: [
        { row: 5, col: 2 }, { row: 4, col: 2 }, { row: 3, col: 2 }, { row: 2, col: 2 },
        { row: 2, col: 3 }, { row: 2, col: 4 },
        { row: 4, col: 4 }, { row: 5, col: 4 },
      ],
      triggers: [
        // Trigger at start area that blocks the "easy" looking path later
        {
          row: 5, col: 3,
          addsLava: [{ row: 6, col: 2 }] // Just a nuisance / warning behind you
        }
      ]
    }
  ],
  4: [
    {
      // Fail State 4: Error Detection (The Minefield)
      start: { row: 6, col: 1 },
      startFacing: "E",
      goal: { row: 1, col: 6 },
      lava: [
        { row: 6, col: 3, hidden: true },
        { row: 5, col: 2 }, { row: 5, col: 5, hidden: true },
        { row: 4, col: 4 },
        { row: 3, col: 1, hidden: true }, { row: 3, col: 3 },
        { row: 2, col: 6, hidden: true },
      ],
    },
    {
      // Fail State 4: Error Detection (The Scattered Path) - Variation
      start: { row: 6, col: 1 },
      startFacing: "N",
      goal: { row: 1, col: 6 },
      lava: [
        { row: 5, col: 1, hidden: true },
        { row: 4, col: 3 }, { row: 4, col: 5, hidden: true },
        { row: 3, col: 2 },
        { row: 2, col: 4, hidden: true }, { row: 2, col: 6 },
        { row: 1, col: 5 },
      ],
    }
  ],
  5: [
    {
      // Fail State 5: Iteration & Revision (The Spiral)
      start: { row: 6, col: 1 },
      startFacing: "N",
      goal: { row: 3, col: 3 },
      lava: [
        { row: 5, col: 2 }, { row: 5, col: 3 }, { row: 5, col: 4 }, { row: 5, col: 5 },
        { row: 4, col: 6 },
        { row: 3, col: 2 }, { row: 3, col: 4 }, { row: 3, col: 6 },
        { row: 2, col: 2 }, { row: 2, col: 4 }, { row: 2, col: 5 }, { row: 2, col: 6 },
        { row: 4, col: 2 },
      ],
    },
    {
      // Fail State 5: Variation (The Snake)
      // Long path back and forth. Hard to get right in one go.
      start: { row: 6, col: 6 },
      startFacing: "N",
      goal: { row: 1, col: 1 },
      lava: [
        { row: 5, col: 2 }, { row: 5, col: 3 }, { row: 5, col: 4 }, { row: 5, col: 5 },
        { row: 3, col: 2 }, { row: 3, col: 3 }, { row: 3, col: 4 }, { row: 3, col: 5 },
        { row: 4, col: 1 }, { row: 2, col: 6 }, // Turn-arounds
      ],
    }
  ],
  6: [
    {
      // Fail State 6: Evaluation / Efficiency (Two Paths)
      start: { row: 6, col: 3 },
      startFacing: "N",
      goal: { row: 1, col: 3 },
      lava: [
        // Central column blocked mostly
        { row: 5, col: 3 }, { row: 4, col: 3 }, { row: 2, col: 3 },
        // Side obstacles
        { row: 3, col: 2 }, { row: 3, col: 4 },
      ],
    },
    {
      // Fail State 6: Variation (Risk vs Safety)
      // Left path: 3 steps but narrow gap. Right path: very wide but 10 steps.
      start: { row: 6, col: 3 },
      startFacing: "N",
      goal: { row: 3, col: 3 },
      lava: [
        { row: 5, col: 2 }, { row: 5, col: 3 }, { row: 5, col: 4 }, // Start box
        { row: 4, col: 2 }, { row: 4, col: 4 }, // Gatekeepers
        // No lava on cols 1 or 6, encouraging wide flank
      ],
    }
  ],
};

// ----------------
// Solvability check (path exists ignoring facing)
// ----------------
function isSolvable(lv) {
  const startKey = keyOf(lv.start.row, lv.start.col);
  const goalKey = keyOf(lv.goal.row, lv.goal.col);

  // Don’t allow lava on start/goal
  if (lv.lava.some(p => keyOf(p.row, p.col) === startKey)) return false;
  if (lv.lava.some(p => keyOf(p.row, p.col) === goalKey)) return false;

  const lavaSet = new Set(lv.lava.map(p => keyOf(p.row, p.col)));

  // False goals also block the "winning" path (because hitting them is a failure)
  if (lv.falseGoals) {
    lv.falseGoals.forEach(p => lavaSet.add(keyOf(p.row, p.col)));
  }

  const q = [{ row: lv.start.row, col: lv.start.col }];
  const seen = new Set([startKey]);

  const dirs = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
  ];

  while (q.length) {
    const cur = q.shift();
    if (keyOf(cur.row, cur.col) === goalKey) return true;

    for (const { dr, dc } of dirs) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      if (!isInsideGrid(nr, nc)) continue;

      const nk = keyOf(nr, nc);
      if (seen.has(nk)) continue;
      if (lavaSet.has(nk)) continue;

      seen.add(nk);
      q.push({ row: nr, col: nc });
    }
  }

  return false;
}

// ----------------
// Difficulty modifier: procedural difficulty spike
// ----------------
function intensifyLevel(lvl) {
  // Attempt to add N random lava tiles
  const attempts = 15;
  const targetAdditions = 3;
  let added = 0;

  for (let i = 0; i < attempts && added < targetAdditions; i++) {
    const r = Math.floor(Math.random() * 6) + 1;
    const c = Math.floor(Math.random() * 6) + 1;

    // Don't overwrite start, goal, or existing lava
    if ((r === lvl.start.row && c === lvl.start.col) ||
      (r === lvl.goal.row && c === lvl.goal.col) ||
      lvl.lava.some(l => l.row === r && l.col === c)) {
      continue;
    }

    // Speculatively add
    lvl.lava.push({ row: r, col: c });

    // Verify if still solvable
    if (isSolvable(lvl)) {
      added++;
    } else {
      // Revert
      lvl.lava.pop();
    }
  }
  console.log(`Hard Mode: Added ${added} extra lava tiles.`);
}

function getManhattanDist(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

function addDecoys(lvl) {
  // "Reachable by incomplete plans only"
  // Logic: Place the decoy structurally closer to the start than the real goal.
  // This simulates a plan that stops short or takes the "easy" early win.

  const startGoalDist = getManhattanDist(lvl.start.row, lvl.start.col, lvl.goal.row, lvl.goal.col);

  const attempts = 20;
  for (let i = 0; i < attempts; i++) {
    const r = Math.floor(Math.random() * 6) + 1;
    const c = Math.floor(Math.random() * 6) + 1;

    // Distance to this candidate
    const distToDecoy = getManhattanDist(lvl.start.row, lvl.start.col, r, c);

    // CRITERIA:
    // 1. Must be closer to start than the actual goal (Incomplete plan heuristic)
    // 2. Must not be adjacent to start (too easy to spot)
    if (distToDecoy >= startGoalDist || distToDecoy < 2) continue;

    // Standard collision checks
    if ((r === lvl.start.row && c === lvl.start.col) ||
      (r === lvl.goal.row && c === lvl.goal.col) ||
      lvl.lava.some(l => l.row === r && l.col === c) ||
      (lvl.triggers && lvl.triggers.some(t => t.row === r && t.col === c))) {
      continue;
    }

    // Speculatively add
    lvl.falseGoals = lvl.falseGoals || [];
    lvl.falseGoals.push({ row: r, col: c });

    // Verify Solvability (ensure we didn't block the ONLY path to real goal)
    if (isSolvable(lvl)) {
      console.log(`Added Incomplete Plan Decoy at (${r}, ${c}). Dist: ${distToDecoy} vs Goal: ${startGoalDist}`);
      return; // Success, just one decoy
    } else {
      lvl.falseGoals.pop(); // Revert
    }
  }
}

function addKey(lvl) {
  // Place a key somewhere reasonably far from start
  const attempts = 50;
  for (let i = 0; i < attempts; i++) {
    const r = Math.floor(Math.random() * 6) + 1;
    const c = Math.floor(Math.random() * 6) + 1;

    // Not on start/goal/lava
    if ((r === lvl.start.row && c === lvl.start.col) ||
      (r === lvl.goal.row && c === lvl.goal.col) ||
      lvl.lava.some(l => l.row === r && l.col === c)) {
      continue;
    }

    // Speculate
    lvl.keyPos = { row: r, col: c };
    lvl.needsKey = true;

    // Check 1: Start -> Key reachable?
    const keyReachable = isSolvable({ ...lvl, goal: lvl.keyPos });
    // Check 2: Key -> Goal reachable?
    const goalReachable = isSolvable({ ...lvl, start: lvl.keyPos });

    if (keyReachable && goalReachable) {
      console.log(`Added Key at (${r}, ${c})`);
      return; // Success
    } else {
      delete lvl.keyPos;
      delete lvl.needsKey;
    }
  }
}


// ----------------
// Paint level tiles (reusable)
// ----------------
function renderStaticElements() {
  gridEl.querySelectorAll(".tile").forEach(t => {
    t.classList.remove("lava", "wall", "start", "goal", "trigger", "fake-goal", "key", "locked");
  });

  // Paint triggers
  if (level.triggers) {
    level.triggers.forEach(({ row, col, active }) => {
      if (active !== false) {
        const t = tileAt(row, col);
        if (t) t.classList.add("trigger");
      }
    });
  }

  // Paint lava
  level.lava.forEach(({ row, col, hidden }) => {
    if (hidden) return;
    const t = tileAt(row, col);
    if (t) {
      t.classList.add("lava", "wall");
    }
  });

  // Paint Key (if exists and needed)
  if (level.needsKey && level.keyPos && !player.hasKey) {
    const t = tileAt(level.keyPos.row, level.keyPos.col);
    if (t) t.classList.add("key");
  }

  // Paint False Goals (visually identical to real goal, or slightly diff)
  if (level.falseGoals) {
    level.falseGoals.forEach(({ row, col }) => {
      const t = tileAt(row, col);
      // We add 'goal' class so it looks inviting
      if (t) t.classList.add("goal", "fake-goal");
    });
  }

  tileAt(level.start.row, level.start.col)?.classList.add("start");

  const goalEl = tileAt(level.goal.row, level.goal.col);
  if (goalEl) {
    goalEl.classList.add("goal");
    if (level.needsKey && !player.hasKey) {
      goalEl.classList.add("locked");
    }
  }
}

// ... unchanged ...

// ----------------
// Generator: picks a template from the bank
// ----------------
function generateLevel(caseType) {
  const bank = LEVEL_BANK[caseType] || LEVEL_BANK[1];
  const template = bank[Math.floor(Math.random() * bank.length)];
  const candidate = structuredClone(template);

  // Level 4 Special: Random Illusions
  if (caseType === 4) {
    candidate.lava.forEach(l => {
      if (!l.hidden && Math.random() < 0.3) {
        l.fake = true;
      }
    });
  }

  // Apply Hard Mode
  const isHard = document.getElementById("hardModeToggle")?.checked;
  if (isHard) {
    intensifyLevel(candidate);
  }

  // Apply Key Mode
  const needKey = document.getElementById("keyToggle")?.checked;
  if (needKey) {
    addKey(candidate);
  }

  // Apply False Goals
  const hasDecoys = document.getElementById("decoyToggle")?.checked;
  if (hasDecoys) {
    addDecoys(candidate);
  }

  if (!isSolvable(candidate)) {
    console.warn("Unsolvable level template; clearing lava as fallback.");
    candidate.lava = [];
  }

  level = candidate;
  resetToLevelStart({ clearProgram: true, clearTrails: true });

  let modeText = `Loaded Level Type ${caseType}`;
  if (isHard) modeText += " (Hard)";
  if (needKey) modeText += " + Key";
  if (hasDecoys) modeText += " + Decoys";
  statusEl.textContent = modeText;

  updateMissionBrief(caseType);
}

// ... unchanged ...

// ----------------
// UI: Level Selector
// ----------------
const controlsArea = document.querySelector(".controls") || document.body;
const selectorContainer = document.createElement("div");
selectorContainer.style.marginBottom = "10px";
selectorContainer.innerHTML = `
  <div class="selector-wrapper">
    <label for="levelSelect" class="label">Select Failure Mode:</label>
    <div class="selector-controls">
      <select id="levelSelect" class="select-input">
        <option value="1">1. Intent Articulation</option>
        <option value="2">2. Instruction Precision</option>
        <option value="3">3. Anticipation</option>
        <option value="4">4. Error Detection</option>
        <option value="5">5. Iteration</option>
        <option value="6">6. Evaluation</option>
      </select>
      <button id="loadLevelBtn" class="btn primary">Load Level</button>
    </div>
    
    <div style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 16px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="hardModeToggle" style="width: 16px; height: 16px; cursor: pointer;">
        <label for="hardModeToggle" style="color: var(--danger); font-weight: bold; cursor: pointer;">Hard Mode</label>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="decoyToggle" style="width: 16px; height: 16px; cursor: pointer;">
        <label for="decoyToggle" style="color: var(--lava); font-weight: bold; cursor: pointer;">False Goals</label>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="keyToggle" style="width: 16px; height: 16px; cursor: pointer;">
        <label for="keyToggle" style="color: #fbbf24; font-weight: bold; cursor: pointer;">Need Key</label>
      </div>
    </div>

    <div id="missionBrief" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--panel-border);">
      <div style="color: var(--accent); font-weight: bold; margin-bottom: 4px;" id="briefTitle"></div>
      <div style="font-style: italic; color: var(--text); margin-bottom: 4px;" id="briefGoal"></div>
      <div style="font-size: 0.9em; color: var(--muted);" id="briefDesc"></div>
    </div>
  </div>
`;

// Insert at top of body for visibility
document.body.insertBefore(selectorContainer, document.body.firstChild);

document.getElementById("loadLevelBtn").addEventListener("click", () => {
  const val = document.getElementById("levelSelect").value;
  generateLevel(parseInt(val));
});

function updateMissionBrief(caseType) {
  const info = LEVEL_DESCRIPTIONS[caseType];
  if (info) {
    document.getElementById("briefTitle").textContent = info.title;
    document.getElementById("briefGoal").textContent = info.goal;
    document.getElementById("briefDesc").textContent = info.desc;
  }
}

// ----------------
// Init
// ----------------
initGrid();
renderStaticElements();
renderPlayer();
setMode("EDITING");
statusEl.textContent = "Ready.";

// Initialize first generated level
generateLevel(1);
