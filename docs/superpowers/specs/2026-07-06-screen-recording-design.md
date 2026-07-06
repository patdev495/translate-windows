# Screen Recording Design

Date: 2026-07-06

## Goal

Add a Windows-first screen recording flow that behaves like the video side of Snipping Tool while preserving the existing OCR capture workflow.

`Ctrl+3` remains the current OCR screen capture shortcut. `Ctrl+4` starts a separate video recording flow.

## Decisions

- `Ctrl+3` keeps the current OCR behavior unchanged.
- `Ctrl+4` opens a recording overlay.
- The user selects a rectangular screen region before recording.
- Recording has explicit `Start`, `Stop`, and `Cancel` controls.
- The MVP records screen video only. It does not record microphone or system audio.
- After `Stop`, the app opens a Save As dialog so the user chooses the final `.mp4` path.
- The MVP uses an FFmpeg executable already available on the user's `PATH`.
- FFmpeg is not bundled in this phase.

## User Experience

When the user presses `Ctrl+4`, the app opens a full-screen transparent overlay on the active monitor. The overlay lets the user drag to select a region, similar to the existing OCR crop overlay.

After a valid region is selected, the overlay shows compact controls:

- `Start` begins recording the selected region.
- `Cancel` exits the recording flow without creating a video.

While recording, the overlay switches to a recording state with:

- an elapsed-time indicator,
- a `Stop` control,
- minimal placement near the selected region or screen edge so it does not cover the main content being recorded.

When the user clicks `Stop`, the app stops FFmpeg, opens a Save As dialog for an `.mp4` destination, then moves the temporary recording to that destination. If a direct move fails across volumes, the app copies the file and deletes the temporary source. On success, the app shows a short confirmation toast.

If the user cancels the Save As dialog, the app deletes the temporary file and reports that the recording was discarded.

If FFmpeg is missing, the app shows a clear error explaining that FFmpeg must be installed and available on `PATH`.

## Architecture

The recording flow is separate from the OCR capture flow.

### Shortcuts And Tray

Add a new global shortcut spec:

- `capture_ocr`: `Ctrl+3`
- `record_screen`: `Ctrl+4`
- `copy_full_screen`: `Alt+B`

Add a tray menu item for recording, for example `Record Screen (Ctrl+4)`.

The `record_screen` shortcut and tray item call a recording overlay request helper, not the OCR capture helper.

### Overlay Mode

Reuse the existing overlay window pattern, but introduce a recording mode such as `index.html?recording=1`.

The recording overlay may reuse crop selection primitives, but it must call recording commands instead of OCR commands. This keeps OCR behavior, OCR state, and tooltip behavior isolated from recording.

### Native State

Add a dedicated recording state in Rust. It should track:

- whether a recording is active,
- the selected screen rectangle,
- the temporary output file,
- the spawned FFmpeg process,
- enough metadata to stop and clean up safely.

Use a separate request guard, similar to the current capture request guard, so repeated `Ctrl+4` presses do not race overlay creation.

### FFmpeg Execution

On `Start`, Rust checks that `ffmpeg` can be executed from `PATH`. If it cannot, the command returns a user-facing error and leaves the app in a non-recording state.

On Windows, the MVP uses FFmpeg's `gdigrab` input with the selected region:

- `offset_x` and `offset_y` from the overlay's screen coordinates,
- `video_size` from the selected region width and height,
- a fixed MVP frame rate such as 30 fps,
- output to a temporary `.mp4` file.

The implementation should keep FFmpeg process handling in Rust so stop, cancel, and cleanup are reliable even if the overlay closes.

### Save As

On `Stop`, Rust stops FFmpeg and then prompts for a destination `.mp4` path using a native save dialog. If the repo does not already include dialog support, add the Tauri dialog plugin during implementation. If the user chooses a path, the temporary file is moved to that path, with copy-and-delete as the fallback for cross-volume moves. If the user cancels, the temporary file is deleted.

The recording state is cleared after either path.

## Error Handling

- Starting while a recording is already active returns a clear error.
- Stopping when no recording is active returns a clear error.
- Missing FFmpeg returns a clear setup error without crashing.
- FFmpeg start failure clears the active recording state.
- Stop failure attempts cleanup and reports that the recording could not be finalized.
- Save As cancellation deletes the temporary file and reports that the recording was discarded.
- App exit or overlay cancellation attempts to stop any active recording and remove temporary files.

## Testing

Automated tests should focus on contracts and state transitions rather than real video capture.

- Shortcut contract: `Ctrl+3` remains `capture_ocr`; `Ctrl+4` is `record_screen`; `Alt+B` remains `copy_full_screen`.
- Tray contract: OCR capture, record screen, and full-screen clipboard capture are separate menu actions.
- Recording state: start is rejected while already recording.
- Recording state: stop is rejected when not recording.
- FFmpeg detection: missing FFmpeg returns a friendly error.
- Save As cancellation: temporary output is discarded and state is cleared.

Manual verification:

1. Run the app on Windows with FFmpeg available on `PATH`.
2. Press `Ctrl+3` and verify OCR capture still works.
3. Press `Ctrl+4`, select a region, click `Start`, wait a few seconds, click `Stop`.
4. Save the `.mp4` through the Save As dialog.
5. Open the saved `.mp4` and verify it contains the selected screen region.
6. Repeat with FFmpeg unavailable and verify the error message is clear.

## Out Of Scope

- Audio recording.
- Bundling FFmpeg.
- Recording a full monitor without region selection.
- Recording a moving/followed window.
- Post-recording editing.
- Cross-platform support beyond the current Windows-first target.
