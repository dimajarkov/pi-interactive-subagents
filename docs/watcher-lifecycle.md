# Watcher lifecycle ownership

Every extension registration owns its child registry, watcher controller, timers and UI context.
Native session shutdown stops that owner's observation; a new session or extension registration receives a fresh controller.
An old owner's shutdown cannot cancel a newer owner's children.
Each launch captures its observer signal before awaiting Herdr allocation, including launches still in flight when shutdown occurs.

Observer shutdown is distinct from deliberately interrupting or closing a child.
It does not close the retained child job and does not steer a completion into a replaced parent conversation.
A cancellation receipt is written beside the launch script at the `lifecycleReceiptFile` returned in the launch acknowledgement.
It records the child and original parent native session paths, scoped job condition or surface, observer identity, lifecycle event and reason, and the `retained` cleanup outcome.
A receipt can precede creation of the child's native session file while Pi is still starting.
Inspect the exact retained job and native session before recovery; do not resume a second writer while that original child remains active.
Retained children remain visible in their Herdr panes and can finish their original work.
Automatic adoption into a different native parent conversation is deliberately absent.

Completed children still close their own exact job resource through normal completion cleanup.
Explicit child watcher cancellation and infrastructure failures retain their native session path and cleanup outcome in delivered failure details.
Infrastructure failures are not labelled as provider or billing failures.

`test/watcher-lifecycle.test.ts` exercises the public registered tool and lifecycle hooks, stubbing only the external Herdr boundary.
It covers shutdown/start replacement, old/new instance isolation, retained children with cancellation provenance, four parallel launches and shutdown during allocation.
Native acceptance must additionally launch real scouts after an actual Pi session replacement using the declared package and Herdr route.

## Verification

The session-replacement failure was reproduced through the installed Pi native RPC `new_session` command followed by a real public scout launch.
Before the fix, the launch acknowledged and then returned `Subagent watcher cancelled` with exit code one and elapsed zero.
The public regression suite covers five lifecycle cases, and all 223 unit tests, type checks, Oxc lint and formatting pass.

`test/integration/herdr-session-boundary.test.ts` is an opt-in real-model test using a private full Pi resource configuration with a declared immutable Git package.
It does not force-load the extension from a development checkout.
It performs a native session replacement before one scout and another replacement before four parallel scouts.
The installed candidate returned all five real findings on `openai-codex/gpt-6.1-sol` with medium thinking, with four simultaneous child panes independently observed.
All completed child panes closed, existing workspaces and focus were preserved, and the synthetic fixture remained unchanged.
Native proof used the user-authorized `arena` Herdr session and excluded application/customer data.
