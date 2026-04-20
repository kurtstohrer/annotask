// Minimal HTTP server using only std — no external crates so `cargo run`
// is subsecond. Serves a JSON /api/health endpoint and an HTML fragment
// /api/health-fragment for the htmx MFE.

use std::env;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

fn main() -> std::io::Result<()> {
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4360);

    let listener = TcpListener::bind(("0.0.0.0", port))?;
    eprintln!("[rust-api] listening on http://localhost:{}", port);

    for stream in listener.incoming() {
        let stream = stream?;
        if let Err(err) = handle(stream, port) {
            eprintln!("[rust-api] handler error: {}", err);
        }
    }
    Ok(())
}

fn handle(mut stream: TcpStream, port: u16) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;

    // Consume remaining headers until blank line.
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 || line == "\r\n" {
            break;
        }
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");

    // htmx adds custom HX-* headers to every request, which triggers a
    // CORS preflight. Handle OPTIONS before anything else.
    if method == "OPTIONS" {
        let response = "HTTP/1.1 204 No Content\r\n\
            Access-Control-Allow-Origin: *\r\n\
            Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
            Access-Control-Allow-Headers: *\r\n\
            Access-Control-Max-Age: 86400\r\n\
            Content-Length: 0\r\n\r\n";
        stream.write_all(response.as_bytes())?;
        stream.flush()?;
        return Ok(());
    }

    let (status, content_type, body) = match (method, path) {
        ("GET", "/api/health") => (
            "200 OK",
            "application/json",
            format!(
                r#"{{"status":"ok","service":"rust-api","port":{},"version":"0.0.1"}}"#,
                port
            ),
        ),
        ("GET", "/api/health-fragment") => (
            "200 OK",
            "text/html; charset=utf-8",
            format!(
                r#"<dl class="kv"><dt>status</dt><dd>ok</dd><dt>service</dt><dd>rust-api</dd><dt>port</dt><dd>{}</dd><dt>version</dt><dd>0.0.1</dd></dl>"#,
                port
            ),
        ),
        _ => (
            "404 Not Found",
            "application/json",
            format!(r#"{{"error":"not_found","path":"{}"}}"#, path),
        ),
    };

    let response = format!(
        "HTTP/1.1 {status}\r\n\
        Content-Type: {content_type}\r\n\
        Content-Length: {len}\r\n\
        Access-Control-Allow-Origin: *\r\n\
        Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
        Access-Control-Allow-Headers: *\r\n\r\n\
        {body}",
        status = status,
        content_type = content_type,
        len = body.len(),
        body = body,
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()?;
    Ok(())
}
