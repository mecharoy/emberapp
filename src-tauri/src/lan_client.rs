// The phone's side of the link with Ember on a computer: finding it on the
// home network, pairing, and sealed requests (sync, and chat with the model
// running there). The lasting key lives beside the API keys, never in ember.db.

use crate::lan_proto::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::Manager;
use tokio::sync::oneshot;

#[derive(Clone, Serialize, Deserialize)]
struct Link {
    desktop_id: String,
    desktop_name: String,
    address: String,
    key: String,
    phone_id: String,
    paired_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    desktop_id: String,
    desktop_name: String,
    address: String,
    paired_at: u64,
}

impl From<&Link> for LinkInfo {
    fn from(l: &Link) -> Self {
        Self {
            desktop_id: l.desktop_id.clone(),
            desktop_name: l.desktop_name.clone(),
            address: l.address.clone(),
            paired_at: l.paired_at,
        }
    }
}

#[derive(Serialize)]
pub struct Found {
    id: String,
    name: String,
    address: String,
}

pub struct LanClient {
    http: reqwest::Client,
    chats: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl Default for LanClient {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(4))
                .build()
                .expect("http client"),
            chats: Mutex::default(),
        }
    }
}

fn link_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not find the app's data folder: {e}"))?
        .join("secrets");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("lan_link"))
}

fn load_link(app: &tauri::AppHandle) -> Option<Link> {
    let text = std::fs::read_to_string(link_path(app).ok()?).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_link(app: &tauri::AppHandle, link: &Link) -> Result<(), String> {
    let path = link_path(app)?;
    std::fs::write(&path, serde_json::to_string(link).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// "192.168.1.20" or "192.168.1.20:47821" → "192.168.1.20:47821".
fn normalize_address(address: &str) -> Result<String, String> {
    let a = address.trim().trim_start_matches("http://").trim_end_matches('/');
    if a.is_empty() || a.contains('/') || a.contains(' ') {
        return Err("Invalid address. Use the one shown on the computer, e.g. 192.168.1.20:47821.".into());
    }
    Ok(if a.contains(':') { a.to_string() } else { format!("{a}:{SERVER_PORT}") })
}

fn random_id() -> String {
    let bytes: [u8; 16] = rand::random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unreachable(name: &str) -> String {
    format!(
        "Can't reach {name}. Check that Ember is open there with phone sync on, and both are on the same network. \
         Campus and office Wi-Fi often block this; connect the computer to this phone's hotspot instead."
    )
}

async fn discover() -> Vec<Found> {
    let Ok(socket) = tokio::net::UdpSocket::bind(("0.0.0.0", 0)).await else {
        return Vec::new();
    };
    if socket.set_broadcast(true).is_err() {
        return Vec::new();
    }
    let _ = socket.send_to(DISCOVERY_ASK, ("255.255.255.255", DISCOVERY_PORT)).await;
    let mut found: Vec<Found> = Vec::new();
    let mut buf = [0u8; 1024];
    let deadline = tokio::time::Instant::now() + Duration::from_millis(1500);
    while let Ok(Ok((n, from))) = tokio::time::timeout_at(deadline, socket.recv_from(&mut buf)).await {
        let Ok(answer) = serde_json::from_slice::<Value>(&buf[..n]) else { continue };
        if answer["app"] != "ember" {
            continue;
        }
        let (Some(id), Some(port)) = (answer["id"].as_str(), answer["port"].as_u64()) else { continue };
        if found.iter().any(|f| f.id == id) {
            continue;
        }
        found.push(Found {
            id: id.to_string(),
            name: answer["name"].as_str().unwrap_or("Computer").to_string(),
            address: format!("{}:{port}", from.ip()),
        });
    }
    found
}

fn error_text(body: &str, fallback: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"].as_str().map(String::from))
        .unwrap_or_else(|| fallback.to_string())
}

impl LanClient {
    /// Sends a sealed request. If the computer moved to another address, it
    /// is looked for once on the network and the new address remembered.
    async fn send_sealed(
        &self,
        app: &tauri::AppHandle,
        path: &str,
        kind: &str,
        payload: Value,
        request_id: &str,
    ) -> Result<(Link, reqwest::Response), String> {
        let mut link = load_link(app).ok_or("Not paired with a computer.")?;
        let key = key_from_b64(&link.key)?;
        let plain = json!({ "id": request_id, "ts": now_secs(), "kind": kind, "payload": payload });
        let sealed = seal(&key, &call_context(path, &link.phone_id), plain.to_string().as_bytes());
        let body = json!({ "peer": link.phone_id, "data": b64(&sealed) });

        let mut attempt = 0;
        loop {
            let url = format!("http://{}/ember/{path}", link.address);
            match self.http.post(&url).json(&body).send().await {
                Ok(response) => return Ok((link, response)),
                Err(e) if attempt == 0 && (e.is_connect() || e.is_timeout()) => {
                    attempt += 1;
                    let Some(moved) = discover().await.into_iter().find(|f| f.id == link.desktop_id) else {
                        return Err(unreachable(&link.desktop_name));
                    };
                    if moved.address == link.address {
                        return Err(unreachable(&link.desktop_name));
                    }
                    link.address = moved.address;
                    save_link(app, &link)?;
                }
                Err(_) => return Err(unreachable(&link.desktop_name)),
            }
        }
    }
}

// ---------- commands ----------

#[tauri::command]
pub async fn lan_discover() -> Vec<Found> {
    discover().await
}

#[tauri::command]
pub fn lan_link(app: tauri::AppHandle) -> Option<LinkInfo> {
    load_link(&app).as_ref().map(LinkInfo::from)
}

#[tauri::command]
pub fn lan_unlink(app: tauri::AppHandle) -> Result<(), String> {
    match std::fs::remove_file(link_path(&app)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn lan_pair(
    app: tauri::AppHandle,
    client: tauri::State<'_, LanClient>,
    address: String,
    code: String,
    phone_id: String,
    phone_name: String,
) -> Result<LinkInfo, String> {
    let address = normalize_address(&address)?;
    if normalize_code(&code).len() != 10 {
        return Err("The code is 10 letters and digits.".into());
    }
    if phone_id.trim().is_empty() || phone_id.len() > 64 {
        return Err("Restart Ember and try again.".into());
    }

    let hello: Value = client
        .http
        .get(format!("http://{address}/ember/hello"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|_| unreachable("the computer"))?
        .json()
        .await
        .map_err(|_| "No Ember at that address.".to_string())?;
    if hello["app"] != "ember" {
        return Err("No Ember at that address.".into());
    }
    let desktop_id = hello["id"].as_str().unwrap_or_default().to_string();

    let code_for_key = code.clone();
    let id_for_key = desktop_id.clone();
    let pair_key = tauri::async_runtime::spawn_blocking(move || pairing_key(&code_for_key, &id_for_key))
        .await
        .map_err(|e| e.to_string())?;
    let hello_sealed = seal(
        &pair_key,
        &pair_context(&phone_id),
        json!({ "phone_id": phone_id, "phone_name": phone_name, "ts": now_secs() }).to_string().as_bytes(),
    );
    let response = client
        .http
        .post(format!("http://{address}/ember/pair"))
        .timeout(Duration::from_secs(20))
        .json(&json!({ "phone_id": phone_id, "data": b64(&hello_sealed) }))
        .send()
        .await
        .map_err(|_| unreachable("the computer"))?;
    let ok = response.status().is_success();
    let text = response.text().await.unwrap_or_default();
    if !ok {
        return Err(error_text(&text, "The computer refused to pair."));
    }
    let reply: Value = serde_json::from_str(&text).map_err(|_| "Garbled message.".to_string())?;
    let plain = open(&pair_key, &pair_reply_context(&phone_id), &unb64(reply["data"].as_str().unwrap_or_default())?)?;
    let granted: Value = serde_json::from_slice(&plain).map_err(|_| "Garbled message.".to_string())?;
    let key = granted["key"].as_str().ok_or("Garbled message.")?;
    key_from_b64(key)?;

    let link = Link {
        desktop_id: granted["desktop_id"].as_str().unwrap_or(&desktop_id).to_string(),
        desktop_name: granted["desktop_name"].as_str().unwrap_or("Computer").to_string(),
        address,
        key: key.to_string(),
        phone_id,
        paired_at: now_secs(),
    };
    save_link(&app, &link)?;
    Ok(LinkInfo::from(&link))
}

/// A sealed request with a sealed reply: "status" or "sync".
#[tauri::command]
pub async fn lan_call(
    app: tauri::AppHandle,
    client: tauri::State<'_, LanClient>,
    kind: String,
    payload: Value,
) -> Result<Value, String> {
    let request_id = random_id();
    let (link, response) = client.send_sealed(&app, "call", &kind, payload, &request_id).await?;
    let status = response.status();
    let text = tokio::time::timeout(Duration::from_secs(150), response.text())
        .await
        .map_err(|_| format!("{} took too long to answer.", link.desktop_name))?
        .map_err(|_| unreachable(&link.desktop_name))?;
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(format!("unpaired: {}", error_text(&text, "Pair with the computer again.")));
    }
    if !status.is_success() {
        return Err(error_text(&text, "The computer refused the request."));
    }
    let key = key_from_b64(&link.key)?;
    let plain = open(&key, &reply_context(&request_id), &unb64(&text)?)?;
    let reply: Value = serde_json::from_slice(&plain).map_err(|_| "Garbled message.".to_string())?;
    if reply["ok"] == true {
        Ok(reply["payload"].clone())
    } else {
        Err(reply["error"].as_str().unwrap_or("The computer couldn't do that.").to_string())
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatEvent {
    Status { status: u16, error: Option<String> },
    Line { line: String },
    Done,
    Error { message: String },
}

/// Chat with the computer's model. The reply's lines (Ollama's own JSON
/// lines) arrive on `on_event`; lan_chat_cancel stops it.
#[tauri::command]
pub async fn lan_chat(
    app: tauri::AppHandle,
    client: tauri::State<'_, LanClient>,
    request_id: String,
    body: Value,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 64 || !request_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid request id.".into());
    }
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    client.chats.lock().unwrap().insert(request_id.clone(), cancel_tx);
    let result = run_chat(&app, &client, &request_id, body, &on_event, &mut cancel_rx).await;
    client.chats.lock().unwrap().remove(&request_id);
    if let Err(message) = &result {
        let _ = on_event.send(ChatEvent::Error { message: message.clone() });
    }
    result
}

async fn run_chat(
    app: &tauri::AppHandle,
    client: &LanClient,
    request_id: &str,
    body: Value,
    on_event: &Channel<ChatEvent>,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<(), String> {
    let (link, mut response) = client.send_sealed(app, "chat", "chat", body, request_id).await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("unpaired: {}", error_text(&text, "Pair with the computer again.")));
    }
    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(error_text(&text, "The computer refused the request."));
    }
    let key = key_from_b64(&link.key)?;
    let mut frames = FrameReader::new(key, request_id);
    let mut pending_line: Vec<u8> = Vec::new();

    loop {
        let chunk = tokio::select! {
            _ = &mut *cancel => {
                let _ = on_event.send(ChatEvent::Done);
                return Ok(()); // dropping the response hangs up; the computer stops the model
            }
            chunk = response.chunk() => chunk,
        };
        match chunk {
            Ok(Some(bytes)) => {
                frames.push(&bytes);
                while let Some((kind, data)) = frames.next()? {
                    match kind {
                        FRAME_STATUS => {
                            let v: Value = serde_json::from_slice(&data).unwrap_or(Value::Null);
                            let _ = on_event.send(ChatEvent::Status {
                                status: v["status"].as_u64().unwrap_or(500) as u16,
                                error: v["error"].as_str().map(String::from),
                            });
                        }
                        FRAME_DATA => {
                            pending_line.extend_from_slice(&data);
                            while let Some(nl) = pending_line.iter().position(|b| *b == b'\n') {
                                let line: Vec<u8> = pending_line.drain(..=nl).collect();
                                let text = String::from_utf8_lossy(&line).trim().to_string();
                                if !text.is_empty() {
                                    let _ = on_event.send(ChatEvent::Line { line: text });
                                }
                            }
                        }
                        FRAME_END => {
                            let rest = String::from_utf8_lossy(&pending_line).trim().to_string();
                            if !rest.is_empty() {
                                let _ = on_event.send(ChatEvent::Line { line: rest });
                            }
                            let _ = on_event.send(ChatEvent::Done);
                            return Ok(());
                        }
                        FRAME_ERROR => return Err(String::from_utf8_lossy(&data).to_string()),
                        _ => return Err("Garbled message.".into()),
                    }
                }
            }
            Ok(None) => return Err(format!("The connection to {} dropped before the reply finished.", link.desktop_name)),
            Err(_) => return Err(format!("The connection to {} dropped before the reply finished.", link.desktop_name)),
        }
    }
}

#[tauri::command]
pub fn lan_chat_cancel(client: tauri::State<'_, LanClient>, request_id: String) {
    if let Some(tx) = client.chats.lock().unwrap().remove(&request_id) {
        let _ = tx.send(());
    }
}
