//! Optional local language model.
//!
//! Off by default. When the user turns it on, questions are sent to an
//! Ollama server on this computer - the address is fixed to the loopback
//! interface and cannot be changed from the interface, so nothing can be
//! sent to another machine. Every request is recorded in an audit log the
//! user can read.
//!
//! The model only chooses which calculation tools to call and phrases the
//! results; it never receives the transaction table.

use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{AppError, AppResult};

/// Loopback only. Not configurable by design.
pub const LOCAL_ENDPOINT: &str = "http://127.0.0.1:11434";
const DEFAULT_MODEL: &str = "llama3.1";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub enabled: bool,
    pub model: String,
    pub endpoint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLogEntry {
    pub at: String,
    pub model: String,
    pub destination: String,
    pub bytes_sent: i64,
    pub tools_offered: i64,
    pub ok: bool,
}

fn setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

pub fn settings(conn: &Connection) -> AppResult<AiSettings> {
    Ok(AiSettings {
        enabled: setting(conn, "ai_enabled")?.as_deref() == Some("1"),
        model: setting(conn, "ai_model")?.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        endpoint: LOCAL_ENDPOINT.to_string(),
    })
}

pub fn configure(conn: &Connection, enabled: bool, model: &str) -> AppResult<()> {
    let model = model.trim();
    let valid = !model.is_empty()
        && model.len() <= 80
        && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-' | '_' | '/'));
    if !valid {
        return Err(AppError::invalid("Enter a model name such as llama3.1 or qwen2.5:7b."));
    }
    for (key, value) in [("ai_enabled", if enabled { "1" } else { "0" }), ("ai_model", model)] {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
    }
    Ok(())
}

pub fn record(conn: &Connection, model: &str, bytes_sent: usize, tools_offered: usize, ok: bool) -> AppResult<()> {
    conn.execute(
        "INSERT INTO ai_log (model, destination, bytes_sent, tools_offered, ok) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![model, LOCAL_ENDPOINT, bytes_sent as i64, tools_offered as i64, ok],
    )?;
    // Keep the log bounded.
    conn.execute("DELETE FROM ai_log WHERE id NOT IN (SELECT id FROM ai_log ORDER BY id DESC LIMIT 500)", [])?;
    Ok(())
}

pub fn log(conn: &Connection) -> AppResult<Vec<AiLogEntry>> {
    let mut stmt = conn.prepare("SELECT at, model, destination, bytes_sent, tools_offered, ok FROM ai_log ORDER BY id DESC LIMIT 50")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AiLogEntry { at: r.get(0)?, model: r.get(1)?, destination: r.get(2)?, bytes_sent: r.get(3)?, tools_offered: r.get(4)?, ok: r.get(5)? })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// The assistant message returned by the model.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatReply {
    #[serde(default)]
    pub content: String,
    /// Tool calls requested by the model: `[{ name, arguments }]`.
    #[serde(default)]
    pub tool_calls: Vec<ToolRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolRequest {
    pub name: String,
    pub arguments: Value,
}

/// One round with the model. Returns the reply and the number of bytes sent.
pub fn chat(endpoint: &str, model: &str, messages: &Value, tools: &Value) -> AppResult<(ChatReply, usize)> {
    let body = json!({ "model": model, "messages": messages, "tools": tools, "stream": false, "options": { "temperature": 0 } });
    let bytes = body.to_string().len();
    let response = ureq::post(&format!("{endpoint}/api/chat"))
        .timeout(Duration::from_secs(120))
        .send_json(body)
        .map_err(|error| match error {
            ureq::Error::Status(404, _) => AppError::invalid(format!(
                "The local model \"{model}\" is not installed. Run: ollama pull {model}"
            )),
            ureq::Error::Status(code, _) => AppError::invalid(format!("The local model server answered with error {code}.")),
            ureq::Error::Transport(_) => AppError::invalid(
                "No local model server is running on this computer. Install Ollama and start it, or keep using the built-in answers.",
            ),
        })?;
    let value: Value = response.into_json().map_err(|e| AppError::Internal(e.to_string()))?;
    let message = value.get("message").ok_or_else(|| AppError::invalid("The local model returned an unexpected reply."))?;
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .filter_map(|call| {
                    let function = call.get("function")?;
                    Some(ToolRequest {
                        name: function.get("name")?.as_str()?.to_string(),
                        arguments: function.get("arguments").cloned().unwrap_or_else(|| json!({})),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let content = message.get("content").and_then(Value::as_str).unwrap_or_default().to_string();
    Ok((ChatReply { content, tool_calls }, bytes))
}

/// Whether a server answers on the loopback address, and which models it has.
pub fn installed_models(endpoint: &str) -> Option<Vec<String>> {
    let value: Value = ureq::get(&format!("{endpoint}/api/tags")).timeout(Duration::from_secs(2)).call().ok()?.into_json().ok()?;
    Some(
        value
            .get("models")?
            .as_array()?
            .iter()
            .filter_map(|m| m.get("name").and_then(Value::as_str).map(str::to_string))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// A one-shot HTTP server standing in for Ollama. Returns its address and the request it received.
    fn fake_server(status: &str, body: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let status = status.to_string();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let read = stream.read(&mut buffer).unwrap();
                request.extend_from_slice(&buffer[..read]);
                let text = String::from_utf8_lossy(&request);
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let length = text
                        .lines()
                        .find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                        .unwrap_or(0);
                    if request.len() >= head_end + 4 + length {
                        break;
                    }
                }
                if read == 0 {
                    break;
                }
            }
            write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            String::from_utf8_lossy(&request).into_owned()
        });
        (address, handle)
    }

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn
    }

    #[test]
    fn is_off_by_default_and_local_only() {
        let conn = db();
        let s = settings(&conn).unwrap();
        assert!(!s.enabled);
        assert_eq!(s.endpoint, "http://127.0.0.1:11434");
        assert!(LOCAL_ENDPOINT.starts_with("http://127.0.0.1:"));
    }

    #[test]
    fn configuration_round_trip_and_validation() {
        let conn = db();
        configure(&conn, true, " qwen2.5:7b ").unwrap();
        assert_eq!(settings(&conn).unwrap(), AiSettings { enabled: true, model: "qwen2.5:7b".into(), endpoint: LOCAL_ENDPOINT.into() });
        assert!(configure(&conn, true, "").is_err());
        assert!(configure(&conn, true, "model; rm -rf").is_err());
        assert!(configure(&conn, true, "http://evil.example/x?").is_err());
        configure(&conn, false, "qwen2.5:7b").unwrap();
        assert!(!settings(&conn).unwrap().enabled);
    }

    #[test]
    fn parses_a_tool_call_reply_and_sends_tools() {
        let (address, server) = fake_server(
            "200 OK",
            r#"{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"monthly_summary","arguments":{"month":"2026-11"}}}]}}"#,
        );
        let messages = json!([{ "role": "user", "content": "How much did I spend?" }]);
        let tools = json!([{ "type": "function", "function": { "name": "monthly_summary" } }]);
        let (reply, bytes) = chat(&address, "llama3.1", &messages, &tools).unwrap();
        assert_eq!(reply.tool_calls, [ToolRequest { name: "monthly_summary".into(), arguments: json!({ "month": "2026-11" }) }]);
        assert!(bytes > 50);
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /api/chat"));
        assert!(request.contains("\"stream\":false") && request.contains("monthly_summary") && request.contains("How much did I spend?"));
    }

    #[test]
    fn parses_a_final_text_reply() {
        let (address, server) = fake_server("200 OK", r#"{"message":{"role":"assistant","content":"You spent MAD 6,171.00."}}"#);
        let (reply, _) = chat(&address, "llama3.1", &json!([]), &json!([])).unwrap();
        assert_eq!(reply, ChatReply { content: "You spent MAD 6,171.00.".into(), tool_calls: vec![] });
        server.join().unwrap();
    }

    #[test]
    fn explains_a_missing_model_and_a_missing_server() {
        let (address, server) = fake_server("404 Not Found", r#"{"error":"model not found"}"#);
        let error = chat(&address, "llama3.1", &json!([]), &json!([])).unwrap_err();
        assert!(error.to_string().contains("ollama pull llama3.1"));
        server.join().unwrap();

        // Nothing listens on this port.
        let closed = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", closed.local_addr().unwrap());
        drop(closed);
        assert!(chat(&address, "llama3.1", &json!([]), &json!([])).unwrap_err().to_string().contains("No local model server"));
        assert_eq!(installed_models(&address), None);
    }

    #[test]
    fn audit_log_records_every_request() {
        let conn = db();
        record(&conn, "llama3.1", 1234, 9, true).unwrap();
        record(&conn, "llama3.1", 99, 9, false).unwrap();
        let entries = log(&conn).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!((entries[0].bytes_sent, entries[0].ok, entries[0].destination.as_str()), (99, false, LOCAL_ENDPOINT));
        assert_eq!(entries[1].tools_offered, 9);
    }
}
