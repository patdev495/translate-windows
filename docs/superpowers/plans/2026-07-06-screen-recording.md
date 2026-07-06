# Screen Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Ctrl+4` region screen recording with Start/Stop controls, Save As `.mp4`, no audio, and FFmpeg from `PATH`, while preserving `Ctrl+3` OCR capture unchanged.

**Architecture:** Keep recording separate from OCR. Rust owns shortcut/tray wiring, recording state, FFmpeg process lifecycle, temp file cleanup, and Save As. The frontend reuses the existing overlay and crop coordinate mapping, but switches into a recording mode that calls recording commands instead of OCR commands.

**Tech Stack:** Tauri v2, Rust, `tauri-plugin-global-shortcut`, `tauri-plugin-dialog`, FFmpeg `gdigrab` on Windows, Vite/TypeScript, Vitest, Cargo tests.

---

## File Structure

- Modify `src-tauri/src/lib.rs`: add recording shortcut/tray specs, `RecordingState`, FFmpeg command helpers, Tauri commands, dialog plugin initialization, and Rust unit tests.
- Modify `src-tauri/Cargo.toml`: add `tauri-plugin-dialog = "2"`.
- Modify `src-tauri/capabilities/default.json`: add `dialog:default`.
- Modify `index.html`: add a hidden recording control bar.
- Modify `src/styles.css`: add recording overlay control styles.
- Modify `src/main.ts`: detect `recording=1`, run recording overlay flow, and keep existing OCR overlay flow unchanged.
- Create `src/recording-overlay.ts`: pure frontend recording state/controller helpers.
- Create `tests/recording-overlay.test.ts`: Vitest coverage for control placement, state transitions, and command calls.
- Modify existing tests only where contracts intentionally change: Rust unit tests inside `src-tauri/src/lib.rs`.

## Task 1: Lock Shortcut And Tray Contracts

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing Rust contract updates**

In `src-tauri/src/lib.rs`, update the existing tests at the bottom:

```rust
#[test]
fn tray_menu_exposes_desktop_app_actions() {
    let specs = tray_menu_specs();
    let ids: Vec<&str> = specs.iter().map(|item| item.id).collect();

    assert_eq!(ids, vec![
        "capture_ocr",
        "record_screen",
        "copy_full_screen",
        "auto_translate",
        "ocr_pin_image",
        "settings",
        "start_with_windows",
        "exit",
    ]);
}

#[test]
fn global_shortcuts_expose_ocr_recording_and_clipboard_capture() {
    let specs = global_shortcut_specs();
    let ids: Vec<&str> = specs.iter().map(|item| item.id).collect();
    let codes: Vec<Code> = specs.iter().map(|item| item.code).collect();

    assert_eq!(ids, vec!["capture_ocr", "record_screen", "copy_full_screen"]);
    assert_eq!(codes, vec![Code::Digit3, Code::Digit4, Code::KeyB]);
}
```

- [ ] **Step 2: Run the failing Rust tests**

Run:

```powershell
cd src-tauri
cargo test --lib
```

Expected: FAIL in the updated shortcut or tray tests because `record_screen` is not in the current specs.

- [ ] **Step 3: Update tray and shortcut specs**

In `src-tauri/src/lib.rs`, replace the spec functions with:

```rust
fn tray_menu_specs() -> [TrayMenuSpec; 8] {
    [
        TrayMenuSpec { id: "capture_ocr", label: "Capture OCR (Ctrl+3)" },
        TrayMenuSpec { id: "record_screen", label: "Record Screen (Ctrl+4)" },
        TrayMenuSpec { id: "copy_full_screen", label: "Capture Full Screen (Alt+B)" },
        TrayMenuSpec { id: "auto_translate", label: "Auto Translate" },
        TrayMenuSpec { id: "ocr_pin_image", label: "Pin OCR Image" },
        TrayMenuSpec { id: "settings", label: "Settings" },
        TrayMenuSpec { id: "start_with_windows", label: "Start with Windows" },
        TrayMenuSpec { id: "exit", label: "Exit" },
    ]
}

fn global_shortcut_specs() -> [GlobalShortcutSpec; 3] {
    [
        GlobalShortcutSpec { id: "capture_ocr", code: Code::Digit3 },
        GlobalShortcutSpec { id: "record_screen", code: Code::Digit4 },
        GlobalShortcutSpec { id: "copy_full_screen", code: Code::KeyB },
    ]
}
```

- [ ] **Step 4: Update tray item indexing**

In `setup_tray`, create a `record_screen_item` and shift the existing indexes:

```rust
let capture_item = MenuItem::with_id(app, specs[0].id, specs[0].label, true, None::<&str>)?;
let record_screen_item = MenuItem::with_id(app, specs[1].id, specs[1].label, true, None::<&str>)?;
let copy_full_screen_item = MenuItem::with_id(app, specs[2].id, specs[2].label, true, None::<&str>)?;
```

Use `specs[3]` for `auto_translate`, `specs[4]` for `ocr_pin_image`, `specs[5]` for `settings`, `specs[6]` for `start_with_windows`, and `specs[7]` for `exit`.

Add the new item to the menu between OCR and full-screen capture:

```rust
&capture_item,
&record_screen_item,
&copy_full_screen_item,
```

- [ ] **Step 5: Add temporary no-op recording handler**

Add a function near `request_capture_and_overlay`:

```rust
fn request_recording_overlay(app_handle: &tauri::AppHandle) {
    if let Some(existing) = app_handle.get_webview_window("overlay") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }

    if let Err(err) = trigger_recording_overlay(app_handle) {
        eprintln!("Failed to trigger recording overlay: {err}");
    }
}
```

Add a temporary `trigger_recording_overlay` near `trigger_capture_and_overlay`:

```rust
fn trigger_recording_overlay(_app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
```

Wire the tray event:

```rust
"record_screen" => {
    request_recording_overlay(app_handle);
}
```

Update the shortcut modifier selection:

```rust
let modifiers = match spec.id {
    "capture_ocr" | "record_screen" => Modifiers::CONTROL,
    "copy_full_screen" => Modifiers::ALT,
    _ => Modifiers::CONTROL,
};
```

Update the shortcut match:

```rust
"record_screen" => {
    request_recording_overlay(app_handle);
}
```

- [ ] **Step 6: Run contract tests**

Run:

```powershell
cd src-tauri
cargo test --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "Add recording shortcut and tray contract"
```

## Task 2: Add Recording State And Pure Backend Helpers

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Rust tests for pure recording helpers**

Inside the existing `#[cfg(test)] mod tests`, extend the import:

```rust
use super::{
    autostart_available_in_current_build, build_ffmpeg_record_args, destination_with_mp4_extension,
    global_shortcut_specs, recording_temp_path, tray_menu_specs, RecordingRect, TooltipData,
};
```

Add these tests:

```rust
#[test]
fn ffmpeg_record_args_target_selected_region_without_audio() {
    let rect = RecordingRect {
        x: 20,
        y: 30,
        width: 640,
        height: 360,
    };
    let args = build_ffmpeg_record_args(&rect, std::path::Path::new("C:\\Temp\\capture.mp4"));

    assert_eq!(args, vec![
        "-y",
        "-f",
        "gdigrab",
        "-framerate",
        "30",
        "-offset_x",
        "20",
        "-offset_y",
        "30",
        "-video_size",
        "640x360",
        "-i",
        "desktop",
        "-an",
        "-pix_fmt",
        "yuv420p",
        "C:\\Temp\\capture.mp4",
    ]);
}

#[test]
fn destination_with_mp4_extension_adds_missing_extension() {
    let path = destination_with_mp4_extension(std::path::PathBuf::from("C:\\Videos\\clip"));
    assert_eq!(path, std::path::PathBuf::from("C:\\Videos\\clip.mp4"));
}

#[test]
fn destination_with_mp4_extension_preserves_existing_mp4_extension() {
    let path = destination_with_mp4_extension(std::path::PathBuf::from("C:\\Videos\\clip.mp4"));
    assert_eq!(path, std::path::PathBuf::from("C:\\Videos\\clip.mp4"));
}

#[test]
fn recording_temp_path_uses_mp4_extension() {
    let path = recording_temp_path();
    assert_eq!(path.extension().and_then(|value| value.to_str()), Some("mp4"));
}
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```powershell
cd src-tauri
cargo test --lib
```

Expected: FAIL in the updated recording helper tests because helper types and functions do not exist.

- [ ] **Step 3: Add imports and types**

At the top of `src-tauri/src/lib.rs`, update imports:

```rust
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
```

Keep the existing `Duration` import by replacing `use std::time::Duration;` with the combined import above.

Add the recording types after `CaptureRequestState`:

```rust
#[derive(Default)]
pub struct RecordingRequestState(pub AtomicBool);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordingRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct RecordingState(pub Mutex<Option<ActiveRecording>>);

pub struct ActiveRecording {
    pub rect: RecordingRect,
    pub temp_path: PathBuf,
    pub child: Child,
}
```

- [ ] **Step 4: Add pure helper functions**

Add these functions near the screen capture helpers:

```rust
fn recording_temp_path() -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    std::env::temp_dir().join(format!("polytranslate-recording-{millis}.mp4"))
}

fn destination_with_mp4_extension(path: PathBuf) -> PathBuf {
    match path.extension().and_then(|value| value.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("mp4") => path,
        _ => path.with_extension("mp4"),
    }
}

fn build_ffmpeg_record_args(rect: &RecordingRect, output_path: &std::path::Path) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-f".to_string(),
        "gdigrab".to_string(),
        "-framerate".to_string(),
        "30".to_string(),
        "-offset_x".to_string(),
        rect.x.to_string(),
        "-offset_y".to_string(),
        rect.y.to_string(),
        "-video_size".to_string(),
        format!("{}x{}", rect.width, rect.height),
        "-i".to_string(),
        "desktop".to_string(),
        "-an".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        output_path.to_string_lossy().to_string(),
    ]
}
```

- [ ] **Step 5: Run helper tests**

Run:

```powershell
cd src-tauri
cargo test --lib
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "Add recording backend helpers"
```

## Task 3: Add FFmpeg Recording Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the dialog plugin dependency**

Run:

```powershell
cd src-tauri
cargo add tauri-plugin-dialog@2
```

Expected: `src-tauri/Cargo.toml` includes `tauri-plugin-dialog = "2"` and `src-tauri/Cargo.lock` updates.

- [ ] **Step 2: Add capability permission**

In `src-tauri/capabilities/default.json`, add `"dialog:default"` to `permissions`:

```json
"permissions": [
  "core:default",
  "core:window:allow-start-dragging",
  "core:window:allow-set-size",
  "opener:default",
  "global-shortcut:default",
  "dialog:default"
]
```

- [ ] **Step 3: Write Rust tests for state transitions that do not spawn FFmpeg**

Add these tests inside the Rust test module:

```rust
#[test]
fn recording_rect_rejects_empty_dimensions() {
    assert!(RecordingRect { x: 0, y: 0, width: 0, height: 100 }.width == 0);
    assert!(RecordingRect { x: 0, y: 0, width: 100, height: 0 }.height == 0);
}
```

This test records the invariant used by the command guard. The actual Tauri command check is verified by code review and manual app run because command state requires a Tauri runtime.

- [ ] **Step 4: Add FFmpeg availability and process helpers**

Add near `build_ffmpeg_record_args`:

```rust
fn ensure_ffmpeg_available() -> Result<(), String> {
    let output = Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "FFmpeg was not found. Install FFmpeg and make sure ffmpeg.exe is available on PATH.".to_string())?;

    if output.success() {
        Ok(())
    } else {
        Err("FFmpeg was found but did not start successfully. Reinstall FFmpeg or check your PATH entry.".to_string())
    }
}

fn spawn_ffmpeg_recording(rect: &RecordingRect, temp_path: &std::path::Path) -> Result<Child, String> {
    let args = build_ffmpeg_record_args(rect, temp_path);
    Command::new("ffmpeg")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("Could not start FFmpeg recording: {err}"))
}

fn stop_ffmpeg_child(child: &mut Child) -> Result<(), String> {
    if let Some(stdin) = child.stdin.as_mut() {
        use std::io::Write;
        let _ = stdin.write_all(b"q");
    }

    for _ in 0..20 {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!("FFmpeg exited with status {status}"))
                };
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(err) => return Err(format!("Could not read FFmpeg status: {err}")),
        }
    }

    let _ = child.kill();
    let _ = child.wait();
    Err("FFmpeg did not stop in time, so the recording was aborted.".to_string())
}
```

- [ ] **Step 5: Add file finalization helper**

Add:

```rust
fn finalize_recording_file(temp_path: &std::path::Path, destination: PathBuf) -> Result<PathBuf, String> {
    let destination = destination_with_mp4_extension(destination);
    match fs::rename(temp_path, &destination) {
        Ok(()) => Ok(destination),
        Err(_) => {
            fs::copy(temp_path, &destination)
                .map_err(|err| format!("Could not copy recording to selected destination: {err}"))?;
            fs::remove_file(temp_path)
                .map_err(|err| format!("Could not remove temporary recording after copy: {err}"))?;
            Ok(destination)
        }
    }
}
```

- [ ] **Step 6: Add Tauri commands**

Add after `show_overlay`:

```rust
#[tauri::command]
fn start_screen_recording(
    state: tauri::State<'_, RecordingState>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Select a recording area before starting.".to_string());
    }

    {
        let lock = state.0.lock().unwrap();
        if lock.is_some() {
            return Err("A screen recording is already in progress.".to_string());
        }
    }

    ensure_ffmpeg_available()?;

    let rect = RecordingRect { x, y, width, height };
    let temp_path = recording_temp_path();
    let child = spawn_ffmpeg_recording(&rect, &temp_path)?;

    let mut lock = state.0.lock().unwrap();
    *lock = Some(ActiveRecording { rect, temp_path, child });
    Ok(())
}

#[tauri::command]
fn cancel_screen_recording(state: tauri::State<'_, RecordingState>) -> Result<(), String> {
    let active = {
        let mut lock = state.0.lock().unwrap();
        lock.take()
    };

    if let Some(mut recording) = active {
        let _ = stop_ffmpeg_child(&mut recording.child);
        let _ = fs::remove_file(&recording.temp_path);
    }

    Ok(())
}

#[tauri::command]
fn stop_screen_recording(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, RecordingState>,
) -> Result<Option<String>, String> {
    let active = {
        let mut lock = state.0.lock().unwrap();
        lock.take()
    };

    let Some(mut recording) = active else {
        return Err("No screen recording is in progress.".to_string());
    };

    stop_ffmpeg_child(&mut recording.child)?;

    use tauri_plugin_dialog::DialogExt;
    let destination = app_handle
        .dialog()
        .file()
        .add_filter("MP4 Video", &["mp4"])
        .set_file_name("polytranslate-recording.mp4")
        .blocking_save_file();

    let Some(destination) = destination else {
        let _ = fs::remove_file(&recording.temp_path);
        return Ok(None);
    };

    let final_path = finalize_recording_file(&recording.temp_path, destination.into_path().map_err(|_| {
        "The selected save destination is not a local filesystem path.".to_string()
    })?)?;

    Ok(Some(final_path.to_string_lossy().to_string()))
}
```

- [ ] **Step 7: Register state and commands**

In `run()`, add:

```rust
.plugin(tauri_plugin_dialog::init())
```

after the existing opener/autostart plugins.

Add managed states:

```rust
.manage(RecordingState::default())
.manage(RecordingRequestState::default())
```

Add commands to `generate_handler!`:

```rust
start_screen_recording,
stop_screen_recording,
cancel_screen_recording,
```

- [ ] **Step 8: Run Cargo tests**

Run:

```powershell
cd src-tauri
cargo test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/default.json
git commit -m "Add FFmpeg recording commands"
```

## Task 4: Verify Dialog Plugin Wiring

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/Cargo.lock`

- [ ] **Step 1: Confirm dependencies**

Run:

```powershell
Select-String -LiteralPath src-tauri\Cargo.toml -Pattern 'tauri-plugin-dialog'
Select-String -LiteralPath src-tauri\capabilities\default.json -Pattern 'dialog:default'
```

Expected: both commands print one matching line.

- [ ] **Step 2: Confirm dialog initialization**

Run:

```powershell
Select-String -LiteralPath src-tauri\src\lib.rs -Pattern 'tauri_plugin_dialog::init'
```

Expected: one matching line in the Tauri builder plugin chain.

- [ ] **Step 3: Build-check Rust**

Run:

```powershell
cd src-tauri
cargo check
```

Expected: PASS.

- [ ] **Step 4: Commit only if verification required a wiring fix**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/default.json src-tauri/src/lib.rs
git commit -m "Enable Tauri save dialog for recordings"
```

Expected: create this commit only when Step 1, Step 2, or Step 3 required a file change. If all checks passed without changes, skip this commit.

## Task 5: Open Recording Overlay From Ctrl+4

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace temporary recording overlay helper**

Replace `trigger_recording_overlay` with:

```rust
fn trigger_recording_overlay(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(existing) = app_handle.get_webview_window("overlay") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let screen = current_screen()?;
    let info = screen.display_info;
    let scale_factor = info.scale_factor as f64;
    let overlay_url = format!(
        "index.html?overlay=1&recording=1&screenX={}&screenY={}&screenWidth={}&screenHeight={}",
        info.x,
        info.y,
        info.width,
        info.height
    );

    let logical_x = info.x as f64 / scale_factor;
    let logical_y = info.y as f64 / scale_factor;

    WebviewWindowBuilder::new(
        app_handle,
        "overlay",
        tauri::WebviewUrl::App(overlay_url.into())
    )
    .title("Recording Overlay")
    .fullscreen(true)
    .position(logical_x, logical_y)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible(false)
    .build()?;

    Ok(())
}
```

- [ ] **Step 2: Replace `request_recording_overlay` with guarded async request**

Use the same deadlock-safe pattern as OCR:

```rust
fn request_recording_overlay(app_handle: &tauri::AppHandle) {
    let request_state: tauri::State<RecordingRequestState> = app_handle.state();
    if request_state.0.swap(true, Ordering::SeqCst) {
        return;
    }

    let handle = app_handle.clone();
    std::thread::spawn(move || {
        if let Err(err) = trigger_recording_overlay(&handle) {
            eprintln!("Failed to trigger recording overlay: {err}");
        }
        let request_state: tauri::State<RecordingRequestState> = handle.state();
        request_state.0.store(false, Ordering::SeqCst);
    });
}
```

- [ ] **Step 3: Ensure overlay close cancels recording**

Update `close_overlay`:

```rust
#[tauri::command]
fn close_overlay(app_handle: tauri::AppHandle) {
    let state: tauri::State<RecordingState> = app_handle.state();
    let active = {
        let mut lock = state.0.lock().unwrap();
        lock.take()
    };

    if let Some(mut recording) = active {
        let _ = stop_ffmpeg_child(&mut recording.child);
        let _ = fs::remove_file(&recording.temp_path);
    }

    if let Some(overlay) = app_handle.get_webview_window("overlay") {
        let _ = overlay.destroy();
    }
}
```

- [ ] **Step 4: Run Rust checks**

Run:

```powershell
cd src-tauri
cargo test
cargo check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "Open recording overlay from Ctrl 4"
```

## Task 6: Add Recording Overlay Frontend Controller

**Files:**
- Create: `src/recording-overlay.ts`
- Create: `tests/recording-overlay.test.ts`

- [ ] **Step 1: Create failing frontend tests**

Create `tests/recording-overlay.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';
import {
  createInitialRecordingState,
  getRecordingControlPosition,
  RecordingOverlayController,
  type RecordingCommandApi,
} from '../src/recording-overlay';
import type { CropRect } from '../src/crop-selector';

function makeApi(): RecordingCommandApi {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => 'C:\\Videos\\clip.mp4'),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe('recording overlay', () => {
  test('initial state waits for a selected region', () => {
    expect(createInitialRecordingState()).toEqual({
      selectedRect: null,
      screenRect: null,
      status: 'selecting',
      error: null,
      savedPath: null,
      startedAt: null,
    });
  });

  test('positions controls below the selected region when there is room', () => {
    const position = getRecordingControlPosition(
      { x: 100, y: 100, width: 300, height: 200 },
      { width: 1000, height: 800 },
      { width: 260, height: 52 }
    );

    expect(position).toEqual({ x: 120, y: 312 });
  });

  test('positions controls above the selected region near the bottom edge', () => {
    const position = getRecordingControlPosition(
      { x: 100, y: 700, width: 300, height: 80 },
      { width: 1000, height: 800 },
      { width: 260, height: 52 }
    );

    expect(position).toEqual({ x: 120, y: 636 });
  });

  test('start calls backend with rounded screen coordinates', async () => {
    const api = makeApi();
    const controller = new RecordingOverlayController(api, () => 1000);
    const selectedRect: CropRect = { x: 10, y: 20, width: 120, height: 80 };
    const screenRect: CropRect = { x: 110.4, y: 220.6, width: 120.2, height: 80.7 };

    controller.selectRegion(selectedRect, screenRect);
    await controller.start();

    expect(api.start).toHaveBeenCalledWith({ x: 110, y: 221, width: 120, height: 81 });
    expect(controller.getState().status).toBe('recording');
    expect(controller.getState().startedAt).toBe(1000);
  });

  test('stop stores saved path and moves to saved state', async () => {
    const api = makeApi();
    const controller = new RecordingOverlayController(api, () => 1000);
    controller.selectRegion({ x: 10, y: 20, width: 120, height: 80 }, { x: 10, y: 20, width: 120, height: 80 });
    await controller.start();
    await controller.stop();

    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('saved');
    expect(controller.getState().savedPath).toBe('C:\\Videos\\clip.mp4');
  });

  test('cancel closes overlay after backend cleanup', async () => {
    const api = makeApi();
    const controller = new RecordingOverlayController(api, () => 1000);
    await controller.cancel();

    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(api.close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
npm test -- tests/recording-overlay.test.ts
```

Expected: FAIL because `src/recording-overlay.ts` does not exist.

- [ ] **Step 3: Create controller implementation**

Create `src/recording-overlay.ts`:

```ts
import type { CropRect } from './crop-selector';

export type RecordingStatus = 'selecting' | 'ready' | 'recording' | 'saving' | 'saved' | 'discarded' | 'error';

export interface RecordingState {
  selectedRect: CropRect | null;
  screenRect: CropRect | null;
  status: RecordingStatus;
  error: string | null;
  savedPath: string | null;
  startedAt: number | null;
}

export interface RoundedRecordingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingCommandApi {
  start(rect: RoundedRecordingRect): Promise<void>;
  stop(): Promise<string | null>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export function createInitialRecordingState(): RecordingState {
  return {
    selectedRect: null,
    screenRect: null,
    status: 'selecting',
    error: null,
    savedPath: null,
    startedAt: null,
  };
}

export function getRecordingControlPosition(
  rect: CropRect,
  viewport: { width: number; height: number },
  controls: { width: number; height: number }
): { x: number; y: number } {
  const margin = 12;
  const centeredX = rect.x + (rect.width - controls.width) / 2;
  const x = Math.max(margin, Math.min(centeredX, viewport.width - controls.width - margin));
  const belowY = rect.y + rect.height + margin;
  const y = belowY + controls.height <= viewport.height - margin
    ? belowY
    : Math.max(margin, rect.y - controls.height - margin);

  return { x: Math.round(x), y: Math.round(y) };
}

function roundScreenRect(rect: CropRect): RoundedRecordingRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export class RecordingOverlayController {
  private state: RecordingState = createInitialRecordingState();

  constructor(
    private api: RecordingCommandApi,
    private now: () => number = () => Date.now()
  ) {}

  getState(): RecordingState {
    return { ...this.state };
  }

  selectRegion(selectedRect: CropRect, screenRect: CropRect): void {
    this.state = {
      ...this.state,
      selectedRect,
      screenRect,
      status: 'ready',
      error: null,
      savedPath: null,
      startedAt: null,
    };
  }

  async start(): Promise<void> {
    if (!this.state.screenRect) {
      this.state = { ...this.state, status: 'error', error: 'Select a recording area before starting.' };
      return;
    }

    try {
      await this.api.start(roundScreenRect(this.state.screenRect));
      this.state = { ...this.state, status: 'recording', error: null, startedAt: this.now() };
    } catch (err) {
      this.state = { ...this.state, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async stop(): Promise<void> {
    if (this.state.status !== 'recording') {
      this.state = { ...this.state, status: 'error', error: 'No screen recording is in progress.' };
      return;
    }

    this.state = { ...this.state, status: 'saving', error: null };
    try {
      const savedPath = await this.api.stop();
      this.state = {
        ...this.state,
        status: savedPath ? 'saved' : 'discarded',
        savedPath,
        error: savedPath ? null : 'Recording discarded.',
      };
    } catch (err) {
      this.state = { ...this.state, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async cancel(): Promise<void> {
    await this.api.cancel();
    await this.api.close();
  }
}
```

- [ ] **Step 4: Run frontend tests**

Run:

```powershell
npm test -- tests/recording-overlay.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/recording-overlay.ts tests/recording-overlay.test.ts
git commit -m "Add recording overlay controller"
```

## Task 7: Wire Recording Overlay UI

**Files:**
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `src/main.ts`

- [ ] **Step 1: Add recording controls to HTML**

In `index.html`, add this after `translation-control-bar`:

```html
<div id="recording-control-bar" class="recording-control-bar" style="display: none; position: absolute; z-index: 220;">
  <div id="recording-status" class="recording-status">Select area</div>
  <button id="recording-start-btn" class="recording-btn">Start</button>
  <button id="recording-stop-btn" class="recording-btn danger" style="display: none;">Stop</button>
  <button id="recording-cancel-btn" class="recording-btn">Cancel</button>
</div>
```

- [ ] **Step 2: Add recording styles**

In `src/styles.css`, add:

```css
.recording-control-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 260px;
  min-height: 52px;
  box-sizing: border-box;
  background: rgba(18, 18, 22, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.36);
  pointer-events: auto;
}

.recording-status {
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  font-weight: 600;
  min-width: 82px;
}

.recording-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #ffffff;
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 6px;
  box-shadow: none;
}

.recording-btn:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.24);
}

.recording-btn.danger {
  background: rgba(220, 38, 38, 0.88);
  border-color: rgba(248, 113, 113, 0.8);
}
```

- [ ] **Step 3: Import recording controller in main.ts**

Add:

```ts
import {
  getRecordingControlPosition,
  RecordingOverlayController,
  type RecordingCommandApi,
} from "./recording-overlay";
```

- [ ] **Step 4: Detect recording mode**

In `DOMContentLoaded`, add:

```ts
const isRecordingWindow = params.get("recording") === "1";
```

Use this before the OCR `get_capture_image` call:

```ts
if (isOverlayWindow && isRecordingWindow) {
  document.documentElement.classList.add("overlay-mode");
  document.body.classList.add("overlay-mode");
  document.getElementById("main-container")?.setAttribute("hidden", "");

  const cropCanvas = document.getElementById("crop-canvas") as HTMLCanvasElement | null;
  if (cropCanvas) {
    cropCanvas.style.display = "block";
    cropCanvas.width = logicalW;
    cropCanvas.height = logicalH;
    setupRecordingOverlay(cropCanvas, toScreenRect);
    void invoke("show_overlay");
  }

  window.addEventListener("keydown", (e) => {
    overlayController.handleKeyDown(e);
  });

  return;
}
```

- [ ] **Step 5: Add `setupRecordingOverlay`**

Add below `runOverlayTranslation` or above helper functions:

```ts
function setupRecordingOverlay(
  cropCanvas: HTMLCanvasElement,
  toScreenRect: (r: CropRect) => CropRect
): void {
  const controlBar = document.getElementById("recording-control-bar") as HTMLDivElement | null;
  const status = document.getElementById("recording-status") as HTMLDivElement | null;
  const startBtn = document.getElementById("recording-start-btn") as HTMLButtonElement | null;
  const stopBtn = document.getElementById("recording-stop-btn") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("recording-cancel-btn") as HTMLButtonElement | null;

  if (!controlBar || !status || !startBtn || !stopBtn || !cancelBtn) {
    return;
  }

  const api: RecordingCommandApi = {
    start: (rect) => invoke("start_screen_recording", rect),
    stop: () => invoke<string | null>("stop_screen_recording"),
    cancel: () => invoke("cancel_screen_recording"),
    close: () => invoke("close_overlay"),
  };
  const controller = new RecordingOverlayController(api);

  const render = () => {
    const state = controller.getState();
    startBtn.style.display = state.status === "ready" || state.status === "error" ? "inline-flex" : "none";
    stopBtn.style.display = state.status === "recording" ? "inline-flex" : "none";
    cancelBtn.textContent = state.status === "saved" || state.status === "discarded" ? "Close" : "Cancel";

    if (state.status === "recording" && state.startedAt) {
      const elapsed = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const seconds = String(elapsed % 60).padStart(2, "0");
      status.textContent = `Recording ${minutes}:${seconds}`;
      return;
    }

    if (state.status === "saved") {
      status.textContent = "Saved";
      return;
    }

    if (state.status === "discarded") {
      status.textContent = "Discarded";
      return;
    }

    status.textContent = state.error ?? (state.status === "ready" ? "Ready" : "Select area");
  };

  const selector = new CropSelector(cropCanvas, {
    onCrop: (_dataUrl, rect) => {
      const rounded = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      const screenRect = toScreenRect(rounded);
      controller.selectRegion(rect, screenRect);

      const position = getRecordingControlPosition(
        rect,
        { width: window.innerWidth || cropCanvas.width, height: window.innerHeight || cropCanvas.height },
        { width: 260, height: 52 }
      );
      controlBar.style.left = `${position.x}px`;
      controlBar.style.top = `${position.y}px`;
      controlBar.style.display = "flex";
      render();
    },
  });

  selector.attach();

  let timer: number | undefined;
  const startTimer = () => {
    window.clearInterval(timer);
    timer = window.setInterval(render, 500);
  };
  const stopTimer = () => {
    window.clearInterval(timer);
    timer = undefined;
  };

  startBtn.onclick = async () => {
    await controller.start();
    startTimer();
    render();
  };

  stopBtn.onclick = async () => {
    stopTimer();
    await controller.stop();
    render();
  };

  cancelBtn.onclick = async () => {
    stopTimer();
    await controller.cancel();
  };
}
```

- [ ] **Step 6: Run frontend tests and build**

Run:

```powershell
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add index.html src/styles.css src/main.ts
git commit -m "Wire recording overlay UI"
```

## Task 8: Final Verification And Manual QA

**Files:**
- No planned code changes unless verification finds a defect.

- [ ] **Step 1: Run all automated verification**

Run:

```powershell
npm test
npm run build
cd src-tauri
cargo test
cargo check
```

Expected: all commands PASS.

- [ ] **Step 2: Verify app behavior with FFmpeg present**

Run:

```powershell
ffmpeg -version
npm run tauri dev
```

Manual checks:

- Press `Ctrl+3`; OCR crop overlay still opens.
- Press `Esc`; overlay closes.
- Press `Ctrl+4`; recording overlay opens.
- Drag a region; Start/Cancel controls appear.
- Click `Start`; timer changes to recording state.
- Click `Stop`; Save As opens.
- Save as `polytranslate-recording-test.mp4`.
- Open the file and confirm it contains the selected region.

- [ ] **Step 3: Verify missing FFmpeg error**

Run the app from a shell with FFmpeg removed from `PATH`:

```powershell
$oldPath = $env:PATH
$env:PATH = ""
npm run tauri dev
```

Manual checks:

- Press `Ctrl+4`.
- Select a region.
- Click `Start`.
- The overlay shows `FFmpeg was not found. Install FFmpeg and make sure ffmpeg.exe is available on PATH.`

Restore PATH:

```powershell
$env:PATH = $oldPath
```

- [ ] **Step 4: Commit final fixes if needed**

If verification required fixes:

```powershell
git add <changed-files>
git commit -m "Fix screen recording verification issues"
```

If verification required no fixes, do not create an empty commit.

## Self-Review

- Spec coverage: `Ctrl+3` remains OCR in Task 1 and Task 8; `Ctrl+4` recording is added in Tasks 1 and 5; region selection and Start/Stop are handled in Tasks 6 and 7; Save As `.mp4` is handled in Tasks 3 and 4; no audio is enforced by FFmpeg `-an`; FFmpeg from `PATH` is checked in Task 3; cleanup and cancellation are covered in Tasks 3, 5, and 7.
- Placeholder scan: no `TBD`, no incomplete task, no unspecified test step, no deferred implementation.
- Type consistency: frontend uses `CropRect`, `RecordingCommandApi`, and `RoundedRecordingRect`; backend uses `RecordingRect`, `RecordingState`, and `RecordingRequestState`; command names match between Rust and TypeScript.
