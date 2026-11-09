//! Development bridge: exposes the real core over localhost so the interface can be
//! developed and tested in a normal browser. Not shipped in the desktop app.
//!
//!   cargo run -p pu-core --features dev-server --bin pu-dev -- [data-dir] [port]

use pu_core::{dispatch, serve, Core};
use serde_json::{json, Value};
use tiny_http::{Header, Response, Server};

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let dir = args.next().unwrap_or_else(|| ".pu-dev-data".into());
    let port = args.next().unwrap_or_else(|| "4599".into());
    let core = Core::open(std::path::Path::new(&dir))?;
    let server = std::sync::Arc::new(Server::http(format!("127.0.0.1:{port}")).map_err(|e| anyhow::anyhow!("{e}"))?);
    eprintln!("pu-dev listening on 127.0.0.1:{port} (data: {dir})");
    let mut workers = Vec::new();
    for _ in 0..6 {
        let server = server.clone();
        let core = core.clone();
        workers.push(std::thread::spawn(move || loop {
            let Ok(mut req) = server.recv() else { break };
            let url = req.url().to_string();
            let json_h = Header::from_bytes("Content-Type", "application/json").unwrap();
            if url.starts_with("/__pu/invoke") {
                let mut body = String::new();
                let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
                let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let cmd = v.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
                let out = match dispatch(&core, cmd, v.get("args").unwrap_or(&Value::Null)) {
                    Ok(data) => json!({ "ok": true, "data": data }),
                    Err(e) => json!({ "ok": false, "error": format!("{e:#}") }),
                };
                let _ = req.respond(Response::from_string(out.to_string()).with_header(json_h));
            } else if let Some(rest) = url.strip_prefix("/__pu/") {
                let (route, query) = rest.split_once('?').unwrap_or((rest, ""));
                let path = query.split('&').find_map(|kv| kv.strip_prefix("path=")).map(serve::decode).unwrap_or_default();
                match serve::serve(&core, route, &path) {
                    Ok((bytes, mime)) => {
                        let h = Header::from_bytes("Content-Type", mime).unwrap();
                        let _ = req.respond(Response::from_data(bytes).with_header(h));
                    }
                    Err(e) => {
                        let _ = req.respond(Response::from_string(e.to_string()).with_status_code(404));
                    }
                }
            } else {
                let _ = req.respond(Response::from_string("not found").with_status_code(404));
            }
        }));
    }
    for w in workers {
        let _ = w.join();
    }
    Ok(())
}
