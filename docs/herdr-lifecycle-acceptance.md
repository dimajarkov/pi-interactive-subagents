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
- Subsequent synthetic input in that same child completes normally and returns its summary through upstream asynchronous delivery.
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

## Outstanding acceptance boundary

Pinned upstream `shouldAutoExitOnAgentEnd` deliberately ignores the user-takeover marker and auto-exits after a normal user-initiated follow-up turn.
Ticket #38 instead says human input disables autonomous auto-exit “as upstream specifies.”
The source and the ticket disagree.
The tests preserve and identify the observed upstream behavior until the user decides whether to change the behavior or correct that criterion.
This criterion is pending and ticket #38 must not be reported fully accepted on the basis of these tests.

Synthetic CLI input proves native session and tool behavior, not physical-key parity or rendered native-client visual acceptance.
Replacement-occupant ownership safety, full backend parity, customization, active deployment, and Computer Use terminal automation are outside this slice.
