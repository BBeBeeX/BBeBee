fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    println!("cargo:rustc-link-search=native={}/lib", manifest_dir);
    println!("cargo:rustc-link-search=native=/home/revers/.local/sysroot/usr/lib/x86_64-linux-gnu");
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}/lib", manifest_dir);
    println!("cargo:rustc-link-arg=-Wl,-rpath,/home/revers/.local/sysroot/usr/lib/x86_64-linux-gnu");
    tauri_build::build();
}
