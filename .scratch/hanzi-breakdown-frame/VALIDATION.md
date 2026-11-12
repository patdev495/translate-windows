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
Fit native width/height to the card in source monitor work area, rounding height
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
