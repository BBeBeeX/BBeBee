fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
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



