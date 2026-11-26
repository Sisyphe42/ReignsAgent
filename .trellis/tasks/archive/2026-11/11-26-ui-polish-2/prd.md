# UI polish batch 2

## Goal

Fix four Creator UI defects found in the portfolio screenshot review, on top of the
`fix/ui-polish-states` branch, then open one PR for both polish batches.

## Requirements

1. **AI progress steps at phone width.** The six `.ai-progress` step labels (Context, Request,
   Local draft, Parse, Validate, Ready) must never be clipped ("Contex", "Reques") on any of the 7
   skins at 390 px. Steps may wrap onto more rows; wide layouts keep one even row.
2. **Review progress copy.** The head must not repeat the phase word and must separate its parts:
   `Simulating · 6,600 / 10,000 cycles · about 1s left`; summarizing reads
   `Summarizing · 10,000 simulated cycles`; starting reads `Starting · 10,000 cycles`.
3. **Selection preflight eyebrow.** The internal source name "Ambient" must not reach the author.
   The preflight eyebrow (and history rows that print the source) say "Selection". The stored
   source value stays `Ambient` so older history records keep working. The quoted selection text
   must not show a visible gap between closing CJK punctuation and the closing quote
   (`记录。 ”` → `记录。”`).
4. **Card text editor.** The single-line card text input becomes a multi-line textarea that grows
   with its content, so long card text is fully visible. Saving keeps working: Save text button,
   Enter saves (card text is one paragraph; players do not render line breaks), Shift+Enter still
   inserts a line break, IME composition Enter never saves. Global Ctrl+Z undo still ignores the
   field.
5. The 7-skin contrast test still passes, and the changed UI reaches AA contrast on each skin.

## Constraints

- Creator Web only; no Core / Pipeline / Reviewer / API contract changes.
- AI only through scripted mocks; no keys.

## Acceptance Criteria

- [ ] Browser test: at 390 px, all 7 skins, no `.ai-progress__step` overflows its box, and the
      steps' text meets AA contrast.
- [ ] Browser test: review head text matches the separated format; no "Simulating Simulated".
- [ ] Browser test: selection preflight eyebrow reads "Selection"; no "Ambient" anywhere visible;
      the quote closes right after CJK punctuation.
- [ ] Browser test: card text editor is a textarea whose height fits a long text (no inner scroll),
      Enter saves, Shift+Enter does not save.
- [ ] `npm run verify`, `npm run test:hosted`, `npm run eval:repair` pass.
