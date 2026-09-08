# Adaptive artwork completion design

Reuse CardArtwork and the existing locale dictionary. Add a larger responsive square preview within the current controls and explain that adaptive focus positions the background while the full foreground remains visible. Keep the original heading thumbnail.

Inspect the existing mutation lifecycle before selecting a save strategy. Serialize or disable overlapping display writes as appropriate; avoid introducing an additional project-state store. Failed requests must retain an accurate authored state and visible error feedback.

Correct test inputs to use metadata.display. Exercise the actual React and Player surfaces through browser fixtures, varying source dimensions and fit/focus metadata. Include foreground failure followed by a valid source. Fix production failures only when reproduced.

Keep Pipeline validation, backend routes, and source assets compatible. Update the existing artwork specification when behavior or documented signatures require correction. Rollback is limited to UI/runtime/test changes; no content migration is needed.
