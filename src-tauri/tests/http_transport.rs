#![cfg(feature = "latency-harness")]
use std::{io::{BufRead, BufReader, Read, Write}, net::TcpListener, sync::{Arc, atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering}, Mutex}, time::{Duration, Instant}};
use translation_desktop_lib::latency::LatencyState;

struct Server { endpoint: String, connections: Arc<AtomicUsize>, stop: Arc<AtomicBool> }
impl Server {
    fn start() -> Self {
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint=format!("http://{}/api/translate",listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let connections=Arc::new(AtomicUsize::new(0));
        let stop=Arc::new(AtomicBool::new(false));
        let (count, done)=(connections.clone(),stop.clone());
        std::thread::spawn(move || while !done.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream,_)) => {
                    count.fetch_add(1,Ordering::AcqRel);
                    std::thread::spawn(move || {
                        stream.set_nonblocking(false).unwrap();
                        stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                        let mut reader=BufReader::new(stream);
                        loop {
                            let mut line=String::new();
                            if reader.read_line(&mut line).unwrap_or(0)==0 {break;}
                            let mut size=0; let mut auth=String::new();
                            loop {
                                line.clear();
                                if reader.read_line(&mut line).unwrap_or(0)==0 {return;}
                                if line=="\r\n" {break;}
                                if let Some((key,value))=line.split_once(':') {
                                    if key.eq_ignore_ascii_case("content-length") {size=value.trim().parse().unwrap();}
                                    if key.eq_ignore_ascii_case("authorization") {auth=value.trim().to_owned();}
                                }
                            }
                            let mut body=vec![0;size]; if reader.read_exact(&mut body).is_err() {return;}
                            if auth=="slow" { std::thread::sleep(Duration::from_secs(16)); }
                            let response=serde_json::json!({"authorization":auth,"body":String::from_utf8(body).unwrap()}).to_string();
                            let status=match auth.as_str() {"http-error"=>503,"redirect"=>302,_=>200};
                            let length=if auth=="oversized" {4_194_305} else {response.len()};
                            let location=if auth=="redirect" {"Location: /must-not-follow\r\n"} else {""};
                            if write!(reader.get_mut(),"HTTP/1.1 {status} Response\r\n{location}Content-Length: {length}\r\nContent-Type: application/json\r\n\r\n{response}").is_err() {break;}
                        }
                    });
                },
                Err(_) => std::thread::sleep(Duration::from_millis(2)),
            }
        });
        Self{endpoint,connections,stop}
    }
}
impl Drop for Server { fn drop(&mut self) {self.stop.store(true,Ordering::Release);} }

fn request(window: &tauri::WebviewWindow<tauri::test::MockRuntime>, url: &str, auth: &str) -> Result<serde_json::Value, serde_json::Value> {
    tauri::test::get_ipc_response(window,tauri::webview::InvokeRequest{
        cmd:"desktop_http".into(),callback:tauri::ipc::CallbackFn(0),error:tauri::ipc::CallbackFn(1),
        url:"http://tauri.localhost".parse().unwrap(),headers:Default::default(),invoke_key:tauri::test::INVOKE_KEY.into(),
        body:tauri::ipc::InvokeBody::Json(serde_json::json!({"url":url,"method":"POST","headers":if auth.is_empty() {serde_json::json!({})} else {serde_json::json!({"Authorization":auth})},"body":"synthetic"})),
    }).map(|value|value.deserialize().unwrap())
}

#[test]
fn consecutive_public_http_commands_reuse_a_connection_after_reading_the_body() {
    let server=Server::start();
    let app=tauri::test::mock_builder()
        .manage(translation_desktop_lib::http_clients::HttpClients::default())
        .manage(LatencyState{trace_id:AtomicU64::new(0),profile:Default::default(),transport_endpoint:Some(server.endpoint.clone()),samples:Mutex::default(),started:Mutex::new(Instant::now())})
        .invoke_handler(tauri::generate_handler![translation_desktop_lib::desktop::desktop_http])
        .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
    let window=tauri::WebviewWindowBuilder::new(&app,"main",Default::default()).build().unwrap();
    for _ in 0..2 {
        let result=request(&window,"https://oneshot-free.www.deepl.com/v1/translate","None").unwrap();
        assert_eq!(result["status"],200);
        let body:serde_json::Value=serde_json::from_str(result["body"].as_str().unwrap()).unwrap();
        assert_eq!(body["body"],"synthetic");
    }
    assert_eq!(server.connections.load(Ordering::Acquire),1,"server must observe TCP reuse");
}

#[test]
fn pooled_commands_keep_authorization_specific_to_each_request() {
    let server=Server::start();
    let app=tauri::test::mock_builder()
        .manage(translation_desktop_lib::http_clients::HttpClients::default())
        .manage(LatencyState{trace_id:AtomicU64::new(0),profile:Default::default(),transport_endpoint:Some(server.endpoint.clone()),samples:Mutex::default(),started:Mutex::new(Instant::now())})
        .invoke_handler(tauri::generate_handler![translation_desktop_lib::desktop::desktop_http])
        .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
    let window=tauri::WebviewWindowBuilder::new(&app,"main",Default::default()).build().unwrap();
    for authorization in ["Bearer synthetic-account-A", "Bearer synthetic-account-B", ""] {
        let result=request(&window,"https://oneshot-free.www.deepl.com/v1/translate",authorization).unwrap();
        let echoed:serde_json::Value=serde_json::from_str(result["body"].as_str().unwrap()).unwrap();
        assert_eq!(echoed["authorization"],authorization);
    }
    assert_eq!(server.connections.load(Ordering::Acquire),1);
}

#[test]
fn pooling_preserves_endpoint_redirect_response_limit_and_http_error_contracts() {
    let server=Server::start();
    let app=tauri::test::mock_builder()
        .manage(translation_desktop_lib::http_clients::HttpClients::default())
        .manage(LatencyState{trace_id:AtomicU64::new(0),profile:Default::default(),transport_endpoint:Some(server.endpoint.clone()),samples:Mutex::default(),started:Mutex::new(Instant::now())})
        .invoke_handler(tauri::generate_handler![translation_desktop_lib::desktop::desktop_http])
        .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
    let window=tauri::WebviewWindowBuilder::new(&app,"main",Default::default()).build().unwrap();
    let url="https://oneshot-free.www.deepl.com/v1/translate";
    for (authorization,status) in [("http-error",503),("redirect",302)] {
        let result=request(&window,url,authorization).unwrap();
        assert_eq!(result["status"],status);
        let body:serde_json::Value=serde_json::from_str(result["body"].as_str().unwrap()).unwrap();
        assert_eq!(body["body"],"synthetic");
    }
    assert!(request(&window,url,"oversized").unwrap_err().as_str().unwrap().contains("too large"));
    for forbidden in ["https://oneshot-free.www.deepl.com/v1/translate/", "http://oneshot-free.www.deepl.com/v1/translate", "https://example.test/api/translate"] {
        assert_eq!(request(&window,forbidden,"None").unwrap_err(),"This endpoint is not a desktop service");
    }
}

#[test]
fn a_timed_out_command_does_not_poison_the_shared_client() {
    let server=Server::start();
    let app=tauri::test::mock_builder()
        .manage(translation_desktop_lib::http_clients::HttpClients::default())
        .manage(LatencyState{trace_id:AtomicU64::new(0),profile:Default::default(),transport_endpoint:Some(server.endpoint.clone()),samples:Mutex::default(),started:Mutex::new(Instant::now())})
        .invoke_handler(tauri::generate_handler![translation_desktop_lib::desktop::desktop_http])
        .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
    let window=tauri::WebviewWindowBuilder::new(&app,"main",Default::default()).build().unwrap();
    let url="https://oneshot-free.www.deepl.com/v1/translate";
    assert!(request(&window,url,"slow").is_err(),"a response delayed past the 15-second policy must time out");
    assert_eq!(request(&window,url,"None").unwrap()["status"],200);
}
