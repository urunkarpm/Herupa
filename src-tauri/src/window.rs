use tauri::{AppHandle, Manager, WebviewWindow, Emitter};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::sleep;

#[derive(Clone, serde::Serialize)]
pub struct WindowStatePayload {
    pub expanded: bool,
}

pub struct HoverManager {
    is_expanded: Arc<AtomicBool>,
    is_input_focused: Arc<AtomicBool>,
}

impl HoverManager {
    pub fn new() -> Self {
        Self {
            is_expanded: Arc::new(AtomicBool::new(false)),
            is_input_focused: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_expanded(&self) -> bool {
        self.is_expanded.load(Ordering::Relaxed)
    }

    pub fn set_input_focused(&self, focused: bool) {
        self.is_input_focused.store(focused, Ordering::Relaxed);
    }

    pub fn toggle(&self, window: &WebviewWindow) {
        let current = self.is_expanded.load(Ordering::Relaxed);
        self.set_expanded(window, !current);
    }

    pub fn set_expanded(&self, window: &WebviewWindow, expanded: bool) {
        self.is_expanded.store(expanded, Ordering::Relaxed);
        let _ = window.emit("window-state-changed", WindowStatePayload { expanded });

        // When expanded, process mouse events normally. When collapsed, pass clicks through.
        let ignore = !expanded;
        let _ = window.set_ignore_cursor_events(ignore);
    }

    pub fn start_hover_monitor(&self, app_handle: AppHandle) {
        let is_expanded = Arc::clone(&self.is_expanded);
        let is_input_focused = Arc::clone(&self.is_input_focused);

        tokio::spawn(async move {
            let mut hover_start: Option<Instant> = None;
            let mut outside_start: Option<Instant> = None;

            loop {
                sleep(Duration::from_millis(30)).await;

                let window = match app_handle.get_webview_window("main") {
                    Some(w) => w,
                    None => continue,
                };

                let monitor = match window.primary_monitor() {
                    Ok(Some(m)) => m,
                    _ => continue,
                };

                let m_size = monitor.size();
                let window_width = 720;
                let bar_x_start = (m_size.width as i32 - window_width) / 2;
                let bar_x_end = bar_x_start + window_width;

                if let Ok(pos) = window.outer_position() {
                    if pos.x != bar_x_start || pos.y != 0 {
                        let _ = window.set_position(tauri::PhysicalPosition::new(bar_x_start, 0));
                    }
                }

                let cursor_pos = get_cursor_position();
                let expanded = is_expanded.load(Ordering::Relaxed);
                let focused = is_input_focused.load(Ordering::Relaxed);

                if let Some((cx, cy)) = cursor_pos {
                    // Check top 2px edge inside horizontal span
                        let is_in_trigger_zone = cy <= 2 && cx >= bar_x_start && cx <= bar_x_end;

                        // Check if inside expanded window area (top 520px)
                        let is_inside_expanded_window = cy >= 0 && cy <= 520 && cx >= bar_x_start && cx <= bar_x_end;

                        if !expanded {
                            if is_in_trigger_zone {
                                outside_start = None;
                                if hover_start.is_none() {
                                    hover_start = Some(Instant::now());
                                } else if let Some(start) = hover_start {
                                    if start.elapsed() >= Duration::from_millis(150) {
                                        is_expanded.store(true, Ordering::Relaxed);
                                        let _ = window.emit("window-state-changed", WindowStatePayload { expanded: true });
                                        let _ = window.set_ignore_cursor_events(false);
                                        hover_start = None;
                                    }
                                }
                            } else {
                                hover_start = None;
                            }
                        } else {
                            // Currently expanded
                            hover_start = None;
                            if !is_inside_expanded_window && !focused {
                                if outside_start.is_none() {
                                    outside_start = Some(Instant::now());
                                } else if let Some(start) = outside_start {
                                    if start.elapsed() >= Duration::from_millis(400) {
                                        is_expanded.store(false, Ordering::Relaxed);
                                        let _ = window.emit("window-state-changed", WindowStatePayload { expanded: false });
                                        let _ = window.set_ignore_cursor_events(true);
                                        outside_start = None;
                                    }
                                }
                            } else {
                                outside_start = None;
                            }
                        }
                    }
                }
            }
        });
    }
}

pub fn get_cursor_position() -> Option<(i32, i32)> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
        use windows_sys::Win32::Foundation::POINT;
        unsafe {
            let mut point = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut point) != 0 {
                return Some((point.x, point.y));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use device_query::{DeviceQuery, DeviceState, MouseState};
        let device_state = DeviceState::new();
        let mouse: MouseState = device_state.get_mouse();
        return Some((mouse.coords.0, mouse.coords.1));
    }

    #[allow(unreachable_code)]
    None
}
