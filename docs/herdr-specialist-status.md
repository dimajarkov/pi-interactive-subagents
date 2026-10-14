# OpenAI specialists and workflow evidence

All five bundled specialists run native Pi children.
This is the extension-specific exception to dotfiles' usual native-Codex planning and long-running-work routing.
Their child model and thinking settings come from the agent definitions; the parent's defaults are unchanged.
The bundled Claude Code preset is removed, while generic upstream compatibility code remains available for independently authored definitions.
Project/global agent overrides still take upstream precedence, so deployment must verify the effective local definitions and provider filter.

Exact provider/model requests are checked against the host's model registry before creating a pane.
An unavailable requested model produces an actionable error without model substitution or child creation.
Availability in a registry is not an authentication or entitlement guarantee; subsequent provider errors retain the existing child-error delivery path.

## Workflow contract

`/subagent` keeps the named direct-spawn command.
`/iterate` continues to request a full-context fork.
`/plan` keeps scout investigation, an interactive planner, sequential workers, and review.
Its examples now name children by phase, which the Herdr adapter applies only to owned child panes.
The planning parent title remains scoped to the calling pane; the adapter does not rename its shared workspace or tab.
The planner completes with `subagent_done`, preserving native conversation history and returning its plan and todos to the parent.

## Acceptance evidence

The public registration tests exercise command prompts, bundled model defaults, hidden-definition precedence and the absence of the bundled Claude route.
The public child-launch tests verify all five exact model commands at medium thinking, phase titles on their actual synthetic Herdr child targets, and unchanged parent settings.
They also verify unavailable-model rejection before child creation.
The complete deterministic suite passed 160 tests.
These controlled process-boundary fixtures establish contracts, not rendered acceptance or live planning quality.

An isolated native Pi/Herdr proof executed the exact planner `openai-codex/gpt-6-astra` at medium thinking.
The native session recorded the selected model and thinking level, and an actual successful assistant response recorded that same model and thinking level.
Explicit native completion returned its result asynchronously to the parent.
No alternate planner model was substituted.
The scout, worker and reviewer also produced actual successful `openai-codex/gpt-6.1-sol` responses at medium thinking, with independently delivered parent results.
The visual-tester model-only probe failed clearly before any model request because the isolated configuration lacked its current `chrome-cdp` skill dependency.
No replacement skill, alternate model or browser route was supplied to make that probe pass.

The complete native `/plan` investigation, interactive planning, todo execution and review pipeline remains unaccepted.
Its todo dependency is not supplied by this extension and was absent from the isolated proof configuration.
A successful model-only proof is not evidence that those full workflow phases have run.
The visual-tester's approved Computer Use instructions and capability acceptance are tracked separately in dotfiles ticket #41.
Deployment and the effective local configuration remain gated by the remaining spec tickets.
