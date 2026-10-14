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

On Pi 1.1.0, upstream artifact delivery starts the task before the separate positional skill prompts.
An autoexit child can terminate before those prompts run.
The fork now transforms the initial child input with explicitly configured skill contents, using the child's public resolved command inventory so settings, packages and project/global discovery remain native.
All configured skills and the task run in one initial turn.
Missing or unreadable skills stop that initial task, write the existing parent error sidecar and shut the failed child down.
The parent receives a failure with exit code 1 and the precise skill error.
Later human input is left untouched.
The public input regression covers multiple skills, native relative-reference locations, one-time application and missing-skill failure.
The native proof requires the final autoexit child result to include a marker that appears only in its configured skill.
The Pi 1.1.0 native run passed this assertion along with all existing parallel/context/capability checks.
A subsequent public missing-skill child call delivered its precise missing-skill error asynchronously to the parent with exit code 1 and without executing the task.
A nested orchestrator needs non-autoexit behavior and explicit completion so that its first waiting turn does not terminate it before leaf delivery.
This is the upstream definition contract, not a new blanket nesting restriction.

Native terminal reads expose textual widget/completion output, but do not establish pixel layout, physical keys, focus in a native client or Computer Use acceptance.
Completion expansion and the widget toggle have real component evidence and await approved rendered/native acceptance.
The new tests do not replace the separate lifecycle/ownership, preset-model or existing-backend proofs.
Private transcripts, prompts, auth material and terminal evidence must not be committed.
