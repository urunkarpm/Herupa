pub mod gemini;
pub mod secrets;
pub mod window;

use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use gemini::{send_gemini_request, transcribe_audio_request, SessionStore};
use secrets::SecretsManager;
use window::HoverManager;

pub struct AppState {
    pub secrets: SecretsManager,
    pub hover_manager: HoverManager,
    pub session_store: Arc<SessionStore>,
}

#[tauri::command]
fn get_api_key(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.secrets.get_api_key()
}

#[tauri::command]
fn save_api_key(key: String, state: State<'_, AppState>) -> Result<(), String> {
    state.secrets.store_api_key(&key)
}

#[tauri::command]
fn toggle_window(app_handle: AppHandle, state: State<'_, AppState>) {
    if let Some(window) = app_handle.get_webview_window("main") {
        state.hover_manager.toggle(&window);
    }
}

#[tauri::command]
fn set_input_focused(focused: bool, state: State<'_, AppState>) {
    state.hover_manager.set_input_focused(focused);
}

#[tauri::command]
fn clear_chat_history(state: State<'_, AppState>) {
    let history = Arc::clone(&state.session_store.history);
    tokio::spawn(async move {
        let mut h = history.lock().await;
        h.clear();
    });
}

#[tauri::command]
fn cancel_current_request(state: State<'_, AppState>) {
    let store = Arc::clone(&state.session_store);
    tokio::spawn(async move {
        let mut handle = store.current_abort_handle.lock().await;
        if let Some(h) = handle.take() {
            h.abort();
        }
    });
}

#[tauri::command]
async fn send_prompt(
    app_handle: AppHandle,
    prompt: String,
    system_instruction: Option<String>,
    image_base64: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let api_key = match state.secrets.get_api_key()? {
        Some(k) => k,
        None => return Err("API key not configured".to_string()),
    };

    send_gemini_request(
        app_handle,
        api_key,
        prompt,
        system_instruction,
        image_base64,
        Arc::clone(&state.session_store),
    )
    .await;

    Ok(())
}

#[tauri::command]
async fn transcribe_audio(
    audio_base64: String,
    mime_type: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let api_key = match state.secrets.get_api_key()? {
        Some(k) => k,
        None => return Err("API key not configured".to_string()),
    };

    transcribe_audio_request(api_key, audio_base64, mime_type).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::AppleScript,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            let app_handle = app.handle();

            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());

            let secrets = SecretsManager::new(app_dir);
            let hover_manager = HoverManager::new();
            let session_store = Arc::new(SessionStore::default());

            hover_manager.start_hover_monitor(app_handle.clone());

            app.manage(AppState {
                secrets,
                hover_manager,
                session_store,
            });

            // Set up tray menu
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let toggle_i = MenuItem::with_id(app, "toggle", "Toggle Assistant", true, None::<&str>)?;
            let menu = Menu::with_id_and_items(app, "tray_menu", &[&toggle_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "toggle" => {
                        let state = app.state::<AppState>();
                        if let Some(window) = app.get_webview_window("main") {
                            state.hover_manager.toggle(&window);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let state = app.state::<AppState>();
                            state.hover_manager.toggle(&window);
                        }
                    }
                })
                .build(app)?;

            // Register global hotkeys
            // 1. Toggle Window (Ctrl + Space)
            let ctrl_space = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
            // 2. Toggle Dictation / Voice Recording (Ctrl + Alt)
            let ctrl_alt = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyV);

            let ctrl_space_clone = ctrl_space.clone();
            let ctrl_alt_clone = ctrl_alt.clone();

            let _ = app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            if shortcut == &ctrl_space_clone {
                                let state = app.state::<AppState>();
                                if let Some(window) = app.get_webview_window("main") {
                                    state.hover_manager.toggle(&window);
                                }
                            } else if shortcut == &ctrl_alt_clone {
                                // Ensure window is visible/expanded and notify frontend
                                let state = app.state::<AppState>();
                                if let Some(window) = app.get_webview_window("main") {
                                    state.hover_manager.set_expanded(&window, true);
                                    let _ = window.emit("toggle-dictation", ());
                                }
                            }
                        }
                    })
                    .build(),
            );

            let _ = app.global_shortcut().register(ctrl_space);
            let _ = app.global_shortcut().register(ctrl_alt);

            // Apply vibrancy effect on supported platforms (Windows/macOS)
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    let _ = window_vibrancy::apply_mica(&window, Some(true));
                }
                #[cfg(target_os = "macos")]
                {
                    let _ = window_vibrancy::apply_vibrancy(&window, window_vibrancy::NSVisualEffectMaterial::HudWindow, None, None);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_api_key,
            save_api_key,
            toggle_window,
            set_input_focused,
            clear_chat_history,
            cancel_current_request,
            send_prompt,
            transcribe_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
