# Herdr failure safety: ticket 42 partial acceptance

This candidate builds on accepted integration `b37e04d` and addresses public child lifecycle and adapter failure handling.
The ticket remains partially accepted; native keyboard/rendered acceptance and terminal-replacement races are not established.

## Changes and evidence

- A failed Herdr terminal read without a concurrently written exit sidecar now fails its watcher and notifies the parent instead of waiting forever.
- A valid exit sidecar arriving during a failed read still supplies the child result.
- A post-split launch failure cleans only a pane created by that invocation, validating its current identity before closure.
  Caller-supplied/pre-created surfaces are never closed by this launch catch because this invocation did not create them.
- Protected cleanup rejection remains visible beside the original lifecycle failure or completed child summary, including resumed-session results.
  Completion cleanup is attempted once; no protected-close bypass or guessed target retry is introduced.
- Child receipts bind pane, terminal, workspace and tab identity.
  Missing metadata or changed membership rejects targeting.
- Supported `pane layout` metadata is inspected before splitting.
  Existing zoom or absent zoom state produces an actionable error before any split; the extension never toggles zoom or changes global layout.
- Parallel synthetic children preserve distinct sessions, independent closure targets, and both parent result notifications when one fails and another completes.

Ten public-boundary tests in `test/herdr-failures.test.ts` use registered Pi tool execution and parent notifications, plus public mux operations against a synthetic external Herdr CLI.
They do not execute native Pi/model turns or establish rendered terminal behavior.
The full combined deterministic suite passed 156 tests.

## TDD reproductions

Each changed behavior was reproduced before its corresponding fix with `node --test test/herdr-failures.test.ts`.
Observed red outcomes were: stranded parent watcher after absent-pane read failure; hidden secondary protected cleanup error; lost completed child summary on protected close; no cleanup after failed child launch; no cleanup after failed resume launch; moved target still accepted; zoomed layout still split; and resumed summary hiding cleanup diagnostics.
The late-sidecar and independent parallel cases additionally protect behavior at those same public seams.
The resume cleanup red output is retained privately at `/private/tmp/pi-herdr-ticket42-resume-red.txt`.
The final full test output is retained at `/private/tmp/pi-herdr-ticket42-full-tests.txt`.
Earlier red executions are recorded in the agent tool transcript rather than invented standalone log files.

## Isolated real-Herdr evidence

A fresh unfocused task-owned workspace `w56` was created in explicitly named session `handovers`.
The proof used a shell child, not a native Pi/model child.
The extension's public adapter created child `w56:p4`; the test then manually closed exactly that owned child through Herdr.
Public `readScreenAsync` and `pollForExit` rejected the missing target; the latter failed in 14 ms without a sidecar.
Caller terminal identity and focus were unchanged, and the complete workspace-list response compared identically before and after.
Private reproducible script and result: `/private/tmp/pi-herdr-ticket42-native.mjs` and `/private/tmp/pi-herdr-ticket42-native-result.json`.
This proves real CLI dead-pane handling, not native typing, paste, keys, resize or visual acceptance.

A separate earlier setup test explicitly zoomed only the task-owned caller, then restored its zoom.
Installed Herdr permitted a split while zoomed, and that test observed caller `focused` changing from false to true.
The result is retained at `/private/tmp/pi-herdr-ticket42-zoom-result.json`; native focus preservation was not established for that test.
No guessed focus restoration or further zoom mutation was performed.
The subsequent extension fix refuses zoom through the supported `layout.zoomed` field, verified deterministically; it has not been replayed against a live zoomed terminal.

## Remaining acceptance limits

1. Malformed/CLI/launch cleanup has deterministic coverage, but native protected-close and broad partial-launch fault injection remain unproven.
2. Stale/moved/replaced identities fail when detected during pre-operation validation.
   Installed `pane get` and `pane run` accept only opaque pane IDs and expose no conditional terminal-identity argument.
   Separate get and mutation calls do not prove atomic exclusion of an occupant replacement between those calls.
   Herdr documentation states closed IDs are not reused and cross-workspace moves receive new IDs; this does not establish conditional same-pane terminal replacement.
3. Missing-pane/read lifecycle failure is proved at synthetic registered-tool and real shell-child public-poll boundaries.
4. Protected-close is honored with visible cleanup diagnostics in deterministic public tests; no real protected agent was manipulated.
5. Existing zoom now refuses through supported metadata with no automatic layout change; live refusal and constrained-geometry behavior remain unproven.
6. Parallel failure and independent completion are proved synthetically, not through native concurrent failure injection.
7. Native CLI dead-pane proof preserves caller/workspace state, while native zoom setup focus preservation failed as recorded above.
   Broader unaffected input/title/lifetime fault cases remain incomplete.
8. Native typing, Unicode, paste, resize, and Pi-key recovery are unproven because no approved terminal Computer Use route was used.

No deployment, push, ticket closure, user-pane modification, or worktree cleanup is part of this candidate.
