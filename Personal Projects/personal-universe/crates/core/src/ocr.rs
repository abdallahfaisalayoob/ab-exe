//! Text recognition for screenshots, photos of notes and scanned PDFs.
//!
//! Uses the OCR engine built into Windows 10/11 (Windows.Media.Ocr): nothing to download, nothing
//! sent anywhere. On other platforms (development builds) recognition is simply unavailable and
//! images are indexed by name and metadata as before.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// Set by the indexer from the user's setting before each run.
pub static ENABLED: AtomicBool = AtomicBool::new(true);
const MAX_SIDE: u32 = 3200;
const MAX_PDF_IMAGES: usize = 12;

pub fn on() -> bool {
    ENABLED.load(Ordering::Relaxed) && available()
}

#[cfg(windows)]
mod engine {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    pub fn available() -> bool {
        OcrEngine::TryCreateFromUserProfileLanguages().is_ok()
    }

    pub fn recognise(img: &image::RgbaImage) -> windows::core::Result<String> {
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let (w, h) = img.dimensions();
        let mut bgra = img.as_raw().clone();
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        let writer = DataWriter::new()?;
        writer.WriteBytes(&bgra)?;
        let buffer = writer.DetachBuffer()?;
        let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w as i32, h as i32, BitmapAlphaMode::Premultiplied)?;
        let result = engine.RecognizeAsync(&bitmap)?.join()?;
        let mut out = String::new();
        for line in result.Lines()? {
            out.push_str(&line.Text()?.to_string());
            out.push('\n');
        }
        Ok(out)
    }
}

#[cfg(windows)]
pub fn available() -> bool {
    static A: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *A.get_or_init(engine::available)
}
#[cfg(not(windows))]
pub fn available() -> bool {
    false
}

fn recognise(img: image::DynamicImage) -> Option<String> {
    let (w, h) = (img.width(), img.height());
    if w < 48 || h < 24 {
        return None;
    }
    // Very large photos are scaled down (faster, and within the engine's limits); small
    // screenshots are scaled up, which noticeably improves recognition of 12–13px text.
    let img = if w.max(h) > MAX_SIDE {
        img.resize(MAX_SIDE, MAX_SIDE, image::imageops::FilterType::Triangle)
    } else if w.max(h) < 1400 {
        img.resize(w * 2, h * 2, image::imageops::FilterType::CatmullRom)
    } else {
        img
    };
    let rgba = img.to_rgba8();
    #[cfg(windows)]
    {
        let text = engine::recognise(&rgba).ok()?;
        let text = text.trim().to_string();
        // A handful of stray characters is noise from a photo, not text worth indexing.
        return if text.chars().filter(|c| c.is_alphanumeric()).count() >= 6 { Some(text) } else { None };
    }
    #[cfg(not(windows))]
    {
        let _ = rgba;
        None
    }
}

pub fn image_text(path: &Path) -> Option<String> {
    if !on() {
        return None;
    }
    recognise(image::open(path).ok()?)
}

/// The JPEG page images inside a PDF. A scanned document is almost always one JPEG per page.
pub fn pdf_jpegs(path: &Path) -> Vec<Vec<u8>> {
    let Ok(doc) = lopdf::Document::load(path) else { return vec![] };
    let mut out = Vec::new();
    for obj in doc.objects.values() {
        let lopdf::Object::Stream(s) = obj else { continue };
        let is = |key: &[u8], want: &[u8]| match s.dict.get(key) {
            Ok(lopdf::Object::Name(n)) => n.as_slice() == want,
            Ok(lopdf::Object::Array(a)) => a.iter().any(|o| matches!(o, lopdf::Object::Name(n) if n.as_slice() == want)),
            _ => false,
        };
        if is(b"Subtype", b"Image") && is(b"Filter", b"DCTDecode") && s.content.len() > 8_000 {
            out.push(s.content.clone());
            if out.len() >= MAX_PDF_IMAGES {
                break;
            }
        }
    }
    out
}

/// Recognises the page images of a PDF that carries no text layer.
pub fn pdf_text(path: &Path) -> Option<String> {
    if !on() {
        return None;
    }
    let pages: Vec<String> = pdf_jpegs(path).iter().filter_map(|j| recognise(image::load_from_memory(j).ok()?)).collect();
    if pages.is_empty() { None } else { Some(pages.join("\n\n")) }
}
