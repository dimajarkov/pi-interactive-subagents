# Native Herdr lifecycle proof (#38)

`test/integration/herdr-lifecycle.test.ts` exercises the registered public parent tools with isolated native Pi 1.1.0 processes and fresh unfocused workspaces in an explicitly authorized named Herdr session.
The parent and model-backed children use `openai-codex/gpt-6.1-sol` with medium thinking.
No active Pi settings or user conversation files are changed.
Existing approved OAuth is read through an isolated symlink, rejected if expired or near expiry, and checked for unchanged content.

```sh
PI_HERDR_TEST_SESSION=<authorized-session> \
PI_HERDR_TEST_AUTH=<existing-auth-file> \
node --test test/integration/herdr-lifecycle.test.ts
```

The test is skipped without both opt-in variables.
Private evidence directories, isolated configurations, native conversations, and task-owned parent workspaces remain available for review.
Do not publish evidence files or credential values.
Every Herdr operation explicitly selects the named session and uses returned opaque handles.
The harness verifies preserved workspace focus and preservation of all preexisting workspaces.

The real model-backed scenarios cover:

- `caller_ping` delivers a help request and exits the first owned pane.
- `subagent_resume` continues the same native conversation with parent guidance, preserves an interactive `autoExit: false` pane after a normal turn, and accepts subsequent synthetic user input calling `subagent_done`.
- A second resume of that same native conversation uses `autoExit: true` and returns its new summary without explicit completion.
- Public `subagent_interrupt` stops an active native bash turn, preserves the child pane and conversation, and emits no completion solely because of interruption.
- Subsequent synthetic human input disables autonomous auto-exit, keeps the same pane and native conversation open across two completed turns, and explicit `subagent_done` returns the summary through asynchronous delivery.
- Bash launch scripts longer than a terminal row remain inspectable through public tool results, and the configured shell readiness delay is honored on the native launch path.

The failure scenario uses a documented `registerProvider` streaming fixture only inside the isolated `FailureProof` process.
Its local synthetic API replaces that process's stream implementation and throws `SYNTHETIC_PROVIDER_FAILURE_38` without a remote request.
The native Pi session records `stopReason: error`, upstream error delivery reports the failure, and the owned pane closes.
This establishes native failure lifecycle and reporting with a synthetic provider boundary, not a real remote provider incident.

## Observed compatibility correction

Pi 1.1.0 reports Escape during an active tool as `stopReason: error` with the exact message `This operation was aborted`.
The pinned upstream auto-exit helper treated that abort as a fatal provider error and closed the conversation.
The fork recognizes this exact current-runtime abort representation in `shouldAutoExitOnAgentEnd`, preserving the existing public interruption promise.
A deterministic regression was red before the minimal correction and green afterward.
Other error messages still trigger the upstream error completion path.

## Intentional human-takeover adaptation

Dmitri explicitly chose ticket #38's behavior on 2026-10-14: human input disables autonomous auto-exit.
This intentionally differs from the pinned upstream helper, which ignores and resets its user-takeover marker.
The initial injected autonomous task is still excluded from takeover.
Once later input takes over a child, the marker persists for that process across subsequent turns, and completion requires `subagent_done` or `caller_ping`.
A fresh resumed child continues to honor its requested `autoExit` setting.
The isolated native interruption/follow-up scenario failed before this adaptation because the first human follow-up automatically delivered a result and closed the pane.
It now checks two normal human turns in the same pane before explicit completion.

## Validation of the adaptation

All 138 deterministic tests pass with inherited `HERDR_SESSION=handovers`.
The focused real Pi takeover scenario passes: public interruption, two completed human-input turns in the identical pane/conversation with no premature result, explicit `subagent_done`, one asynchronous parent result, and owned-child closure.
The native harness also verifies unchanged authentication content, preserved workspace focus, and all preexisting workspaces retained.
A broader rerun passed takeover and native synthetic-provider failure, but its help/resume case timed out after the model returned a text summary instead of invoking the requested completion tool.
That rerun is not claimed as a fully passing suite.
The synthetic fixture now explicitly says prior wait/no-tool instructions applied to previous turns and requires the actual completion tool.
The prior help/resume acceptance remains the independently recorded native proof at integration `a45045e7fce01d4ae098d6f42aa4f00f4924b262`; it was not repeated successfully in this adaptation run.

Synthetic CLI input proves native session and tool behavior, not physical-key parity or rendered native-client visual acceptance.
Replacement-occupant ownership safety, full backend parity, customization, active deployment, and Computer Use terminal automation are outside this slice.
