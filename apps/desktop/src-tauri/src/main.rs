// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod secrets;
mod tunnel;

use tunnel::TunnelState;

#[tauri::command]
async fn tunnel_connect(config: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || tunnel::connect(&config))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn tunnel_disconnect() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(tunnel::disconnect)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn tunnel_state() -> TunnelState {
    tunnel::state()
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    secrets::get(&key)
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    secrets::set(&key, &value)
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    secrets::delete(&key)
}

#[tauri::command]
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PC".into())
}

fn main() {
    #[cfg(windows)]
    {
        let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
        // Started by the Service Control Manager as the WireGuard tunnel service.
        if args.len() == 3 && args[1] == "/service" {
            let ok = tunnel::run_service(std::path::Path::new(&args[2]));
            std::process::exit(if ok { 0 } else { 1 });
        }
        // Used by the uninstaller.
        if args.len() == 2 && args[1] == "/remove-tunnel" {
            let _ = tunnel::disconnect();
            return;
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            tunnel_connect,
            tunnel_disconnect,
            tunnel_state,
            secret_get,
            secret_set,
            secret_delete,
            device_name
        ])
        .run(tauri::generate_context!())
        .expect("error while running StormVPN");
}
