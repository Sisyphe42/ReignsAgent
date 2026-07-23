# Adaptive card artwork display implementation

## Ordered Work

1. Add Pipeline display constants/normalization/validation, Interface `setAssetDisplay`, local and Hosted API parity, and preservation during image replacement.
2. Add focused unit and integration coverage for the contract and API.
3. Add Creator `CardArtwork`, fit controls, focal grid, and card-surface styles.
4. Update Shared Player and Standalone Player DOM/rendering with the same fallback contract.
5. Add Hosted browser coverage for persistence and rendered modes.
6. Document asset display behavior in `README.md`.
7. Run all required checks and visible smoke tests.

## Validation

- `npm run test:unit`
- `npm run test:integration`
- `npm run test:hosted`
- `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>`
- `npm run verify`

Inspect the temporary Player build for its bundle, referenced assets, and adaptive artwork markup. Smoke Creator Preview, Shared Player, and Standalone Player at desktop and mobile widths.

## Git Review Gates

- Branch: `feature/adaptive-card-art`.
- Commit 1 after contract/API tests and `npm run verify`.
- Commit 2 after Creator/Player rendering tests and `npm run verify`.
- Commit 3 after browser coverage/docs/final validation.
- Push and open a non-draft PR with behavior, contract, screenshots/smoke evidence, and exact check results. Do not merge.

## Risk and Rollback Points

- Keep display normalization centralized within each runtime boundary to avoid semantic drift.
- Preserve metadata with nested merges; shallow replacement would erase display or MIME/hash fields.
- Do not edit generated Hosted output directly; rebuild it from the shared Player source.
- Do not change generic image-result rendering or source asset bytes.
