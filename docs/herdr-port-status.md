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
