from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]
STORAGE_DIR = BASE_DIR / "storage"
SAMPLES_DIR = BASE_DIR / "samples"

API_PREFIX = "/api"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg", ".pdf"}

DEFAULT_BOARD_WIDTH_MM = 120.0
SAFE_Z_MM = 5.0
CUT_Z_MM = -0.08
DRILL_Z_MM = -1.2

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
