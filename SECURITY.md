# Security policy

## Supported versions

Until a later stable release line is established, only the most recent
repository release receives security fixes. Pre-release branches, old source
snapshots, generated Project content, and user-configured third-party AI
endpoints are not separately supported versions.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/Sisyphe42/ReignsAgent/security/advisories/new).
Do not open a public issue for an unpatched vulnerability or include API keys,
private project content, or other secrets in a report.

Include the affected version and platform, reproduction steps, security impact,
and any minimal proof of concept that helps confirm the issue. You should
receive an acknowledgement through the GitHub advisory within seven days.

## Security boundaries

- Deployable players contain authored content and the player runtime, but not
  Creator AI settings, provider SDKs, API keys, or generation tools.
- Local Creator credentials are user-controlled configuration. Default exports
  and release artifacts exclude them.
- Portable Creator archives keep workspace data beside the extracted app under
  `ReignsAgentData`; that directory is deliberately excluded from release ZIPs.
- Generated Windows Project EXEs require an installed WebView2 Evergreen
  Runtime and do not download external runtimes automatically.
