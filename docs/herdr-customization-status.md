# Customization and supervision evidence (#39)

The fork preserves the pinned upstream orchestration, agent discovery and native TUI components.
This slice adds public-boundary regression tests and an explicitly enabled native Pi/Herdr proof rather than another controller.
No active Pi configuration is changed by either suite.

## Deterministic public-boundary evidence

`test/public-customization.test.ts` registers the real extensions against a fixture of Pi's host API.
The discovery tool verifies project precedence over global definitions, global-only fallback, bundled fallback and a hidden project definition shadowing its bundled counterpart.
The direct `/subagent` command still accepts an explicitly selected hidden definition, matching upstream semantics.
Registration verifies that denied delegation tools are absent while completion/help tools remain available, and that delegation is registered when permitted.
The real completion component exposes a five-line collapsed preview and expands the complete summary and native session reference.
The child widget's registered toggle expands its effective tools and denied list.
Registered native activity callbacks produce active and waiting snapshots.

The supervision test invokes the public `subagent` tool, stubbing only the external Herdr process boundary.
The parent widget exposes starting, stalled, active and waiting states.
Advancing the boundary clock without activity produces an autonomous stall notification; native child activity callbacks produce recovery.
Interactive launches retain their widget status without sending stall/recovery notifications to the parent.
These are source/component/process-fixture proofs, not rendered pixels, physical keyboard input, real child execution or model-backed stall behavior.

## Native proof

`test/integration/herdr-customization.test.ts` is opt-in:

```sh
PI_HERDR_TEST_SESSION=<authorized-session> \
PI_HERDR_TEST_AUTH=<existing-approved-auth-file> \
node --test test/integration/herdr-customization.test.ts
```

Without both variables it skips.
It requires existing valid OAuth with sufficient lifetime and refuses reconnection or refresh.
It creates a task-owned unfocused workspace with isolated settings, definitions, skills, sessions and a public host capability observer.
Auth access uses an isolated symlink without copying or reporting credential values; content equality is checked after the proof.
The retained parent workspace and private evidence remain available for review.

The model-backed proof uses `openai-codex/gpt-6.1-sol` at medium thinking.
Four direct public calls launch distinct native conversations and deliver four independent asynchronous results while the parent performs other work.
Three delayed direct children use an explicit cwd overriding the definition's cwd.
Standalone has no ancestry, lineage-only links to the parent without copied turns, and explicit fork copies an actual prior native parent turn despite the definition defaulting to standalone.
A non-autoexit nested orchestrator spawns a permitted leaf, receives its result and explicitly calls `subagent_done` before returning its own result.
Native host observations verify the allowed/forbidden delegation tools and the explicit built-in tool allowlist without relying on model claims.
Each child session verifies the exact model and thinking level.
Owned completed children close, and the focused workspace and preexisting workspaces remain intact.

## Limits and observed upstream behavior

The skills option expands the named skill template into the native child conversation.
On the installed Pi 1.1.0 runtime, an autoexit child's initial artifact task can finish before a queued skill prompt affects its result.
This slice does not claim that template expansion proves the skill influenced the completed model task.
The unchanged upstream multiple-prompt/autoexit timing remains an acceptance limitation to reconcile before claiming complete skill behavior.
A nested orchestrator needs non-autoexit behavior and explicit completion so that its first waiting turn does not terminate it before leaf delivery.
This is the upstream definition contract, not a new blanket nesting restriction.

Native terminal reads expose textual widget/completion output, but do not establish pixel layout, physical keys, focus in a native client or Computer Use acceptance.
Completion expansion and the widget toggle have real component evidence and await approved rendered/native acceptance.
The new tests do not replace the separate lifecycle/ownership, preset-model or existing-backend proofs.
Private transcripts, prompts, auth material and terminal evidence must not be committed.
