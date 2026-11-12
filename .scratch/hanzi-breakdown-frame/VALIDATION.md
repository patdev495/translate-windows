# Hanzi breakdown native card framing

Date: 2026-11-12
Seam: approved S3, real hanzi entrypoint + native WebView2 window geometry.

User screenshot shows a second outer layer around the breakdown reading card.
Causes: 10px outer host margin, fixed native window height independent of card,
CSS overlay shadow and default native window shadow.

Red: extended WebView2 smoke fails with
`Timed out: Breakdown card fits native window without an outer layer`.
This checks rendered card bounds against the actual native viewport, not a CSS
snapshot. Existing main/settings/PDF/tooltip assertions still pass.

Fix: remove host margin and card outer border/shadow for the standalone native
view; disable native shadow/decorations/resizing and remove the old minimum size.
Fit native width/height to the card in the current monitor work area, rounding height
to physical pixels. Watch resize and async component-card replacements, keeping
nested cards flush and content scrolling internally. Center only on first fit,
so later edits/navigation do not move a manually dragged window. Shared PDF
breakdown overlay styling stays scoped outside the standalone view.

Validation pending: WebView2 card bounds/native frame, note save, long-note
internal scrolling, nested component navigation; existing Hanzi tests.

Green: real WebView2 reports breakdown layout `inset:0`, `outerFrame:0`,
width 480 logical px; long note scrolls inside the card, nested component
navigation keeps the next card flush, note save succeeds. Main/Settings/PDF and
primary tooltip smoke checks also pass. Existing Hanzi/backup tests: 4/4 passed.

The extra scroll/navigation fixture initially selected a hidden unidentified-
stroke textarea and its edit button. Corrected selectors to the visible Memory
note and expandable component button; these fixture errors are not claimed as
production defects. The original frame/inset red above remains the TDD red.

Final source keeps the native layout stylesheet mounted across subsequent
settings/content reloads. Package build and final-source WebView2 rerun follow.

## Final delivery

Status: done
Source commit: `2483b5b6fe939e2791cc0885716987f5bf6aead4`.

NSIS release built with jobs=1, no diagnostic feature. Installer timestamp
2026-11-12 14:35:59 +07:00, 256505697 bytes. SHA-256:
`EBED7F0CC31A6334F5BF4AFD86B63A18428EC57AAAE6B486D4CC7044EB8ABE26`.
See build-artifacts.json, build-start.json and SHA256SUMS.txt. Previous installer
preserved at the path in previous-release.json; user settings/data untouched.

Final-source `npm run test:ui` (reusing the production assets from this package)
passed all five windows. Breakdown: width 480 logical px, inset 0, native outer
frame 0, internalScroll true, componentNavigation true, noteSaved true. Existing
main tooltip still centered with inset/frame 0, Copy correct, 42 stroke paths.
Hanzi/backup Vitest group: 4/4 passed. The release build also compiled the native
builder changes. No unrelated tests were broadened for this framing-only fix.

The running installed application was not replaced or restarted. Install the new
NSIS package and reopen PolyTranslate to use this change. No push performed.
