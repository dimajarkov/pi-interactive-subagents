# Herdr first-child candidate (#37)

This personal fork starts at HazAT/pi-interactive-subagents commit `c100577ebf7393a11d098ad9810ec6c269dcfc30`.
It retains the upstream cmux, tmux, zellij, and WezTerm adapters and upstream native-Pi session/completion lifecycle.
Herdr uses the same public multiplexer seam rather than a second orchestration implementation.

Inside a managed Herdr pane, automatic selection prefers Herdr.
An explicit supported `PI_SUBAGENT_MUX` override takes precedence, including `PI_SUBAGENT_MUX=herdr`.
An unavailable explicit backend or incomplete Herdr caller context fails without selecting another backend.
The CLI must be in PATH and the injected `HERDR_ENV=1`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID` must be present.

Creation uses `pane split --current --direction right --cwd <effective-child-cwd> --no-focus`.
The adapter captures the returned opaque `pane_id` and `terminal_id`, binds ownership to the caller/session context, and explicitly targets that handle for naming, shell-command launch, reads, interruption, and protected closure.
Herdr phase titles rename the caller pane, while shared workspace renaming is skipped.
Long launch scripts and upstream shell readiness remain unchanged.
Server failures expose a validated error code rather than copying arbitrary server messages or private submitted commands into diagnostics.
Naming failure attempts cleanup only after verifying owned identity and reports any child left behind.

The adapter's command syntax follows installed CLI help.
Live execution established that `pane run` and `pane send-keys` return empty stdout on success, `pane read` returns text, and creation, identity, naming, and closure return JSON.
The socket API schema alone does not describe these CLI presentation modes.
When an injected `HERDR_SESSION` is present, every adapter invocation explicitly includes `--session <name>`.
`npm test` runs the pinned upstream deterministic suite plus the process-boundary Herdr fixture tests.
These tests exercise backend selection, explicit cwd and background creation, opaque targeting, terminal identity rejection, changed caller/session rejection, reads, interruption, actionable launch/close failure, and malformed creation.
They do not establish real-terminal behavior.
The current Node v22.23.1 runtime executes these tests without compatibility changes.

## First-child acceptance

On 2026-10-14 the opt-in `test/integration/herdr-first-child.test.ts` passed through the public registered `subagent` tool on the installed native Pi 1.1.0 wrapper and Node v22.23.1.
It launched a real Pi child on `openai-codex/gpt-6.1-sol` at medium thinking, verified both settings from the child's native session, and received the exact synthetic result through upstream asynchronous completion delivery.
The parent wrote its independent-work marker before the child's delayed task completed.
The child used the explicit requested cwd, remained unfocused, and its owned pane was automatically closed on completion.
The focused workspace and all preexisting workspaces were preserved.
This proof used a fresh task-owned background workspace inside the user's explicitly requested named Herdr session.
Isolated Pi settings, extension selection, launch scripts, native session files, and evidence remained in an owner-private temporary directory.
Existing valid approved OAuth access was read through an isolated auth-file symlink without copying credential values; before/after content equality confirmed the active auth store was unchanged.
No active Pi configuration or unrelated user panes were changed.

Run the test only after authorization to create a background workspace in the named session:

```sh
PI_HERDR_TEST_SESSION=<authorized-session> \
PI_HERDR_TEST_AUTH=<existing-auth-file> \
node --test test/integration/herdr-first-child.test.ts
```

Without both opt-in variables, the test skips.
Expired or near-expiry OAuth is rejected rather than reconnected or refreshed.
The test retains its owned parent workspace and private evidence for review; the completion path proves cleanup of the owned child.
Private evidence and credentials must not be committed.

## Remaining boundaries

The evidence establishes real CLI/model execution, not Computer Use visual acceptance or physical-key parity.
Rendered layout, keyboard focus within a native client, interactive takeover, comprehensive lifecycle/ownership safety, and existing-backend real-terminal parity remain later-ticket acceptance work.
A matching terminal ID identifies a terminal, not its current occupant.
Same-terminal replacement occupants, atomic targeting races, moved panes, and transport changes not represented in the bound environment require the subsequent ownership/lifecycle ticket and its acceptance evidence.
The initial candidate must not be deployed or described as complete safety or end-user parity proof.

## Visual route candidate (#41)

The visual-tester definition now selects native Pi `openai-codex/gpt-6.1-sol` at medium thinking and replaces CDP instructions with the explicit `codex_computer_use` coordination tool.
`pi-extension/subagents/computer-use.ts` provides a one-shot owner-private request/result queue serviced by the explicitly active existing Codex app agent.
The existing agent uses its own normal Computer Use tool and app-access permission flow; the queue never launches a backend, forwards executable tool code, or generates approval responses.
The result returns to the original waiting Pi call as text provenance and, optionally, native screenshot image content.
Upstream Pi session and parent completion mechanisms remain authoritative.

An app host creates a mode-0700 queue directory and calls `openVisualHost` with exact task, native Pi session ID, canonical checkout, `visual-tester` role, synthetic target, existing Codex thread ID, and a lease lasting at most five minutes.
It supplies that directory through `PI_CODEX_VISUAL_HOST` in the isolated visual child environment.
The tool is absent unless that explicit capability is present, private, current, checkout-matched, and visual-role-matched; execution additionally checks the actual Pi session ID.
The host reads `readVisualRequest`, validates target/browser ownership using the browser-routing owner, makes the native Computer Use observation in its active turn, then calls `completeVisualRequest` with observed, denied, or cancelled findings.
A screenshot must be an owner-private PNG basename inside the queue directory and at most ten MiB.
Each observation requires a fresh queue/lease.
Missing, stale, replaced, foreign, cancelled, malformed, nonprivate, or oversized bindings/results fail closed.
A disappeared host produces bounded expiry failure rather than fallback automation.

The lease is explicit coordination authority, not an attestation of active native app permission or cryptographic protection against another process running as the same OS user.
Source and deterministic queue tests alone do not establish an approved or verified Computer Use bridge.
The bounded native-app proof below verifies one such request, actual screenshot delivery to the same Pi child, and independent upstream parent findings delivery. Browser acceptance remains separate and incomplete.
No active Pi installation or configuration is changed by this candidate.

### Earlier native route investigation (historical)

A later local proof attempt opened a fabricated task-owned TextEdit RTF document using the normal native application launch path.
No Computer Use observation or screenshot was performed, so fixture launch is not visual evidence.
A real native Pi parent invoked the public `subagent` tool for a visual-tester child with explicit lineage-only session seeding, the approved model, and medium thinking.
Native Pi asked whether to trust project-local resources before loading the candidate extension.
The proof refused project-local resources for that session and the child exited with code 1 before requesting Computer Use.
The existing parent received the independent failure through the upstream completion mechanism; this is failure-path evidence, not successful bridge acceptance.
A positive proof still requires a supported, explicitly authorized extension-loading route and the active Codex app's normal Computer Use observation delivered to the same waiting Pi session.

The proof also exposed that a newly created terminal inherits the multiplexer daemon's environment rather than the parent Pi environment.
The launcher now passes `PI_CODEX_VISUAL_HOST` explicitly only to the visual-tester role.
That capability propagation is source-verified; the failed native startup did not exercise a successful visual call.

The separate supported Chrome QA route verified the fresh disposable profile and live process ownership, but refused target scope because two targets had unsupported types.
The diagnostic reported one permitted page and no foreign targets.
No raw CDP or native interaction bypass was attempted, and the rejected owned profile/process and private evidence were retained.
This Chrome-specific containment prerequisite remains unaccepted independently of the proposed native-app route.


### Native TextEdit observation and parent delivery verified

A fresh synthetic proof on 2026-10-14 ran the visual-tester as a native Pi child with `openai-codex/gpt-6.1-sol` and `medium` thinking, verified from its native JSONL model/thinking records.
The child invoked `codex_computer_use` once. The explicitly active existing root Codex app thread serviced that request through its own normal `mcp__cua_repl.js` native TextEdit AX/screenshot APIs.
The observed document displayed the blue heading `Pi Native Visual Proof 41`, a green independently generated verification token, and readable synthetic text without visible overlap.
The child received actual text provenance plus a PNG image content block matching the privately retained screenshot bytes.
Native host screenshot bytes were encoded from JPEG to PNG for the queue format; there was no alternate screenshot capture route.

The binding matched the actual child session header, canonical checkout, visual role, exact task-owned TextEdit document, root host thread, nonce and bounded expiry.
The child model had no shell or alternate GUI tool. It completed normally and the existing `subagent-done` extension applied auto-exit; no explicit `subagent_done` tool call occurred.
The parent's native JSONL contains an independent `subagent_result` with exit code zero and the actual observed findings, request/session/host provenance, and private evidence reference.
The parent then wrote the delivered summary and returned its completion marker.
Only the task-owned child pane closed; the parent remained open, focus stayed on the preexisting workspace, and all 45 preexisting workspace IDs were preserved.

The initial child launch paused at project trust because its multiplexer shell did not inherit the private parent PATH wrapper.
The verified child menu was answered `Do not trust (this session only)`, retaining the reviewed isolated global extension while granting no persistent or parent-folder trust.
That fixture correction enabled the request; it does not change active Pi deployment or general trust settings.

Private evidence includes the native child/parent JSONL, task-owned screenshot, delivered-summary file and before/after workspace record. No private transcripts, screenshot bytes, account data or personal browser state are committed.
This verifies ticket #41 criteria 1, 3 and 6 for the bounded native TextEdit slice, alongside the already source-verified instruction replacement.
It does not verify Chrome application QA/profile target readiness, web interaction, requested Zen behavior, automated terminal UI acceptance, unattended host availability, or full release readiness.
The earlier Chrome guard target refusal remains honored and ticket #41 remains incomplete as a whole.
