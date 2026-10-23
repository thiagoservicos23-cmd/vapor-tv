use base64::Engine;
use once_cell::sync::Lazy;
use std::io::Cursor;
use tiny_http::{Header, Method, Response, Server, StatusCode};

static HTTP_CLIENT: Lazy<reqwest::blocking::Client> = Lazy::new(|| {
    reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 VLC/3.0")
        // O padrao do reqwest blocking e 30s TOTAL (inclui o corpo): cortava o stream
        // ao vivo a cada 30s e causava travadas/delays. Aqui: sem timeout no corpo.
        .timeout(None::<std::time::Duration>)
        .connect_timeout(std::time::Duration::from_secs(8))
        .tcp_nodelay(true)
        .pool_max_idle_per_host(0)
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .unwrap()
});

fn header(name: &[u8], value: &[u8]) -> Header {
    Header::from_bytes(name, value).unwrap()
}

/// Proxy HTTP local em 127.0.0.1 que faz streaming chunked dos streams .ts
/// e contorna CORS. Endpoint: GET /proxy?u=<base64url(remote_url)>
fn handle_request(request: tiny_http::Request) {
    // CORS preflight
    if request.method() == &Method::Options {
        let resp = Response::new(
            StatusCode(204),
            vec![
                header(b"Access-Control-Allow-Origin", b"*"),
                header(b"Access-Control-Allow-Methods", b"GET, OPTIONS"),
                header(b"Access-Control-Allow-Headers", b"Range, *"),
                header(b"Access-Control-Expose-Headers", b"Content-Length, Content-Range"),
            ],
            Cursor::new(Vec::new()),
            Some(0),
            None,
        );
        let _ = request.respond(resp);
        return;
    }

    let url = request.url().to_string();
    let remote_url = url
        .split_once('?')
        .and_then(|(_, q)| q.split('&').find_map(|kv| kv.strip_prefix("u=")))
        .and_then(|v| {
            let v = v.replace('-', "+").replace('_', "/");
            let pad = (4 - v.len() % 4) % 4;
            let v = format!("{}{}", v, "=".repeat(pad));
            base64::engine::general_purpose::STANDARD.decode(v).ok()
        })
        .and_then(|b| String::from_utf8(b).ok());

    let cors_headers = vec![
        header(b"Access-Control-Allow-Origin", b"*"),
        header(b"Access-Control-Expose-Headers", b"Content-Length, Content-Range"),
        header(b"Cache-Control", b"no-store"),
    ];

    let remote_url = match remote_url {
        Some(u) => u,
        None => {
            let body = b"missing u param".to_vec();
            let mut h = vec![header(b"Content-Type", b"text/plain")];
            h.extend(cors_headers.clone());
            let len = body.len();
            let _ = request.respond(Response::new(StatusCode(400), h, Cursor::new(body), Some(len), None));
            return;
        }
    };

    // repassa header Range
    let range = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());

    let mut builder = HTTP_CLIENT
        .get(&remote_url)
        .header("Accept", "*/*")
        .header("Connection", "close");
    if let Some(r) = range {
        builder = builder.header("Range", r);
    }

    match builder.send() {
        Ok(res) => {
            let status = StatusCode(res.status().as_u16());
            let content_type = res
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("video/mp2t")
                .to_string();
            let content_length = res
                .headers()
                .get(reqwest::header::CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<usize>().ok());
            let content_range = res
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            let mut h = vec![header(b"Content-Type", content_type.as_bytes())];
            if let Some(cr) = content_range {
                h.push(header(b"Content-Range", cr.as_bytes()));
            }
            h.extend(cors_headers);

            // data_length = None => transfer-encoding: chunked (streaming real)
            let _ = request.respond(Response::new(status, h, res, content_length, None));
        }
        Err(e) => {
            let body = format!("stream error: {}", e).into_bytes();
            let mut h = vec![header(b"Content-Type", b"text/plain")];
            h.extend(cors_headers);
            let len = body.len();
            let _ = request.respond(Response::new(StatusCode(502), h, Cursor::new(body), Some(len), None));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Sobe proxy local em porta fixa 14311 — o frontend usa essa mesma porta.
    let server = Server::http("127.0.0.1:14311")
        .expect("failed to start local stream proxy: port 14311 occupied (feche outro app usando-a)");

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            std::thread::spawn(move || handle_request(request));
        }
    });

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Vapor TV");
}
