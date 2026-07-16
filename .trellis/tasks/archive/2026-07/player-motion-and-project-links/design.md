# Design

The Appearance drawer owns a two-option motion control: `Full motion` and `Reduced motion`. This makes release behavior deterministic instead of silently inheriting a host setting the player cannot explain.

Project links remain optional metadata (`titleUrl`, `authorUrl`). Rendering validates them at the final player boundary and creates links through DOM attributes only for `http:` and `https:`. The Windows host handles only new-window requests with those schemes through the system browser; in-view navigation remains denied.

About ends with a single restrained credit line. The project title, author, description, and version remain the authored focus.
