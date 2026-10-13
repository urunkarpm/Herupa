use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub const DEFAULT_GEMINI_MODEL: &str = "gemini-2.5-flash";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_base64: Option<String>,
}

#[derive(Default)]
pub struct SessionStore {
    pub history: Arc<Mutex<Vec<ChatMessage>>>,
    pub current_abort_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

#[derive(Serialize, Clone)]
pub struct ChunkPayload {
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct ErrorPayload {
    pub error: String,
}

pub fn parse_sse_event_line(line: &str) -> Option<String> {
    let line = line.trim();
    if line.starts_with("data:") {
        let json_str = line.trim_start_matches("data:").trim();
        if json_str == "[DONE]" {
            return None;
        }

        if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(candidates) = value.get("candidates").and_then(|c| c.as_array()) {
                if let Some(first_candidate) = candidates.first() {
                    if let Some(parts) = first_candidate.get("content").and_then(|c| c.get("parts")).and_then(|p| p.as_array()) {
                        let mut text_buf = String::new();
                        for part in parts {
                            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                                text_buf.push_str(text);
                            }
                        }
                        if !text_buf.is_empty() {
                            return Some(text_buf);
                        }
                    }
                }
            }
        }
    }
    None
}

pub async fn send_gemini_request(
    app_handle: AppHandle,
    api_key: String,
    prompt: String,
    system_instruction: Option<String>,
    image_base64: Option<String>,
    session_store: Arc<SessionStore>,
) {
    // Cancel in-flight request if exists
    {
        let mut handle_lock = session_store.current_abort_handle.lock().await;
        if let Some(handle) = handle_lock.take() {
            handle.abort();
        }
    }

    let history_arc = Arc::clone(&session_store.history);
    let app_clone = app_handle.clone();

    let task = tokio::spawn(async move {
        let mut history = history_arc.lock().await;

        let mut contents = Vec::new();
        for msg in history.iter() {
            let role = if msg.role == "user" { "user" } else { "model" };
            let mut parts = vec![json!({ "text": msg.content })];
            if let Some(ref img) = msg.image_base64 {
                parts.push(json!({
                    "inline_data": {
                        "mime_type": "image/png",
                        "data": img
                    }
                }));
            }
            contents.push(json!({
                "role": role,
                "parts": parts
            }));
        }

        let mut new_parts = vec![json!({ "text": prompt })];
        if let Some(ref img) = image_base64 {
            new_parts.push(json!({
                "inline_data": {
                    "mime_type": "image/png",
                    "data": img
                }
            }));
        }

        contents.push(json!({
            "role": "user",
            "parts": new_parts
        }));

        let mut request_body = json!({
            "contents": contents
        });

        if let Some(instruction) = system_instruction {
            if !instruction.trim().is_empty() {
                request_body["systemInstruction"] = json!({
                    "parts": [{ "text": instruction }]
                });
            }
        }

        let client = Client::new();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
            DEFAULT_GEMINI_MODEL, api_key
        );

        let res = match client.post(&url).json(&request_body).send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = app_clone.emit("ai-error", ErrorPayload { error: e.to_string() });
                return;
            }
        };

        if !res.status().is_success() {
            let err_text = res.text().await.unwrap_or_else(|_| "Unknown API error".to_string());
            let _ = app_clone.emit("ai-error", ErrorPayload { error: err_text });
            return;
        }

        let mut stream = res.bytes_stream();
        let mut accumulated_response = String::new();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    buffer.push_str(&text);

                    while let Some(idx) = buffer.find('\n') {
                        let line = buffer[..idx].trim_end_matches('\r').to_string();
                        buffer.drain(..=idx);

                        if let Some(text_chunk) = parse_sse_event_line(&line) {
                            accumulated_response.push_str(&text_chunk);
                            let _ = app_clone.emit("ai-chunk", ChunkPayload { text: text_chunk });
                        }
                    }
                }
                Err(e) => {
                    let _ = app_clone.emit("ai-error", ErrorPayload { error: e.to_string() });
                    return;
                }
            }
        }

        if !buffer.is_empty() {
            if let Some(text_chunk) = parse_sse_event_line(&buffer) {
                accumulated_response.push_str(&text_chunk);
                let _ = app_clone.emit("ai-chunk", ChunkPayload { text: text_chunk });
            }
        }

        // Save conversation to in-memory history
        history.push(ChatMessage {
            role: "user".to_string(),
            content: prompt,
            image_base64,
        });

        history.push(ChatMessage {
            role: "model".to_string(),
            content: accumulated_response,
            image_base64: None,
        });

        let _ = app_clone.emit("ai-done", ());
    });

    let mut handle_lock = session_store.current_abort_handle.lock().await;
    *handle_lock = Some(task);
}

pub async fn transcribe_audio_request(
    api_key: String,
    audio_base64: String,
    mime_type: String,
) -> Result<String, String> {
    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        DEFAULT_GEMINI_MODEL, api_key
    );

    let request_body = json!({
        "contents": [{
            "parts": [
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": audio_base64
                    }
                },
                {
                    "text": "Transcribe the spoken audio accurately into text. Return ONLY the transcription text, nothing else."
                }
            ]
        }]
    });

    let res = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_else(|_| "Unknown API error".to_string());
        return Err(err_text);
    }

    let value: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(candidates) = value.get("candidates").and_then(|c| c.as_array()) {
        if let Some(first_candidate) = candidates.first() {
            if let Some(parts) = first_candidate.get("content").and_then(|c| c.get("parts")).and_then(|p| p.as_array()) {
                let mut transcription = String::new();
                for part in parts {
                    if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                        transcription.push_str(text);
                    }
                }
                return Ok(transcription.trim().to_string());
            }
        }
    }

    Err("No transcription returned from Gemini".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sse_event_line_valid() {
        let sample_sse = r#"data: {"candidates": [{"content": {"parts": [{"text": "Hello world!"}]}}]}"#;
        assert_eq!(parse_sse_event_line(sample_sse), Some("Hello world!".to_string()));
    }

    #[test]
    fn test_parse_sse_event_line_done() {
        let sample_sse = "data: [DONE]";
        assert_eq!(parse_sse_event_line(sample_sse), None);
    }

    #[test]
    fn test_parse_sse_event_line_invalid() {
        let sample_sse = "data: invalid json";
        assert_eq!(parse_sse_event_line(sample_sse), None);
    }
}
