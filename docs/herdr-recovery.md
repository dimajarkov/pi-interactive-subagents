# Native session policy and recovery

Managed Pi launches preserve their effective role policy beside the native JSONL history.
The versioned `<session>.subagent-policy.json` companion records the original native session ID, canonical child and immediate-parent paths, original parent ID, cwd, config root, explicit tool restriction, denied tools, role/model/thinking/skills, system-prompt policy and autonomous/interactive defaults.
Policy and execution companions are private files with mode `0600`.
They contain policy metadata and required role text, never authentication, Herdr enrollment credentials or visual-host authority.

`subagent_resume` requires the original immediate parent's native ID and canonical native file.
Possession of another branch's JSONL does not authorize adoption.
Missing, malformed, foreign or legacy policy fails before allocating a pane.
The original effective allowlist is restored even if a role definition is widened or deleted.
New explicit denials from the original config and current caller narrow that restored policy.
An explicitly empty allowlist permits only native completion/help controls, rather than reverting to unrestricted defaults.
Native active-tool filtering enforces denials for built-in tools as well as extension tools.
If the host cannot enforce that policy, the child shuts down and refuses its initial input.

Resume retains the original native conversation and appends new history.
It restores the saved cwd/config and system-prompt text, while minting a fresh child ID, activity file, execution receipt and verified Herdr job.
The autonomous/interactive default comes from the original policy; `autoExit` explicitly overrides that default for the resumed execution.
Configured initial skill expansion is not replayed against follow-up guidance.
A visual role can receive only an explicitly current visual-host capability, never a saved one.
Herdr validates fresh branch ancestry and placement using the immediate caller's managed context.

The actual Bash bootstrap clears inherited `PI_SUBAGENT_*`, `PI_DENY_TOOLS` and `PI_CODEX_VISUAL_HOST` values before installing the intended execution policy.
It derives the managed surface from the newly issued `HERDR_PANE_ID` and preserves the fresh branch-root context.
This sanitation runs in the child shell, including when the mux daemon has stale values.

## Execution and ownership receipts

`<session>.subagent-active.json` excludes concurrent managed executions of the same native history.
A definite launch refusal releases its claim.
Observer loss, ambiguous launch and unverified cleanup retain it for inspection.
Unverified cleanup also writes an exact private lifecycle receipt and keeps the parent completion hold after the failed outcome is read.
No PID timeout, absent observer or existing JSONL authorizes stealing that claim.
Each execution writes its own `<session>.<child-id>.exit` receipt.
A resumed watcher consumes only that execution's receipt and extracts only newly appended assistant output.
Old completion receipts remain evidence and cannot turn a fresh provider failure into prior success.

The original parent's `<parent-session>.delegations/` journal reserves ownership before dispatch and records the original child/session/script and acknowledged managed condition.
Atomic private writes preserve running, queued and settled outcome states.
A successful child result remains outstanding until it appears in the parent's model context and a successful assistant message processes it.
Queued outcome identities survive reload without replaying a result already present in native history.
Unresolved running ownership is retained as a completion hold rather than silently adopted by a replacement watcher.
Unsafe, corrupt or foreign journal evidence produces a conservative hold and cannot be replayed as a successful result.
A journal publication error preserves the original reservation, produces one explicit failure diagnostic with the exact receipt path, and leaves a completion hold that reading the diagnostic cannot clear.

If an orchestrator exits while its journal still contains unresolved descendants, its immediate parent receives an explicit unresolved-work outcome with original identities.
The watcher retains the orchestrator/descendant surfaces and execution claim instead of closing an unverified subtree.
Reading that diagnostic does not settle the original descendants.
Transport errors likewise cannot authorize cleanup when durable descendant ownership remains unresolved.

## Same-session native reload

Native `/reload` replaces extension registrations and invalidates their SDK/context objects.
The child records started/takeover state in native custom entries bound to its execution ID.
A same-execution reload retains human takeover and recognizes the first new input as manual control.
An explicit managed resume has a fresh execution ID and uses its requested autonomous policy.
A bounded process-owned bridge preserves an already-enrolled Herdr connection only across a quiescent reload of the exact same native ID and canonical native file.
The fresh registration claims at `session_start` and binds fresh callbacks/context before accepting control input.
The consumed enrollment credential stays absent from the environment and is never persisted or replayed.
Independent native hosts cannot claim one another's bridge, regardless of registration order.

A pending native/external operation, an incoming control frame during the handoff gap, a socket failure, native-session change, quit, switch, fork or resume retires the connection.
A failed reload expires its unclaimed bridge after thirty seconds.
Genuine process exit also tears it down.
No callback invokes the old native SDK/context after registration replacement.
Per-registration child watchers remain independent; previously unresolved children remain visible through durable receipts rather than receiving guessed replacement observers.
Fresh delegation can proceed from the reloaded native session while those original ownership holds remain explicit.

## Manual recovery boundary

Keep the native JSONL, policy, execution companion, delegation journal and launch/lifecycle receipts together.
Inspect each recorded original job and full terminal condition against the intended named Herdr server before taking an action.
Do not retry an ambiguous launch or clean a guessed pane, descendant, sibling or changed occupant.
A human can inspect legacy/orphan history using native Pi session tooling, but that does not establish managed adoption or settlement.
There is no automatic claim deletion, reparenting or orphan cleanup command.
Resolve original owned jobs explicitly and retain the evidence when ownership cannot be proved.

Host-boundary and socket tests cover policy restoration, denial enforcement, stale environment cleanup, fresh execution receipts, concurrent/foreign resume refusal, durable replacement and unresolved-work propagation.
The opt-in `test/integration/herdr-lifecycle.test.ts` recovery test exercises the registered public tools, actual native history/tool policy, fresh managed job, native `/reload`, and an exactly correlated managed prompt/settlement.
Synthetic terminal input and native API evidence do not prove physical keyboard behavior or rendered pixels.
