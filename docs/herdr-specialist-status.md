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

A second isolated proof invoked the actual `/plan` command and completed scout investigation, interactive Astra planning, one sequential worker and independent review.
The original todo extension and `write-todos` and `commit` skills were loaded privately from immutable `HazAT/pi-config` revision `34829ad8053667e16b1288f9c1d24d8a300ec077`.
The planner produced a plan and one todo; the worker reproduced a failing empty-string greeting regression, implemented the behavior and committed it; three synthetic tests passed and the reviewer independently approved the change.
Native session metadata verified the approved role models and medium thinking, and all four results reached the parent asynchronously.

This initial pipeline needed recovery: the original worker allowlist excluded the todo tool required by its instructions.
It requested help, the parent claimed the todo, and the worker continued in the same native session through resume.
The worker preset now includes `todo`, matching its existing get/claim/close contract.
The missing capability was reproduced through the public launch test before the correction.
A separate fresh native proof then used the corrected default worker, without model/tool overrides or a parent-assisted claim, to get, claim and close its own synthetic todo and return the result.
The full pipeline was not repeated from scratch after this focused correction.

The actual `/iterate` command was also exercised natively.
Its child inherited 50 parent entries including 20 conversation messages, recalled the earlier completion token and returned its own result through explicit native completion.

These original planning dependencies are not supplied by this extension.
Declarative deployment must provide their pinned resources and verify effective discovery before advertising `/plan` as ready.
They were loaded only in private proof configurations, with their todo/session writes scoped there; active configuration and native archives were preserved.
The visual-tester's approved Computer Use instructions and capability acceptance are tracked separately in dotfiles ticket #41.
Deployment and the effective local configuration remain gated by the remaining spec tickets.
