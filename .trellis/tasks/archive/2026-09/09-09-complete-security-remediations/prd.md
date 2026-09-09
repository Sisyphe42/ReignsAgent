# Complete remaining Codex Security remediations

## Goal

Finish and verify the repository remediation for all four findings from Codex Security scan `2698adfa-5c97-41a9-a578-daebc9fb1c7d`, preserving the already committed Creator API trust-boundary fix and completing the three outstanding resource/parser fixes on the current branch.

## Background

- Branch `fix/creator-api-request-trust` already contains commit `5cd3798`, which addresses the medium Creator API Host/Origin/capability and credential-binding finding with focused tests.
- The remaining validated findings are: unbounded Creator JSON and diagnostics work, TOML prototype pollution, and unbounded AI provider response buffering.
- `package.json` and `package-lock.json` contain unrelated user-owned `thinking-orbs` changes. They must remain untouched and excluded from the remediation commit.
- Repository evidence establishes existing limits to reuse: Hosted diagnostics cap at 10,000 cycles and 200 turns; Reviewer is designed for up to its 100,000-cycle default; project images use a 50 MiB binary boundary.

## Requirements

- R1: Re-run the existing Creator API trust-boundary regression tests and preserve commit `5cd3798` behavior; change that implementation only if current verification proves a concrete regression or bypass.
- R2: Bound JSON request-body buffering before full materialization, reject declared and streamed oversized bodies with an explicit API error, and preserve the separate 50 MiB binary image-stage path.
- R3: Bound synchronous diagnostics at both the untrusted Creator API boundary and the Reviewer public boundary. Preserve ordinary review inputs, the 100,000-cycle headless product goal, and Hosted's existing 10,000-cycle / 200-turn behavior.
- R4: Reject prototype-sensitive TOML keys (`__proto__`, `prototype`, and `constructor`) in every section or assignment position, and never traverse inherited properties when constructing tables. Preserve plain-object output and valid nested TOML behavior.
- R5: Bound text, JSON, and binary provider responses before full buffering. Apply a small text-response ceiling for AI edit/model metadata, a JSON ceiling compatible with encoded image results, and the existing 50 MiB ceiling for each fetched binary image output.
- R6: Reuse one browser-and-Node-compatible bounded response reader across Pipeline text and image paths, including Content-Length preflight and streaming enforcement where the response body supports streaming.
- R7: Add focused malicious and legitimate controls for each boundary, including alternate TOML prototype paths, absent/misleading Content-Length, and normal provider/reviewer/API behavior.
- R8: Update relevant documentation when the externally visible request, diagnostics, or provider-response limits change.
- R9: Preserve module boundaries: no AI behavior enters Core or deployable player builds, and Workspace remains host-neutral.

## Acceptance Criteria

- [x] AC1: The original cross-site Creator API finding remains non-reproducible under its focused regression suite.
- [x] AC2: Oversized JSON bodies are rejected before route mutation, both with a declared Content-Length and while streaming; ordinary JSON and binary image staging still work.
- [x] AC3: Creator diagnostics reject values above 10,000 cycles or 200 turns, Reviewer rejects values above 100,000 cycles or 200 turns, and normal/default reviews remain deterministic and successful.
- [x] AC4: Parsing `[__proto__]`, `[constructor.prototype]`, and dangerous assignment keys throws without adding properties to `Object.prototype`; valid nested TOML still parses to compatible plain objects.
- [x] AC5: Oversized AI edit/model text, image JSON, direct binary image, and fetched image outputs fail with stable size-limit errors before unbounded buffering; normal responses remain supported.
- [x] AC6: Focused package/integration tests and `npm run verify` pass.
- [x] AC7: The final diff excludes the user's `thinking-orbs` manifest changes and contains no unrelated cleanup.

## Out of Scope

- Opening or merging a pull request, pushing, changing production deployment, or closing workbench findings.
- Redesigning Creator authentication beyond the existing local capability model.
- Adding provider profiles, network AI behavior to player builds, or a configurable limits subsystem.
- Reverting or incorporating the unrelated `thinking-orbs` dependency changes.
