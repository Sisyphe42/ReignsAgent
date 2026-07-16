# Player motion and project links

## Goal

Ensure card motion is visibly enabled in release builds and make release attribution concise and linkable.

## Requirements

- Full card motion is the release default, with an explicit reduced-motion control in Appearance.
- About contains project metadata and one compact `Built with ReignsAgent` credit only.
- `ReignsAgent`, project title, and author may link to safe HTTP(S) URLs.
- Creator Settings can edit optional project-title and author URLs.
- Windows opens approved external links in the system browser while keeping WebView navigation locked to its virtual origin.

## Acceptance Criteria

- [x] A fresh release visibly animates outgoing and incoming cards even when Windows animation preferences are disabled.
- [x] Reduced motion can be selected and persisted explicitly.
- [x] About contains no explanatory ReignsAgent paragraphs.
- [x] Invalid or non-HTTP(S) authored links never become clickable.
- [x] Web, Windows, Electron, and repository verification gates pass.
