# Native Pi cooperative control

The child control module `pi-extension/subagents/herdr-control.ts` implements the public child half of Herdr managed control v1.
Parent managed-job adoption and the matching Herdr server are separate requirements; this module is not an active installation or a terminal-input fallback.
The route coordinates an original registered native Pi session inside a whole-job-owned resource.
It is not a sandbox for other installed extensions or arbitrary same-user code.

## SDK and identity requirements

Native Pi must expose the dotfiles-owned admission/lifecycle capabilities from earendil revision `abe508e1b89912adde45528136c3221eb69acdd7` plus `pi-native-message-admission.patch` and `pi-user-request-lifecycle.patch`.
The module checks actual public enqueueMessage, getUserRequest, getUserRequestPreparation, isIdle, hasPendingMessages, abort and shutdown functions before enrollment.
The development npm 0.65 package does not establish these capabilities.

The injected enrollment capability, version and socket environment are captured once and scrubbed before child tools can inherit them.
Registration binds one exact stream, random epoch and native session to the server's returned AgentCondition.
Session switch, fork, shutdown, reload, socket loss or changed binding revoke that route without reenrollment or capability reuse.
Remote pending/active correlated admission cancels switch/fork until its actual request end; unrelated idle session operations invalidate the route synchronously.
Later route loss preserves the native editor/conversation rather than killing it.
Revocation clears local pending route authority so disconnected admission cannot indefinitely veto switch or fork.
It does not cancel a message already admitted to Pi's native queue; any such request's fate follows native lifecycle, and the disconnected route cannot credit its outcome.

## Prompt and abort semantics

A remote prompt is displayed as `herdr_control_prompt`, an additive native custom message, using patched public enqueueMessage with an exact external correlation ID.
It starts idle work without a dummy user message.
Custom messages do not run ordinary slash-command, prompt-template or input-transform expansion, and must not be presented as equivalent to typed native user input.
Received acknowledgment precedes the enqueue call; accepted acknowledgment requires exactly one native correlated member UUID at user_request_start.
Settlement requires that exact member and scope at user_request_end with its native outcome.
Matching text, a foreign extension's identical content, and generic agent_settled never establish operation identity.
Ambiguous grouped correlation revokes the route.

Initial and human-started scope observations use the public current request getter and native lifecycle events.
Abort targets the actual response-scope UUID, including grouped scopes, rather than a member UUID or agent kind.
Immediately before public abort, both the current getter and locally observed active scope must still match.
The end handler marks its scope ended before acknowledgment and observation, rejecting reentrant abort even when a getter temporarily retains the ending scope.
No Escape bytes or PTY prompt delivery is used.

The child accepts at most 256 external operation IDs and retains at most 256 ended native scopes for that route's lifetime.
Exhaustion explicitly revokes the route with diagnostics; it never silently forgets an identity or retries against another target.
A new managed job is required for a new control route after such revocation.
Every incoming/outgoing frame is bounded to 16 KiB; registration and individual socket writes have five-second bounds.
Malformed UTF-8/JSON, primitive/null/array envelopes, wrong condition, and oversized frames close only that route.
No automatic timeout resubmission exists.
Server operation deadlines and status distinguish uncertain outcomes from accepted/settled work.

## Startup refusal and exact limit

Missing SDK or refused initial registration writes the existing error sidecar when possible and invokes original public shutdown in a finally path before session_start returns.
A managed-only input handler additionally blocks the assigned initial native user task after startup failure.
The input fence is necessary: native shutdown is scheduled, and shutdown alone allowed the initial argv task to reach an offline provider during an observed first failing test.
No success sidecar is produced for an initialization failure, including missing shutdown capability.

A separate native competing-extension test demonstrated that an independent session_start handler can still enqueue a custom message and trigger an offline provider before scheduled shutdown.
The assigned initial user task remained blocked.
Thus refusal proves assigned-task admission prevention and control-route denial, not universal prevention of model/tool activity from arbitrary other extensions.
No private SDK hook or new core patch was introduced to hide this limitation.

## Executed evidence

The public test seam is registered SDK callbacks plus an actual isolated Unix socket server with synthetic Herdr response frames.
It covers feature refusal, one-use environment scrub, immutable route lifetime, synchronous enqueue ordering, competing input preparation/queue rejection, grouped request identities, initial/human exact-scope abort, stale end-getter rejection, replay, unknown methods, ambiguous correlation, startup admission, missing functions, and bounded malformed frames.
This fixture is not proof of Herdr peer ancestry authentication or managed job ownership.

An isolated native Pi 1.1.0 fixture loaded only the explicitly supplied fixture extension through `-ne`, disabled skills/templates, used a private configuration directory, and registered an entirely offline synthetic provider.
Its actual child module was loaded from this worktree; no source installation or active server/app was changed.
Missing SDK and denied registration prevented the assigned initial task and any provider call in the configured single-extension fixture.
Successful enrollment admitted a real native custom prompt, ran the built-in Bash tool's sleep process, rejected unrelated abort scopes, aborted its exact original response, observed interrupted request-end settlement, and settled a subsequent prompt in the original native PID.
Terminal bytes were captured without claiming rendered visual or keyboard acceptance.
The route server was synthetic, so this evidence does not establish the production Herdr wire/peer contract end to end.

Private native scripts/results: `/private/tmp/pi-herdr46-adoption-native/`.
`result.json` preserves initial failure, registration denial and successful native Bash/correlation outcomes.
`result-competing-startup.json` separately records the legitimate independent custom-enqueue ordering gap.
