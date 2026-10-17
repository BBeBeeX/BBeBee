fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();

    // `bundle.resources` is resolved by `tauri-build` at compile time, and a
    // missing resource path is a hard error. These staging directories are
    // gitignored and filled by the asset scripts (`fetch:audio-engine`,
    // `build:sidecar`), so a fresh checkout has none of them. Create them
    // empty: an empty resource directory is skipped silently, while its
    // absence would break every `cargo build` / `tauri dev` / `tauri build`.
    let desktop_dir = std::path::Path::new(&manifest_dir).join("..");
    for staging in ["bin", "resources/bin", "dist-sidecar"] {
        let _ = std::fs::create_dir_all(desktop_dir.join(staging));
    }

    println!("cargo:rustc-link-search=native={}/lib", manifest_dir);
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}/lib", manifest_dir);
    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let user_sysroot = format!("{}/.local/sysroot/usr/lib/x86_64-linux-gnu", home);
            if std::path::Path::new(&user_sysroot).exists() {
                println!("cargo:rustc-link-search=native={}", user_sysroot);
                println!("cargo:rustc-link-arg=-Wl,-rpath,{}", user_sysroot);
            }
        }
    }
    tauri_build::build();
}



