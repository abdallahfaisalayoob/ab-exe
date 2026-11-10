fn main() {
    // whisper.cpp reads the registry on Windows; the import library must come last on the link line.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
        println!("cargo:rustc-link-arg={}", if msvc { "advapi32.lib" } else { "-ladvapi32" });
    }
    tauri_build::build()
}
