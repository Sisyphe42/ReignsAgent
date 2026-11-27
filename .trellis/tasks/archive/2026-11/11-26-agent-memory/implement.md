# Implementation plan

1. Usage: Pipeline `extractEndpointUsage` + exchange `usage`; loop meter; history records;
   summary projection; mock endpoint `usage` option; UI list/replay; unit + integration tests.
   Commit.
2. Block stats: summary `blockedBy`; `RepairBlockStats` + filter; unit + browser test. Commit.
3. Declined memory: record fields, mark applied/undone, undo route (server + Hosted),
   `collectRepairMemory`, loop constraint + prompt rule, worker input, Creator undo stack,
   Context lines, replay line; unit + integration + browser tests. Commit.
4. Draft relevance selection with 12-card limit; tests. Commit.
5. Docs (README, ai-assist architecture, spec), demo.mjs cases/env; verify, hosted, eval;
   push; CI; handoff.

Validation: `npm run verify`, `npm run test:hosted`, `npm run eval:repair`.
Rollback: each step is its own commit.
