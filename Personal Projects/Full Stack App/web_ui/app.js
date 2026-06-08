const canvas = document.querySelector("#drawCanvas");
const ctx = canvas.getContext("2d");
const gcodeBox = document.querySelector("#gcodeBox");
const logBox = document.querySelector("#logBox");
const lineCount = document.querySelector("#lineCount");
const progressText = document.querySelector("#progressText");
const connectionText = document.querySelector("#connectionText");
const connectionStatus = document.querySelector("#connectionStatus");
const supportText = document.querySelector("#supportText");

const inputs = {
  workWidth: document.querySelector("#workWidth"),
  workHeight: document.querySelector("#workHeight"),
  engraveFeed: document.querySelector("#engraveFeed"),
  travelFeed: document.querySelector("#travelFeed"),
  laserPower: document.querySelector("#laserPower"),
  safeZ: document.querySelector("#safeZ"),
  focusZ: document.querySelector("#focusZ"),
  baudRate: document.querySelector("#baudRate"),
};

let strokes = [];
let currentStroke = null;
let generatedGcode = [];
let port = null;
let reader = null;
let writer = null;
let readBuffer = "";
let pendingWaiter = null;
let streamAbort = false;
let keepReading = false;

function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  logBox.textContent += `[${timestamp}] ${message}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function setProgress(message) {
  progressText.textContent = message;
}

function setConnected(connected) {
  connectionStatus.classList.toggle("connected", connected);
  connectionText.textContent = connected ? "Connected" : "Disconnected";
  document.querySelector("#connectBtn").textContent = connected ? "Disconnect" : "Connect";
}

function checkSupport() {
  if ("serial" in navigator) {
    supportText.textContent = "Web Serial available";
    return true;
  }
  supportText.textContent = "Use Chrome or Edge on localhost/HTTPS";
  return false;
}

function resizeCanvasForDisplay() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));

  if (canvas.width === width && canvas.height === height) {
    return;
  }

  canvas.width = width;
  canvas.height = height;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  redrawCanvas();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
  };
}

function redrawCanvas() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = "#151515";

  for (const stroke of strokes) {
    if (stroke.length < 2) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (const point of stroke.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener("pointerdown", (event) => {
  resizeCanvasForDisplay();
  canvas.setPointerCapture(event.pointerId);
  currentStroke = [canvasPoint(event)];
  strokes.push(currentStroke);
});

canvas.addEventListener("pointermove", (event) => {
  if (!currentStroke) {
    return;
  }
  const point = canvasPoint(event);
  const last = currentStroke[currentStroke.length - 1];
  if (distance(last, point) < 2) {
    return;
  }
  currentStroke.push(point);
  redrawCanvas();
});

canvas.addEventListener("pointerup", () => {
  if (currentStroke && currentStroke.length < 2) {
    strokes.pop();
  }
  currentStroke = null;
});

canvas.addEventListener("pointercancel", () => {
  currentStroke = null;
});

window.addEventListener("resize", resizeCanvasForDisplay);

function numberValue(id, label, min = 0, max = Number.POSITIVE_INFINITY) {
  const value = Number(inputs[id].value);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function pixelToMm(point, settings) {
  const rect = canvas.getBoundingClientRect();
  const x = (point.x / rect.width) * settings.workWidth;
  const y = (point.y / rect.height) * settings.workHeight;
  return [x.toFixed(3), y.toFixed(3)];
}

function buildGcode() {
  if (!strokes.some((stroke) => stroke.length >= 2)) {
    throw new Error("Draw at least one stroke before generating G-code.");
  }

  const settings = {
    workWidth: numberValue("workWidth", "Work width", 1),
    workHeight: numberValue("workHeight", "Work height", 1),
    engraveFeed: numberValue("engraveFeed", "Engrave feed", 1),
    travelFeed: numberValue("travelFeed", "Travel feed", 1),
    laserPower: Math.round(numberValue("laserPower", "Laser power", 0, 1000)),
    safeZ: numberValue("safeZ", "Safe Z", 0),
    focusZ: numberValue("focusZ", "Focus Z", 0),
  };

  const lines = [
    "; Generated by web_ui/app.js",
    "; Verify enclosure, interlocks, ventilation, and focus before running.",
    "G21",
    "G90",
    "M5",
    `G0 Z${settings.safeZ.toFixed(3)} F300`,
  ];

  for (const stroke of strokes) {
    if (stroke.length < 2) {
      continue;
    }

    const [startX, startY] = pixelToMm(stroke[0], settings);
    lines.push("M5");
    lines.push(`G0 Z${settings.safeZ.toFixed(3)} F300`);
    lines.push(`G0 X${startX} Y${startY} F${settings.travelFeed}`);
    lines.push(`G1 Z${settings.focusZ.toFixed(3)} F300`);
    lines.push(`M3 S${settings.laserPower}`);

    let last = stroke[0];
    for (const point of stroke.slice(1)) {
      if (distance(last, point) < 2) {
        continue;
      }
      const [x, y] = pixelToMm(point, settings);
      lines.push(`G1 X${x} Y${y} F${settings.engraveFeed}`);
      last = point;
    }
  }

  lines.push("M5");
  lines.push(`G0 Z${settings.safeZ.toFixed(3)} F300`);
  lines.push("M18");
  return lines;
}

function setGcode(lines) {
  generatedGcode = lines;
  gcodeBox.value = lines.join("\n");
  lineCount.textContent = `${lines.length} generated lines.`;
}

function currentGcodeLines() {
  return gcodeBox.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function shouldSend(line) {
  return line && !line.startsWith(";");
}

function handleSerialLine(line) {
  if (!line) {
    return;
  }

  log(`< ${line}`);
  if (pendingWaiter && (line === "ok" || line.startsWith("error:") || line.startsWith("ALARM:"))) {
    const waiter = pendingWaiter;
    pendingWaiter = null;
    waiter.resolve(line);
  }
}

async function readLoop() {
  const decoder = new TextDecoder();
  try {
    while (keepReading && port && port.readable) {
      reader = port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          readBuffer += decoder.decode(value, { stream: true });
          const lines = readBuffer.split(/\r?\n/);
          readBuffer = lines.pop() ?? "";
          for (const line of lines) {
            handleSerialLine(line.trim());
          }
        }
      } finally {
        reader.releaseLock();
        reader = null;
      }
    }
  } catch (error) {
    if (port) {
      log(`ERROR: serial read failed: ${error.message}`);
    }
  }
}

async function connectSerial() {
  if (!checkSupport()) {
    alert("Web Serial is not available. Use Chrome or Edge and serve the UI from localhost.");
    return;
  }

  if (port) {
    await disconnectSerial();
    return;
  }

  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: Math.round(numberValue("baudRate", "Baud rate", 9600)) });
    writer = port.writable.getWriter();
    keepReading = true;
    setConnected(true);
    setProgress("Connected");
    log(`Connected at ${inputs.baudRate.value} baud`);
    readLoop();
  } catch (error) {
    port = null;
    writer = null;
    setConnected(false);
    log(`ERROR: connection failed: ${error.message}`);
  }
}

async function disconnectSerial() {
  try {
    keepReading = false;
    if (reader) {
      await reader.cancel();
    }
    if (writer) {
      writer.releaseLock();
    }
    if (port) {
      await port.close();
    }
  } catch (error) {
    log(`ERROR: disconnect failed: ${error.message}`);
  } finally {
    reader = null;
    writer = null;
    port = null;
    setConnected(false);
    setProgress("Disconnected");
  }
}

async function writeLine(line) {
  if (!writer || !port) {
    throw new Error("Serial port is not connected.");
  }
  const payload = new TextEncoder().encode(`${line.trim()}\n`);
  log(`> ${line.trim()}`);
  await writer.write(payload);
}

async function sendAndWait(line, timeoutMs = 60000) {
    if (pendingWaiter) {
    throw new Error("Another command is waiting for a response.");
  }

  const responsePromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (pendingWaiter) {
        pendingWaiter = null;
      }
      reject(new Error(`Timeout waiting for ok after: ${line}`));
    }, timeoutMs);

    pendingWaiter = {
      resolve: (response) => {
        window.clearTimeout(timeout);
        resolve(response);
      },
      reject,
    };
  });

  try {
    await writeLine(line);
  } catch (error) {
    if (pendingWaiter) {
      pendingWaiter = null;
    }
    throw error;
  }
  return responsePromise;
}

async function sendManual(command) {
  try {
    await writeLine(command);
    setProgress(`Sent ${command}`);
  } catch (error) {
    log(`ERROR: ${error.message}`);
    alert(error.message);
  }
}

async function streamGcode() {
  if (!port || !writer) {
    alert("Connect to the Arduino first.");
    return;
  }

  const lines = currentGcodeLines().filter(shouldSend);
  if (lines.length === 0) {
    alert("Generate or paste G-code first.");
    return;
  }

  const confirmed = confirm(
    "Safety check before streaming:\n\n" +
      "Laser disconnected for first motion tests, or enclosure closed.\n" +
      "Eye protection on.\n" +
      "Ventilation running.\n" +
      "Interlock and emergency stop tested.\n\n" +
      "Continue?"
  );
  if (!confirmed) {
    return;
  }

  streamAbort = false;
  setProgress("Streaming...");

  try {
    for (let i = 0; i < lines.length; i += 1) {
      if (streamAbort) {
        setProgress("Stream stopped");
        return;
      }

      const line = lines[i];
      setProgress(`Streaming ${i + 1}/${lines.length}`);
      const response = await sendAndWait(line);
      if (response.startsWith("error:") || response.startsWith("ALARM:")) {
        setProgress("Controller error");
        alert(`Controller rejected:\n${line}\n\n${response}`);
        return;
      }
    }

    setProgress("Stream complete");
  } catch (error) {
    setProgress("Stream failed");
    log(`ERROR: ${error.message}`);
    alert(error.message);
  }
}

document.querySelector("#generateBtn").addEventListener("click", () => {
  try {
    setGcode(buildGcode());
    setProgress("G-code generated");
  } catch (error) {
    alert(error.message);
  }
});

document.querySelector("#downloadBtn").addEventListener("click", () => {
  const lines = gcodeBox.value.trim() ? gcodeBox.value : generatedGcode.join("\n");
  if (!lines.trim()) {
    alert("Generate G-code first.");
    return;
  }

  const blob = new Blob([`${lines.trim()}\n`], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pattern.gcode";
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#clearBtn").addEventListener("click", () => {
  strokes = [];
  currentStroke = null;
  setGcode([]);
  gcodeBox.value = "";
  lineCount.textContent = "No generated lines.";
  redrawCanvas();
  setProgress("Drawing cleared");
});

document.querySelector("#connectBtn").addEventListener("click", connectSerial);
document.querySelector("#statusBtn").addEventListener("click", () => sendManual("?"));
document.querySelector("#armBtn").addEventListener("click", () => sendManual("ARM"));
document.querySelector("#disarmBtn").addEventListener("click", () => sendManual("DISARM"));
document.querySelector("#resetBtn").addEventListener("click", () => sendManual("RESET"));
document.querySelector("#streamBtn").addEventListener("click", streamGcode);
document.querySelector("#clearLogBtn").addEventListener("click", () => {
  logBox.textContent = "";
});

document.querySelector("#stopBtn").addEventListener("click", async () => {
  streamAbort = true;
  try {
    await writeLine("M112");
  } catch (error) {
    log(`ERROR: ${error.message}`);
  }
  setProgress("Emergency stop sent");
});

checkSupport();
resizeCanvasForDisplay();
setConnected(false);
