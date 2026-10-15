# Repository-owned synthetic Chrome proof runtime

`scripts/qa/chrome-owner.mjs` is development prerequisite tooling for the isolated Chrome part of dotfiles ticket #41.
It is not installed as a Pi extension or global command and changes no active Nix/Pi configuration.
Dotfiles browser-routing policy and the public `chrome-devtools-axi` guard remain authoritative.
The helper's source and mocked tests do not establish actual Chrome or native Computer Use acceptance.

## Reviewed launch contract

Run only after approval of the concrete fresh proof, in an ordinary task-owned foreground Herdr shell at this checkout's physical Git root.
Keep the named session and workspace explicit when placing the shell through Herdr.
Do not use an agent pane as the bridge owner.

```sh
env -u NODE_OPTIONS -u NODE_PATH node scripts/qa/chrome-owner.mjs --task pi41-browser-fresh1
```

Use a fresh bounded task name for every run.
The helper refuses other options, arbitrary URLs, executables, existing profiles/receipts and runtime/transport overrides.
The documented invocation removes Node loader controls before Node starts; the helper also rejects inherited browser/backend controls.
It requires macOS, the installed stable Google Chrome bundle, the public guard at `~/.local/bin/chrome-devtools-axi`, and the existing Herdr CLI at `/opt/homebrew/bin/herdr`.
Missing prerequisites fail without substitution or installation.

The helper verifies physical Git-root placement, the stable Chrome signature and current ordinary Herdr foreground caller.
It creates a private synthetic HTTP fixture with a unique visible title/token, fabricated account label, counter and draft input.
The fixture listens only on a freshly selected loopback port, serves only its fixed document, and has a restrictive content policy without external assets or provider operations.
The fixture is not a browser egress sandbox.

The helper calls the public guard's `prepare-profile` with only the fixture origin.
It launches the fixed stable Chrome executable against the new guard allocation with the required private-profile, loopback CDP, disabled sync/extensions, mock keychain, basic password store and blank target flags, plus the fixed QA option described below.
Its Chrome child has a separate signal process group to keep owner Ctrl+C from signaling the browser.
The owner stays foreground and retains the referenced child handle; it does not unref the child or launch a detached backend bridge.

Only public guarded `attach ... diagnose` observes browser metadata.
A bounded startup retry never bypasses ownership checks.
Exit zero alone is insufficient: the structured report must verify ownership, ready target scope, a permitted page and zero rejected target categories.
Unsupported/internal/foreign/malformed targets, lost caller identity, process exit or timeout retain exact resources and never produce ready instructions.
The helper never reads CDP directly, changes the guard allowlist, copies a profile or authenticates a real account.

## Fixed application QA configuration

This helper always adds exactly `--disable-features=PreloadTopChromeWebUI` to its reviewed launch arguments.
The option suppresses Chromium's background TopChrome WebUI preloading mechanism; requested or independently created browser UI can still exist.
It is a fixed source-owned application QA configuration, with no feature-selection option or caller-supplied flag list.
The owner CLI rejects arbitrary extra options, and the spawn boundary rejects absent, additional, duplicate or conflicting feature controls before opening a log or launching Chrome.

The matching owning guard must support this exact optional launch argument before a new proof is started.
Its optional shape preserves diagnosis of older retained allocations; the Pi helper itself always selects the declared suppression configuration.
Do not inject the flag through an alternate raw launch, change personal Chrome preferences or reuse a blocked allocation.

Target readiness and rejection rules remain unchanged.
Browser UI, internal, foreign, unknown or malformed targets still block proof under the existing guard.
The flag does not turn such targets into permitted pages, navigation destinations or capture/control targets, and does not guarantee successful startup.
A successful fresh proof would establish behavior only under this explicitly declared QA configuration, whose Chrome UI startup behavior differs from its default.
Keep that limitation with any later acceptance evidence.
The earlier native TextEdit and blocked Chrome records remain historical evidence for their original configurations.

## Bridge and native proof

On initial readiness the helper prints a private state-file path.
That unsigned file is convenience state, not permission attestation or durable proof of current readiness.
Revalidate through the public guard before subsequent observations.
Keep the owner process foreground throughout the bounded proof.

Run public `attach ... bridge` synchronously as a direct child of another ordinary shell in the same fresh task-owned workspace at physical Git root.
Use only the fresh receipt, exact Chrome PID and selected CDP port recorded in private state.
The bridge guard verifies its own current caller ancestry and lifecycle.
A separate ordinary shell in the same owned workspace may issue supported public attached commands, including `open` to the allocated synthetic fixture origin.
Do not wrap or daemonize the bridge, move its checkout, reuse old receipt/PID/server state or inspect personal Chrome tabs.

The active root Codex host must independently acquire the exact verified native Chrome window through its own normal Computer Use API.
Match the guarded process/profile and actual fixture URL/title/pixels before interaction.
App selection or a window title alone is not ownership proof.
If the native API cannot uniquely acquire that task window, stop and record the routing gap.

Use a new native Pi visual-tester session and owner-private queue bound to that session header, canonical checkout, role, exact fixture, task, root thread, nonce and expiry.
Only the active root host opens the lease and services its own normal approval-bearing native tool.
Return actual observed findings/screenshot to the child and verify independent parent delivery.
Parent PATH does not propagate through a multiplexer daemon; decline project trust for the child session only or use an explicitly reviewed launcher actually passed to that shell.
Chrome observations prove Chrome behavior, and do not imply Zen, terminal UI or unattended native capability acceptance.

## Retention

There is no stop/cleanup command and no automatic browser signal, kill-all, profile removal, receipt retirement or worktree pruning.
Interruption closes only this helper's synthetic HTTP listener and reports the browser/profile retained.
The separate Chrome signal group prevents owner interruption from signaling Chrome.
Closing the fixture ends proof admission even if an already rendered page remains visible.
Failure retains private state/logs and any allocated profile/browser for explicit exact-owner recovery.
Private guard diagnosis can still report an incomplete process inventory; unknown entries are never treated as absence.
Existing guard stop/cleanup and the runtime owner's explicit exact-browser retirement remain separate operations with their own current ownership checks.

## Validation scope

The owner tests exercise CLI admission, exact fixed spawn arguments/options, private preparation sequencing, genuine caller metadata, categorical readiness refusal, bounded timeout, early process exit, interruption retention and the synthetic HTTP boundary.
Test adapters are injected only through imported functions and cannot be selected by production CLI or environment flags.
They establish source/mock behavior rather than live browser isolation or native permissions.
Successful browser acceptance remains pending until guard readiness and native host evidence both pass.


## Fresh live admission result

On 2026-10-14 the reviewed helper ran in a fresh task-owned, unfocused ordinary Herdr shell at the physical ticket checkout root.
Its first invocation refused inherited browser overrides before allocating resources.
A reviewed retry cleared those overrides only for that invocation.

The public guard verified the newly launched process and private profile ownership but refused target scope.
It reported one permitted page, one foreign target and three unsupported target types, with zero permitted workers, internal pages, internal non-page targets or malformed targets.
The categorical report did not reveal the rejected target URLs or types; their identity and safety remain unknown.
An incomplete process inventory does not establish resource absence or authorize cleanup.

The helper stopped admission and closed only its synthetic HTTP listener, retaining the browser, profile and private diagnostic state.
No bridge, synthetic-page navigation, native Chrome Computer Use, Pi visual request, guard exception or browser/profile cleanup followed the refusal.
The prior focus and every preexisting workspace were preserved.
This is live refusal-path evidence for the helper, not successful browser QA or native permission evidence.
Ticket #41's browser criterion remains incomplete, independently of the verified native TextEdit observation and parent delivery.
