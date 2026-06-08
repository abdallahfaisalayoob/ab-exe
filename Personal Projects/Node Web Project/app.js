const canvas = document.getElementById("pcbCanvas");
const ctx = canvas.getContext("2d");
const terminalOutput = document.getElementById("terminalOutput");
const terminalInput = document.getElementById("terminalInput");
const runCommandButton = document.getElementById("runCommandButton");
const loadDemoButton = document.getElementById("loadDemoButton");
const statusPill = document.getElementById("statusPill");
const canvasCaption = document.getElementById("canvasCaption");

const PRINT_SPEED = 4;
const CONNECTION_THRESHOLD = 46;

const SAMPLE_CIRCUIT = {
  components: [
    { type: "resistor", x: 250, y: 180 },
    { type: "capacitor", x: 460, y: 180 },
    { type: "line", x1: 110, y1: 180, x2: 206, y2: 180 },
    { type: "line", x1: 292, y1: 180, x2: 420, y2: 180 },
    { type: "line", x1: 500, y1: 180, x2: 676, y2: 180 },
    { type: "line", x1: 676, y1: 180, x2: 676, y2: 360 },
    { type: "line", x1: 676, y1: 360, x2: 110, y2: 360 },
    { type: "line", x1: 110, y1: 360, x2: 110, y2: 214 }
  ]
};

const state = {
  circuit: null,
  segments: [],
  animationFrame: null,
  animationToken: 0,
  isPrinting: false,
  currentPointIndex: 0,
  totalPoints: 0,
  laserPath: [],
  currentFlowActive: false,
  currentFlowOffset: 0
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function logLine(kind, message) {
  const line = document.createElement("div");
  line.className = `terminal-line ${kind}`;
  line.textContent = message;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function setStatus(label) {
  statusPill.textContent = label;
}

function setCaption(text) {
  canvasCaption.textContent = text;
}

function bootTerminal() {
  logLine("system", "[SYSTEM] AI Circuit Terminal Printer ready.");
  logLine("system", "[SYSTEM] Type `help` for commands or paste a circuit JSON payload.");
  setCaption("Ready for circuit input.");
  drawBoard([]);
}

function normaliseComponent(component) {
  if (!component || typeof component !== "object") {
    throw new Error("Invalid component entry.");
  }

  const type = String(component.type || "").trim().toLowerCase();
  if (!type) {
    throw new Error("Each component requires a type.");
  }

  if (type === "line") {
    const x1 = Number(component.x1);
    const y1 = Number(component.y1);
    const x2 = Number(component.x2);
    const y2 = Number(component.y2);
    if ([x1, y1, x2, y2].some((value) => Number.isNaN(value))) {
      throw new Error("Line components require numeric x1, y1, x2, and y2 values.");
    }
    return { type, x1, y1, x2, y2 };
  }

  const x = Number(component.x);
  const y = Number(component.y);
  if ([x, y].some((value) => Number.isNaN(value))) {
    throw new Error(`${type} components require numeric x and y values.`);
  }

  return {
    type,
    x,
    y,
    rotation: Number(component.rotation) || 0
  };
}

function parseCircuitPayload(rawText) {
  const parsed = JSON.parse(rawText);
  const payload = Array.isArray(parsed) ? { components: parsed } : parsed;
  if (!payload || !Array.isArray(payload.components)) {
    throw new Error("Circuit JSON must include a `components` array.");
  }

  return {
    components: payload.components.map(normaliseComponent)
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatPoint(point) {
  return `(${Math.round(point.x)},${Math.round(point.y)})`;
}

function hasPowerSource(components) {
  return components.some((component) =>
    ["battery", "power_source", "voltage_source", "source"].includes(component.type)
  );
}

function getLineEndpoints(circuit) {
  return circuit.components.flatMap((component, index) => {
    if (component.type !== "line") {
      return [];
    }

    return [
      { x: component.x1, y: component.y1, lineIndex: index, endpoint: "start" },
      { x: component.x2, y: component.y2, lineIndex: index, endpoint: "end" }
    ];
  });
}

function segmentExists(components, pointA, pointB) {
  return components.some((component) => {
    if (component.type !== "line") {
      return false;
    }

    const direct =
      component.x1 === pointA.x &&
      component.y1 === pointA.y &&
      component.x2 === pointB.x &&
      component.y2 === pointB.y;
    const reverse =
      component.x1 === pointB.x &&
      component.y1 === pointB.y &&
      component.x2 === pointA.x &&
      component.y2 === pointA.y;
    return direct || reverse;
  });
}

function autoCorrectCircuit(circuit) {
  const enhanced = deepClone(circuit);
  const aiMessages = [];
  const endpoints = getLineEndpoints(enhanced);
  const paired = new Set();

  endpoints.forEach((point) => {
    const key = `${point.lineIndex}:${point.endpoint}`;
    if (paired.has(key)) {
      return;
    }

    let bestMatch = null;

    endpoints.forEach((candidate) => {
      const candidateKey = `${candidate.lineIndex}:${candidate.endpoint}`;
      if (candidateKey === key || paired.has(candidateKey)) {
        return;
      }
      if (candidate.lineIndex === point.lineIndex) {
        return;
      }

      const gap = distance(point, candidate);
      if (gap === 0 || gap > CONNECTION_THRESHOLD) {
        return;
      }

      if (!bestMatch || gap < bestMatch.gap) {
        bestMatch = { candidate, gap };
      }
    });

    if (!bestMatch) {
      return;
    }

    const connectionExists = segmentExists(enhanced.components, point, bestMatch.candidate);
    if (connectionExists) {
      return;
    }

    paired.add(key);
    paired.add(`${bestMatch.candidate.lineIndex}:${bestMatch.candidate.endpoint}`);
    enhanced.components.push({
      type: "line",
      x1: point.x,
      y1: point.y,
      x2: bestMatch.candidate.x,
      y2: bestMatch.candidate.y
    });
    aiMessages.push(
      `[AI] Corrected broken line between ${formatPoint(point)} and ${formatPoint(bestMatch.candidate)}.`
    );
  });

  if (!hasPowerSource(enhanced.components)) {
    const anchor =
      endpoints
        .slice()
        .sort((left, right) => (left.x + left.y) - (right.x + right.y))[0] ||
      enhanced.components.find((component) => "x" in component && "y" in component) ||
      { x: 160, y: 180 };

    const battery = {
      type: "battery",
      x: Math.max(84, anchor.x - 84),
      y: Math.max(84, anchor.y)
    };

    enhanced.components.unshift(battery);

    const batteryOut = { x: battery.x + 34, y: battery.y };
    const batteryIn = { x: battery.x - 28, y: battery.y };

    if (batteryOut.x !== anchor.x || batteryOut.y !== anchor.y) {
      enhanced.components.unshift({
        type: "line",
        x1: batteryOut.x,
        y1: batteryOut.y,
        x2: anchor.x,
        y2: anchor.y
      });
    }

    enhanced.components.unshift({
      type: "line",
      x1: batteryIn.x - 24,
      y1: batteryIn.y,
      x2: batteryIn.x,
      y2: batteryIn.y
    });

    aiMessages.push(`[AI] Added battery at ${formatPoint(battery)}.`);
  }

  return { circuit: enhanced, aiMessages };
}

function getStrokePolylines(component) {
  if (component.type === "line") {
    return [[{ x: component.x1, y: component.y1 }, { x: component.x2, y: component.y2 }]];
  }

  if (component.type === "resistor") {
    const y = component.y;
    return [[
      { x: component.x - 42, y },
      { x: component.x - 26, y },
      { x: component.x - 16, y: y - 14 },
      { x: component.x - 6, y: y + 14 },
      { x: component.x + 4, y: y - 14 },
      { x: component.x + 14, y: y + 14 },
      { x: component.x + 24, y: y - 14 },
      { x: component.x + 34, y },
      { x: component.x + 42, y }
    ]];
  }

  if (component.type === "capacitor") {
    return [
      [{ x: component.x - 40, y: component.y }, { x: component.x - 12, y: component.y }],
      [{ x: component.x - 12, y: component.y - 22 }, { x: component.x - 12, y: component.y + 22 }],
      [{ x: component.x + 12, y: component.y - 22 }, { x: component.x + 12, y: component.y + 22 }],
      [{ x: component.x + 12, y: component.y }, { x: component.x + 40, y: component.y }]
    ];
  }

  if (component.type === "battery" || component.type === "power_source") {
    return [
      [{ x: component.x - 28, y: component.y }, { x: component.x - 10, y: component.y }],
      [{ x: component.x - 10, y: component.y - 22 }, { x: component.x - 10, y: component.y + 22 }],
      [{ x: component.x + 10, y: component.y - 12 }, { x: component.x + 10, y: component.y + 12 }],
      [{ x: component.x + 10, y: component.y }, { x: component.x + 34, y: component.y }]
    ];
  }

  return [[
    { x: component.x - 16, y: component.y - 16 },
    { x: component.x + 16, y: component.y + 16 }
  ]];
}

function interpolatePolyline(polyline, step = PRINT_SPEED) {
  const points = [];

  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const segments = Math.max(1, Math.ceil(length / step));

    for (let stepIndex = 0; stepIndex < segments; stepIndex += 1) {
      const t = stepIndex / segments;
      points.push({
        x: start.x + dx * t,
        y: start.y + dy * t
      });
    }
  }

  points.push(polyline[polyline.length - 1]);
  return points;
}

function buildSegments(circuit) {
  return circuit.components.flatMap((component) =>
    getStrokePolylines(component).map((polyline) => ({
      componentType: component.type,
      points: interpolatePolyline(polyline)
    }))
  );
}

function countPoints(segments) {
  return segments.reduce((total, segment) => total + segment.points.length, 0);
}

function flattenSegments(segments) {
  return segments.flatMap((segment) => segment.points);
}

function clearAnimationFrame() {
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
}

function resetVisualState() {
  state.animationToken += 1;
  clearAnimationFrame();
  state.isPrinting = false;
  state.currentFlowActive = false;
  state.currentPointIndex = 0;
  state.currentFlowOffset = 0;
  setStatus("Idle");
}

function drawGrid() {
  ctx.save();
  ctx.fillStyle = "#071622";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(11, 35, 47, 0.96)";
  ctx.fillRect(36, 36, canvas.width - 72, canvas.height - 72);

  ctx.strokeStyle = "rgba(94, 240, 198, 0.08)";
  ctx.lineWidth = 1;
  for (let x = 36; x <= canvas.width - 36; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 36);
    ctx.lineTo(x, canvas.height - 36);
    ctx.stroke();
  }
  for (let y = 36; y <= canvas.height - 36; y += 32) {
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(canvas.width - 36, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(243, 152, 50, 0.2)";
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, canvas.width - 72, canvas.height - 72);
  ctx.restore();
}

function drawPolyline(points, color, width, glow = false) {
  if (!points.length) {
    return;
  }

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.lineWidth = width;

  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => {
    ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawPads(circuit) {
  const nodes = [];

  circuit.components.forEach((component) => {
    if (component.type === "line") {
      nodes.push({ x: component.x1, y: component.y1 });
      nodes.push({ x: component.x2, y: component.y2 });
      return;
    }

    if ("x" in component && "y" in component) {
      nodes.push({ x: component.x, y: component.y });
    }
  });

  ctx.save();
  nodes.forEach((node) => {
    ctx.beginPath();
    ctx.fillStyle = "rgba(243, 152, 50, 0.95)";
    ctx.shadowColor = "rgba(243, 152, 50, 0.9)";
    ctx.shadowBlur = 10;
    ctx.arc(node.x, node.y, 4.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "rgba(9, 26, 36, 1)";
    ctx.shadowBlur = 0;
    ctx.arc(node.x, node.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function sliceSegmentPoints(segmentPoints, pointCount) {
  if (pointCount <= 0) {
    return [];
  }

  return segmentPoints.slice(0, Math.min(pointCount, segmentPoints.length));
}

function drawBoard(segments, progress = null, laserPoint = null) {
  drawGrid();

  if (state.circuit) {
    const totalProgress = progress == null ? countPoints(segments) : progress;
    let remaining = totalProgress;

    segments.forEach((segment) => {
      const count = Math.min(segment.points.length, remaining);
      remaining -= count;
      const visiblePoints = sliceSegmentPoints(segment.points, count);
      if (visiblePoints.length > 1) {
        drawPolyline(visiblePoints, "#8b4f16", 9, false);
        drawPolyline(visiblePoints, "#f39832", 4.6, true);
      }
    });

    drawPads(state.circuit);
  }

  if (laserPoint) {
    ctx.save();
    ctx.beginPath();
    ctx.shadowColor = "#ff4d4d";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#ff4545";
    ctx.arc(laserPoint.x, laserPoint.y, 6.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "rgba(255, 225, 225, 0.88)";
    ctx.arc(laserPoint.x, laserPoint.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (state.currentFlowActive && state.laserPath.length > 1) {
    drawCurrentFlow();
  }
}

function drawCurrentFlow() {
  const pulseSize = 140;
  const points = state.laserPath;
  const visible = [];
  const start = Math.max(0, state.currentFlowOffset - pulseSize);
  const end = Math.min(points.length - 1, state.currentFlowOffset);

  for (let index = start; index <= end; index += 1) {
    visible.push(points[index]);
  }

  if (visible.length > 1) {
    drawPolyline(visible, "rgba(94, 240, 198, 0.95)", 3.4, true);
  }

  const head = points[Math.min(state.currentFlowOffset, points.length - 1)];
  if (head) {
    ctx.save();
    ctx.beginPath();
    ctx.shadowColor = "#5ef0c6";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "#5ef0c6";
    ctx.arc(head.x, head.y, 5.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function animatePrint() {
  if (!state.segments.length) {
    return;
  }

  state.animationToken += 1;
  const token = state.animationToken;
  state.isPrinting = true;
  state.currentFlowActive = false;
  state.currentPointIndex = 0;
  setStatus("Printing");
  setCaption("Laser printing in progress.");
  logLine("system", "[SYSTEM] Starting laser printing...");

  const step = () => {
    if (token !== state.animationToken) {
      return;
    }

    state.currentPointIndex += 2;
    if (state.currentPointIndex >= state.totalPoints) {
      state.currentPointIndex = state.totalPoints;
    }

    const laserPoint = state.laserPath[Math.max(0, state.currentPointIndex - 1)] || null;
    drawBoard(state.segments, state.currentPointIndex, laserPoint);

    if (state.currentPointIndex < state.totalPoints) {
      state.animationFrame = requestAnimationFrame(step);
      return;
    }

    state.isPrinting = false;
    state.animationFrame = null;
    setStatus("Printed");
    setCaption("Circuit rendered on PCB.");
    logLine("system", "[SYSTEM] Circuit successfully printed on PCB.");
  };

  clearAnimationFrame();
  state.animationFrame = requestAnimationFrame(step);
}

function startCurrentFlowSimulation() {
  if (!state.circuit || !state.laserPath.length) {
    logLine("error", "[ERROR] Load and print a circuit before running simulation.");
    return;
  }

  state.animationToken += 1;
  clearAnimationFrame();
  state.currentFlowActive = true;
  state.currentFlowOffset = 0;
  setStatus("Simulating");
  setCaption("Current flow highlight is active.");
  logLine("system", "[SYSTEM] Simulating current flow.");

  const token = state.animationToken;
  const pulse = () => {
    if (token !== state.animationToken) {
      return;
    }

    state.currentFlowOffset = (state.currentFlowOffset + 3) % state.laserPath.length;
    drawBoard(state.segments, state.totalPoints, null);
    state.animationFrame = requestAnimationFrame(pulse);
  };

  drawBoard(state.segments, state.totalPoints, null);
  state.animationFrame = requestAnimationFrame(pulse);
}

function loadCircuit(rawText) {
  let parsedCircuit;

  try {
    parsedCircuit = parseCircuitPayload(rawText);
  } catch (error) {
    logLine("error", `[ERROR] ${error.message}`);
    return;
  }

  const { circuit, aiMessages } = autoCorrectCircuit(parsedCircuit);
  state.circuit = circuit;
  state.segments = buildSegments(circuit);
  state.totalPoints = countPoints(state.segments);
  state.laserPath = flattenSegments(state.segments);
  resetVisualState();

  logLine("system", "[SYSTEM] Circuit loaded.");
  aiMessages.forEach((message) => logLine("ai", message));
  drawBoard(state.segments, 0, null);
  animatePrint();
}

function clearCircuit() {
  resetVisualState();
  state.circuit = null;
  state.segments = [];
  state.totalPoints = 0;
  state.laserPath = [];
  setCaption("Canvas cleared. Waiting for a circuit definition.");
  drawBoard([]);
  logLine("system", "[SYSTEM] Canvas and circuit state cleared.");
}

function saveCanvasImage() {
  if (!state.circuit) {
    logLine("error", "[ERROR] Nothing to save yet. Load a circuit first.");
    return;
  }

  const previousFlowState = state.currentFlowActive;
  state.currentFlowActive = false;
  drawBoard(state.segments, state.totalPoints, null);
  const link = document.createElement("a");
  link.download = `pcb-circuit-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  state.currentFlowActive = previousFlowState;
  drawBoard(state.segments, state.totalPoints, null);
  logLine("system", "[SYSTEM] Canvas exported as PNG.");
}

function printHelp() {
  logLine("system", "[SYSTEM] Available commands:");
  logLine("system", "  help");
  logLine("system", "  load_circuit {\"components\":[...] }");
  logLine("system", "  clear");
  logLine("system", "  save");
  logLine("system", "  simulate");
  logLine("system", "  demo");
  logLine("system", "  You can also paste raw JSON without the `load_circuit` prefix.");
}

function executeCommand(rawInput) {
  const input = rawInput.trim();
  if (!input) {
    return;
  }

  logLine("user", `pcb> ${input}`);

  if (input === "help") {
    printHelp();
    return;
  }

  if (input === "clear") {
    clearCircuit();
    return;
  }

  if (input === "save") {
    saveCanvasImage();
    return;
  }

  if (input === "simulate") {
    startCurrentFlowSimulation();
    return;
  }

  if (input === "demo") {
    loadCircuit(JSON.stringify(SAMPLE_CIRCUIT));
    return;
  }

  if (input.startsWith("load_circuit")) {
    const payload = input.slice("load_circuit".length).trim();
    if (!payload) {
      logLine("error", "[ERROR] `load_circuit` requires a JSON payload.");
      return;
    }
    loadCircuit(payload);
    return;
  }

  if (input.startsWith("{") || input.startsWith("[")) {
    loadCircuit(input);
    return;
  }

  logLine("error", `[ERROR] Unknown command: ${input}`);
}

function handleSubmit() {
  const input = terminalInput.value;
  executeCommand(input);
  terminalInput.value = "";
  terminalInput.focus();
}

runCommandButton.addEventListener("click", handleSubmit);
loadDemoButton.addEventListener("click", () => {
  executeCommand("demo");
});

terminalInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSubmit();
  }
});

window.addEventListener("resize", () => {
  drawBoard(state.segments, state.totalPoints, null);
});

bootTerminal();
