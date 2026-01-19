// ================================
// Dungeon Instruction Game
// Clean: Auto-Run + Ghost Trail + Player Token
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

console.log("gridEl:", gridEl);

// ----------------
// Level map (1–6 coords)
// ----------------
const level = {
  start: { row: 6, col: 1 },
  startFacing: "N",
  goal: { row: 1, col: 6 },
  walls: [
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
// Phase 6.1: Parsing
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

function isWall(row, col) {
  return level.walls.some(w => w.row === row && w.col === col);
}

// ----------------
// Grid render (6x6) + tileAt
// ----------------
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

function tileAt(row, col) {
  return gridEl.querySelector(`.tile[data-row="${row}"][data-col="${col}"]`);
}

// ----------------
// Paint level tiles
// ----------------
gridEl.querySelectorAll(".tile").forEach(t =>
  t.classList.remove("wall", "start", "goal", "player", "trail", "ghost")
);

level.walls.forEach(({ row, col }) => tileAt(row, col)?.classList.add("wall"));
tileAt(level.start.row, level.start.col)?.classList.add("start");
tileAt(level.goal.row, level.goal.col)?.classList.add("goal");

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

renderPlayer();

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

    if (!isInsideGrid(next.row, next.col) || isWall(next.row, next.col)) {
      return { stop: `Stopped: Wall at (${next.row}, ${next.col})` };
    }

    player.row = next.row;
    player.col = next.col;
    ip++;

    // Only mark trail when we actually MOVE
    trailCurrent.add(keyOf(player.row, player.col));
    renderTrails();

    renderPlayer();

    if (player.row === level.goal.row && player.col === level.goal.col) {
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

function clearProgramState() {
  program = [];
  programSource = "";
  ip = 0;
}

function startNewRunTrail() {
  // Promote current to ghost, start fresh trail at current player position
  trailGhost = new Set(trailCurrent);
  trailCurrent = new Set([keyOf(player.row, player.col)]);
  renderTrails();
}

function doOneStep() {
  if (!ensureProgramLoaded()) return { stop: true };

  const beforeIp = ip;
  const outcome = step();

  if (outcome.stop) {
    statusEl.textContent = outcome.stop;
    clearProgramState();
    return { stop: true };
  }

  const cmd = program[beforeIp];
  statusEl.textContent = `OK: step ${beforeIp + 1} (${cmd})`;
  return { stop: false };
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

// Keep Run/Step enabled/disabled as user edits
instructionsEl.addEventListener("input", () => {
  if (mode === "EDITING") setMode("EDITING");
});

// ----------------
// Step button (optional)
// ----------------
if (stepBtn) {
  stepBtn.addEventListener("click", () => {
    if (mode !== "EDITING") return;

    // If this is the first step of a run, start fresh trail
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

  // New run => new trail set
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
// Reset: stop timer, reset player, clear program + trails
// ----------------
resetBtn.addEventListener("click", () => {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }

  // Clear textbox
  instructionsEl.value = "";

  // Clear trails
  trailCurrent.clear();
  trailGhost.clear();
  renderTrails();

  // Reset player
  player = {
    row: level.start.row,
    col: level.start.col,
    facing: level.startFacing,
  };
  renderPlayer();

  clearProgramState();

  statusEl.textContent = "Ready.";
  setMode("EDITING");
});

// ----------------
// Init
// ----------------
setMode("EDITING");
statusEl.textContent = "Ready.";
