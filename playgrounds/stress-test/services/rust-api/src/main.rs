// Minimal HTTP server using only std — no external crates so `cargo run`
// is subsecond. Serves JSON endpoints for the htmx MFE (/api/health,
// /api/component-usage), an HTML fragment (/api/health-fragment), and the
// OpenAPI document at /openapi.json (included via include_str! so the spec
// lives in the same dir as the code).

use std::env;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

const OPENAPI_SPEC: &str = include_str!("../openapi.json");

// Mirrors packages/shared-fixtures/index.ts. Kept inline as a JSON array
// literal because we're stdlib-only (no serde).
const COMPONENT_USAGE_JSON: &str = r#"[
  {"id":"cu-1","name":"Button","framework":"React","library":"mantine","uses":42},
  {"id":"cu-2","name":"Card","framework":"React","library":"mantine","uses":28},
  {"id":"cu-3","name":"NButton","framework":"Vue","library":"naive-ui","uses":37},
  {"id":"cu-4","name":"NDataTable","framework":"Vue","library":"naive-ui","uses":14},
  {"id":"cu-5","name":"Button","framework":"Solid","library":"kobalte","uses":19},
  {"id":"cu-6","name":"Dialog","framework":"Svelte","library":"bits-ui","uses":11}
]"#;

// Server-rendered HTML fragment of the same data, for htmx hx-get. Keeping
// this inline as a string literal avoids pulling in a template engine.
const COMPONENT_USAGE_FRAGMENT: &str = r#"<table>
  <thead><tr><th>Name</th><th>Framework</th><th>Library</th><th>Uses</th></tr></thead>
  <tbody>
    <tr><td><code>Button</code></td><td>React</td><td>mantine</td><td>42</td></tr>
    <tr><td><code>Card</code></td><td>React</td><td>mantine</td><td>28</td></tr>
    <tr><td><code>NButton</code></td><td>Vue</td><td>naive-ui</td><td>37</td></tr>
    <tr><td><code>NDataTable</code></td><td>Vue</td><td>naive-ui</td><td>14</td></tr>
    <tr><td><code>Button</code></td><td>Solid</td><td>kobalte</td><td>19</td></tr>
    <tr><td><code>Dialog</code></td><td>Svelte</td><td>bits-ui</td><td>11</td></tr>
  </tbody>
</table>"#;

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
        ("GET", "/api/component-usage") => (
            "200 OK",
            "application/json",
            COMPONENT_USAGE_JSON.to_string(),
        ),
        ("GET", "/api/component-usage-fragment") => (
            "200 OK",
            "text/html; charset=utf-8",
            COMPONENT_USAGE_FRAGMENT.to_string(),
        ),
        ("GET", "/openapi.json") => (
            "200 OK",
            "application/json",
            OPENAPI_SPEC.to_string(),
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
