from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from fastapi import UploadFile

from app.core.config import MAX_UPLOAD_BYTES, SUPPORTED_EXTENSIONS


@dataclass(slots=True)
class IngestedFile:
    file_name: str
    source_path: Path
    preview_path: Path
    image: np.ndarray


class FileIngestionError(ValueError):
    """Raised when a file cannot be loaded as a PCB design image."""


def _safe_file_name(name: str) -> str:
    keep = []
    for char in Path(name).name:
        if char.isalnum() or char in {".", "-", "_"}:
            keep.append(char)
    cleaned = "".join(keep).strip("._")
    return cleaned or "uploaded_pcb.png"


def _ensure_bgr(image: np.ndarray) -> np.ndarray:
    if image is None:
        raise FileIngestionError("The uploaded file could not be decoded as an image.")
    if len(image.shape) == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    if image.shape[2] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    return image


def _read_raster(path: Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    return _ensure_bgr(cv2.imdecode(data, cv2.IMREAD_UNCHANGED))


def _read_svg(path: Path) -> np.ndarray:
    try:
        import cairosvg
    except ImportError as exc:
        raise FileIngestionError(
            "SVG upload requires cairosvg. Install backend requirements and retry."
        ) from exc

    png_bytes = cairosvg.svg2png(url=str(path), output_width=1200)
    data = np.frombuffer(png_bytes, dtype=np.uint8)
    return _ensure_bgr(cv2.imdecode(data, cv2.IMREAD_UNCHANGED))


def _read_pdf(path: Path) -> np.ndarray:
    try:
        import fitz
    except ImportError as exc:
        raise FileIngestionError(
            "PDF upload requires pymupdf. Install backend requirements and retry."
        ) from exc

    document = fitz.open(path)
    if document.page_count == 0:
        raise FileIngestionError("The PDF has no pages to process.")
    page = document[0]
    pixmap = page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
    data = np.frombuffer(pixmap.samples, dtype=np.uint8)
    rgb = data.reshape((pixmap.height, pixmap.width, pixmap.n))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def load_design_image(path: Path) -> np.ndarray:
    ext = path.suffix.lower()
    if ext in {".png", ".jpg", ".jpeg"}:
        return _read_raster(path)
    if ext == ".svg":
        return _read_svg(path)
    if ext == ".pdf":
        return _read_pdf(path)
    raise FileIngestionError(f"Unsupported file type: {ext}")


async def ingest_upload(upload: UploadFile, project_dir: Path) -> IngestedFile:
    file_name = _safe_file_name(upload.filename or "uploaded_pcb.png")
    ext = Path(file_name).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise FileIngestionError(f"Unsupported file type. Supported formats: {supported}.")

    project_dir.mkdir(parents=True, exist_ok=True)
    source_path = project_dir / file_name
    total = 0
    with source_path.open("wb") as target:
        while chunk := await upload.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise FileIngestionError("File is too large. Maximum upload size is 25 MB.")
            target.write(chunk)

    image = load_design_image(source_path)
    preview_path = project_dir / "input.png"
    cv2.imwrite(str(preview_path), image)
    return IngestedFile(file_name=file_name, source_path=source_path, preview_path=preview_path, image=image)


def ingest_sample(source_path: Path, project_dir: Path) -> IngestedFile:
    project_dir.mkdir(parents=True, exist_ok=True)
    image = load_design_image(source_path)
    target_path = project_dir / source_path.name
    if source_path.resolve() != target_path.resolve():
        shutil.copyfile(source_path, target_path)
    preview_path = project_dir / "input.png"
    cv2.imwrite(str(preview_path), image)
    return IngestedFile(file_name=source_path.name, source_path=target_path, preview_path=preview_path, image=image)
