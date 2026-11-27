# Header narrow tier: four controls on phones

## Source
User request (2026-11-27): "Heading 的自适应，最窄的时候只保留 logo & project 下拉框 & AI 按钮 & player 按钮，具体怎么执行尽量专业。不开 PR，测试完毕直接推。"
Brief: `D:\projects\portfolio\docs\portfolio-rebuild\references\reignsagent-header-narrow-brief-2026-11-27.md`.

## Requirements
- Phone tier (<= 600 px): the Creator top bar is one row with exactly four controls: brand logo (icon
  may stand alone), Project menu, AI presence button, Player link. Hidden text stays as accessible names.
- The Skin selector leaves the phone top bar but stays reachable in one discoverable place (Settings >
  Interface, next to Language), keyboard and screen-reader accessible with a visible label.
- Progressive degradation between tiers: decoration and duplicate information first, then drawn text
  labels, then the secondary control; no width where the bar wraps or jumps.
- Phone touch targets >= 44 x 44; long project names ellipsize with the full name as `title`; no
  horizontal scroll; all seven skins hold.
- Tablet (834) and desktop (1440) do not regress.

## Acceptance criteria
- Browser tests: phone bar has only the four controls on one row, height cap, touch sizes, Skin works
  from Settings, 7 skins x 3 widths no sideways scroll / clipping, a width sweep never wraps, contrast
  scan still passes.
- `npm run verify`, `npm run test:hosted`, `npm run eval:repair` pass.
