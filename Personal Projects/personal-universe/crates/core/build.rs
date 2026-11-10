// Native link details for the bundled speech-recognition engine (whisper.cpp) on Windows.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let advapi = if msvc { "advapi32.lib" } else { "-ladvapi32" };
    println!("cargo:rustc-link-arg-tests={advapi}");
    println!("cargo:rustc-link-arg-bins={advapi}");
    if !msvc {
        static_runtime();
    }
}

/// MinGW only: make `-lstdc++` resolve to the static archive so the app ships without extra DLLs.
/// A folder holding only static archives is put on the search path ahead of the toolchain's own.
fn static_runtime() {
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("static-rt");
    std::fs::create_dir_all(&out).unwrap();
    for lib in ["libstdc++.a", "libwinpthread.a", "libpthread.a", "libgcc_eh.a"] {
        let found = std::process::Command::new("x86_64-w64-mingw32-g++").arg(format!("-print-file-name={lib}")).output();
        if let Ok(o) = found {
            let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if std::path::Path::new(&p).is_file() {
                let _ = std::fs::copy(&p, out.join(lib));
            }
        }
    }
    println!("cargo:rustc-link-search=native={}", out.display());
}
