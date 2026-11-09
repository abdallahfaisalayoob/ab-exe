//! Desktop shell. Deliberately thin: every capability lives in `pu-core`, and the
//! interface reaches it through one command (`pu`) plus the read-only `pu://` protocol.

use pu_core::{dispatch, serve, Core};
use serde_json::Value;
use std::sync::Arc;
use tauri::http::{Response, StatusCode};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

struct AppCore(Arc<Core>);

#[tauri::command]
async fn pu(state: tauri::State<'_, AppCore>, cmd: String, args: Option<Value>) -> Result<Value, String> {
    let core = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || dispatch(&core, &cmd, &args.unwrap_or(Value::Null)).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

/// Opens a file or folder with its default Windows application.
#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err("That file is no longer at its original location.".into());
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err("That file is no longer at its original location.".into());
    }
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// Only ever called after an explicit confirmation in the interface.
#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web links can be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .register_asynchronous_uri_scheme_protocol("pu", |ctx, request, responder| {
            let Some(state) = ctx.app_handle().try_state::<AppCore>() else {
                responder.respond(Response::builder().status(StatusCode::SERVICE_UNAVAILABLE).body(Vec::new()).unwrap());
                return;
            };
            let core = state.0.clone();
            let route = request.uri().path().trim_matches('/').to_string();
            let path = serve::parse_query(request.uri().query().unwrap_or(""));
            // Thumbnails can take a moment to render; keep them off the UI thread.
            std::thread::spawn(move || {
                let response = match serve::serve(&core, &route, &path) {
                    Ok((bytes, mime)) => Response::builder()
                        .header("Content-Type", mime)
                        .header("Cache-Control", "private, max-age=86400")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes)
                        .unwrap(),
                    Err(_) => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
                };
                responder.respond(response);
            });
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let core = Core::open(&dir).map_err(|e| format!("Could not open the local database: {e:#}"))?;
            app.manage(AppCore(core));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pu, open_path, reveal_path, open_url])
        .run(tauri::generate_context!())
        .expect("error while running Personal Universe");
}
