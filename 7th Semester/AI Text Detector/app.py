"""Local web app for the AI-text detector.

    python app.py              # full mode (needs torch + transformers)
    python app.py --fast       # stylometry only, zero dependencies
    python app.py --port 8000 --no-browser

Opens http://127.0.0.1:8765 in your browser. Nothing leaves your machine:
the server only listens on localhost and all models run locally.
"""

import argparse
import json
import os
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

from aidetect import detector, humanizer, neural  # noqa: E402

STATIC = os.path.join(HERE, "static")
SAMPLES = os.path.join(HERE, "samples")
LOCK = threading.Lock()  # torch models are not re-entrant across threads
STATE = {"mode": "full", "ready": False, "loading": ""}


def list_samples():
    out = []
    if os.path.isdir(SAMPLES):
        for f in sorted(os.listdir(SAMPLES)):
            if f.endswith(".txt"):
                with open(os.path.join(SAMPLES, f), encoding="utf-8") as fh:
                    out.append({"name": f[:-4].replace("_", " "), "text": fh.read().strip()})
    return out


def warm_up():
    """Load the neural models in the background so the first click is fast."""
    if STATE["mode"] != "full":
        STATE["ready"] = True
        return
    try:
        with LOCK:
            for name in detector.ENSEMBLE["components"]:
                if name == "style":
                    continue
                STATE["loading"] = name
                print(f"  loading {name} ...", flush=True)
                if name == "binoculars":
                    neural._load_bino()
                else:
                    neural._load_clf(name)
        STATE["loading"] = ""
        print("  models ready.", flush=True)
    except Exception as e:
        print("  could not load neural models -> fast mode:", e, flush=True)
        STATE["mode"] = "fast"
    STATE["ready"] = True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            with open(os.path.join(STATIC, "index.html"), "rb") as fh:
                return self._send(200, fh.read(), "text/html; charset=utf-8")
        if self.path == "/api/status":
            return self._send(200, {**STATE, "ensemble": detector.ENSEMBLE.get("components"),
                                    "evaluation": detector.ENSEMBLE.get("evaluation_summary")})
        if self.path == "/api/samples":
            return self._send(200, list_samples())
        self._send(404, {"error": "not found"})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
            text = req.get("text", "")
            mode = req.get("mode") or STATE["mode"]
            if STATE["mode"] == "fast":
                mode = "fast"
            if self.path == "/api/analyze":
                t0 = time.time()
                with LOCK:
                    res = detector.analyze(text, mode=mode)
                res["seconds"] = round(time.time() - t0, 2)
                return self._send(200, res)
            if self.path == "/api/humanize":
                h = humanizer.humanize(text, strength=float(req.get("strength", 1.0)))
                with LOCK:
                    before = detector.analyze(text, mode=mode)
                    after = detector.analyze(h["text"], mode=mode)
                return self._send(200, {"text": h["text"], "edits": h["edits"],
                                        "before": before, "after": after})
            self._send(404, {"error": "not found"})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"error": str(e)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--fast", action="store_true", help="stylometry only (no torch needed)")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    if args.fast or not neural.available():
        if not args.fast:
            print("torch/transformers not found -> fast (stylometry-only) mode.\n"
                  "For full accuracy: pip install -r requirements.txt")
        STATE["mode"] = "fast"

    url = f"http://127.0.0.1:{args.port}"
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"AI Text Detector running at {url}  (mode: {STATE['mode']})  - Ctrl+C to stop")
    threading.Thread(target=warm_up, daemon=True).start()
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
