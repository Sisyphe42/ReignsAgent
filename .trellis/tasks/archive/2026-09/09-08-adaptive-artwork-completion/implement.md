# Execution and review plan

1. Read applicable frontend, persistence, and cross-layer specifications; inspect current mutation and image event lifecycles.
2. Implement localized controls, explanatory copy, and a useful responsive preview using CardArtwork.
3. Reproduce and address overlapping-save and image-failure recovery issues; preserve unrelated working-tree changes.
4. Replace weak synthetic default-only assertions with mode/ratio/failure coverage on real surfaces. Verify standalone metadata and unchanged copied assets.
5. Run npm run verify, npm run test:hosted, and npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>. Inspect desktop/mobile screenshots.
6. Update README/spec and record exact results. Keep follow-up work on the existing feature branch; obtain explicit authorization before creating or merging a PR.

Planning review gate: present this bounded completion scope for review before task activation.

## Completed validation

- User approved implementation with “continue”.
- `npm run verify`: passed, 112 unit and 30 integration tests.
- `npm run test:hosted`: passed, 31 tests including nine ratio/mode combinations across real Creator, Shared Player, and built Standalone Player pages.
- `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>`: passed. Browser fixture compares every copied local asset byte-for-byte with its source.
- Reviewed desktop and Chinese mobile screenshots. Fixed Shared Player's hidden frame CSS and centered the complete foreground independently of background focus.
- Local HTTP save fault injection verifies disabled controls during an in-flight write, retained authored state on failure, retry, and refresh persistence.
- Unrelated package.json/package-lock.json edits remain unstaged.
