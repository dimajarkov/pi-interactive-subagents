# Existing multiplexer compatibility (#43)

The comparison baseline is pinned upstream commit `c100577ebf7393a11d098ad9810ec6c269dcfc30`.
This is an evidence record for the fork, not an assertion that every backend was run live or the active extension was deployed.

## Retained public contracts

The four upstream adapters remain available through explicit `PI_SUBAGENT_MUX=cmux|tmux|zellij|wezterm` selection.
An explicit unavailable backend returns unavailable rather than falling through to Herdr or another multiplexer.
The Herdr addition precedes automatic detection only when its environment is present; an explicit upstream choice still wins.
Deterministic executable-boundary tests verify all four choices inside a synthetic Herdr environment.
These fixtures establish routing behavior, not working real multiplexer sessions.

Before the later TypeScript/Oxc integration, the `subagent` parameter schema was compared byte-for-byte to the pinned baseline and was identical.
The subsequent toolchain slice retains those public schema semantics while formatting the source.
The existing parent tools remain `subagent`, `subagent_interrupt`, `subagents_list` and `subagent_resume`; child tools remain `caller_ping` and `subagent_done`.
Commands remain `/subagent`, `/iterate` and `/plan`.
The source comparison found no replacement aliases, dashboard, changed context-mode schema or general Codex child backend.
The initial compatibility comparison found `session.ts`, `activity.ts` and `status.ts` unchanged from the baseline.
The subsequent TypeScript/Oxc slice formats and types these files; the existing session, activity and status contracts remain covered by the deterministic suite.
Standalone and lineage-only launches retain artifact task delivery, and full-context forks retain direct task delivery.

Approved adaptations include exact OpenAI role models, human input permanently disabling child auto-exit, first-task skill application, explicit planner completion, app-host-serviced visual observations and Herdr managed lifecycle safety.
Cleanup failures now preserve result/session details and surface a failure instead of claiming successful cleanup; this intentional safety behavior also applies to existing backend cleanup errors.
Normal parent async result, help and resume behavior remains in the original extension lifecycle.

## Deterministic and upstream-suite evidence

The initial integration passed all 214 deterministic tests.
After the narrow compatibility fixes, the full suite passed 217 tests with no failures or skips.
The later canonical `npm test` command includes the additional system-prompt-mode test and passed all 218 tests on the merged candidate.
`npm run typecheck`, `npm run lint` and `npm run format:check` also passed with the reviewed project-local toolchain; prose remains excluded from automatic formatting.
The new public tests cover provider defaults, exact backend selection and WezTerm targeting/text/Escape/read/closure across the external CLI boundary.

The two original upstream surface/lifecycle suite files were also invoked with all inherited mux context removed and an explicit OpenAI model.
Both file containers completed successfully, but each reported that no supported runtime was available and registered zero live cases.
Node reported two passed file containers, zero suites, zero failures and zero skipped test objects.
Those numbers are not real surface/lifecycle successes: the suites self-skipped before registering backend cases.
The upstream harness discovers cmux, tmux and zellij only; its focus helpers cover cmux and tmux, not WezTerm or zellij.
No unsupported backend was added to that harness merely to make coverage look complete.

## Available real-backend evidence

On 2026-10-15 cmux, tmux and zellij were unavailable on PATH and at the checked standard application/Homebrew locations.
No package was installed to manufacture availability.
Their real launch, targeting, focus, interrupt, resume and cleanup coverage remains unavailable.

WezTerm and its mux server were installed at version `20240203-110809-5046fc22`.
A fresh private configuration started an isolated foreground server with its own socket, synthetic project and private Pi settings.
The exact server process, UID, configuration and socket ownership were checked before input; the inherited user socket and existing GUI were never attached.

The real public adapter proof passed separate child targeting, synchronous/asynchronous output reads, long-command execution, completion-marker polling, raw Escape delivery and closure limited to proof-owned child panes.
A native Pi parent and child used `openai-codex/gpt-6.1-sol` with medium thinking, verified from native session records.
The public `subagent_interrupt` stopped an actual bounded bash sleep, and the same child pane/editor remained open.
Its subsequent help-request turn failed at the provider before `caller_ping` ran, with a generic processing error and three exhausted automatic retries.
This failure is retained and is not represented as successful recovery of that conversation.
No fork root cause was established; the post-interruption provider/native-turn limitation remains unresolved.

One fresh bounded child then successfully called `caller_ping`.
The parent resumed that exact child session path with `autoExit: true`, received its new summary independently through `subagent_result` with exit code zero and completed its own turn.
The help and resumed child panes closed while the original parent and failed interrupted child remained available for review.
After ROOT explicitly authorized retirement, fresh process birth/UID/configuration/socket and exact two-pane ownership checks passed.
Only those two remaining proof panes were closed, an empty pane list was verified, and the same owned foreground server was stopped with SIGTERM.
All private sessions, fixture files and evidence were retained; no other mux domain was attached or retired.
Credentials were linked through the existing approved source; their bytes were unchanged during the successful fresh help/resume proof.
All model calls in this ticket used OpenAI; no Anthropic model was used.

This headless mux proof establishes CLI/session behavior only.
It makes no physical-key, pixel, GUI focus, native terminal Computer Use or WezTerm focus-preservation claim.
The upstream documentation promises background focus preservation for cmux/tmux; those environments were unavailable, so their focus behavior remains unverified.

## Discrepancies and smallest fixes

The installed WezTerm returns trailing empty viewport rows from `get-text`.
The pinned adapter sliced the final five rows before removing that padding, hiding a genuinely emitted completion marker and stranding screen-based polling.
A real proof reproduced this failure before any model request.
A failing public screen-read regression then demonstrated the same output loss at the CLI boundary.
The fix removes only trailing blank-row padding in the two WezTerm read branches before selecting recent lines; interior blank content is preserved.
The actual owned-server rerun then observed the completion marker and returned exit code zero.
Other backend read implementations are unchanged.

The upstream lifecycle harness and its two synthetic child definitions defaulted to Anthropic, contrary to this fork's regression configuration.
A failing public fixture test reproduced that mismatch; the parent and child defaults now use the approved OpenAI model.
No active user provider settings were changed.
The README's outdated specialist model/CDP table and single child-tool count were corrected to the actual fork definitions.

Private fixture corrections are also retained separately: the first server configuration mistakenly selected a client domain as the server default and was refused before input; the corrected fresh server used the normal local default.
Native editor prompts require carriage return submission, so the private driver corrected its initial newline-only drafts through the supported exact-pane CLI.
A read-only evidence collector was corrected to handle native string-form user-message content; that correction did not trigger another model turn.
No private session transcripts, credentials, socket receipts or terminal captures are committed.
