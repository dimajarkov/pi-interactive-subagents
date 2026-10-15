# Repository-owned synthetic Chrome proof runtime

`scripts/qa/chrome-owner.mjs` is repository-only prerequisite tooling for the isolated Chrome portion of dotfiles ticket #41.
It is not a Pi extension or global command and changes no active Nix/Pi configuration.
Current `browser-routing` policy is authoritative.
The public `~/.local/bin/chrome-devtools-axi` now forwards to the existing npm-owned upstream CLI.
The removed dotfiles guard's preparation, attachment and receipt APIs are not part of this runtime.

## Launch contract

Use an ordinary task-owned foreground Herdr shell at this checkout's physical Git root, with the named session and workspace explicit in placement.
Use a fresh bounded task name for each proof.

```sh
env -u NODE_OPTIONS -u NODE_PATH node scripts/qa/chrome-owner.mjs --task pi41-browser-upstream1
```

The helper accepts only `--task`, refusing arbitrary URLs, executables, existing profiles and inherited browser/backend overrides.
It requires macOS, the Nix-owned `~/Applications/Google Chrome for Testing.app`, the existing public CLI and npm-owned Chrome DevTools MCP installation, `/bin/ps`, `/usr/sbin/lsof` and `/opt/homebrew/bin/herdr`.
Missing prerequisites fail without substitution or installation.
Initial preflight verifies physical Git root, the testing app's Nix store integrity and distinct bundle identity and the current ordinary Herdr foreground placement.
This placement check is not a replacement for the removed browser guard or an upstream caller-binding mechanism.

The helper creates a new private task directory and empty disposable profile, plus a fresh synthetic HTTP fixture bound only to `127.0.0.1`.
The fixed fixture has a unique visible title/token, fabricated account label, counter and draft input, with no external assets or provider operations.
It serves only its fixed document with a restrictive content policy.
The owner verifies its HTTP 200 response before launching Chrome and again after initial public page discovery.
The fixture and profile are not browser-network confinement.

Chrome is a referenced child of the foreground repository owner, using the fixed stable executable, fresh profile, loopback CDP, disabled sync/extensions, mock keychain, basic password store and no-first-run/default-browser flags.
Its initial target is the exact origin allocated by this owner.
A separate signal process group prevents owner Ctrl+C from signaling Chrome.
The helper always selects exactly `--disable-features=PreloadTopChromeWebUI` as its declared QA configuration, with no feature-selection or caller-supplied flag interface.
This suppresses background TopChrome WebUI preloading and differs from default Chrome startup; it does not guarantee absence of browser UI or establish broader compatibility.

## Upstream attachment and readiness

The helper generates a fresh unpredictable named upstream session and a separate bridge port.
It refuses existing session state and an occupied bridge port before invoking upstream.
This matters because upstream's `ensureBridge` may reuse healthy saved state or terminate an unhealthy saved PID.
The default upstream session is never used.

Before attachment, bounded OS probes verify the self-launched Chrome PID, parent, UID, original start identity, exact launch command and exclusive IPv4 loopback CDP listener.
The private profile's inode, type, ownership and permissions must remain unchanged.
Missing, malformed, stale, foreign or ambiguous evidence fails closed.
These are checks of this runtime's own resources, not a generic browser-target allowlist or an OS security sandbox.

The owner asynchronously invokes only the public CLI's read-only `pages` command with a source-constructed environment:

- `CHROME_DEVTOOLS_AXI_SESSION` selects the newly allocated named session.
- `CHROME_DEVTOOLS_AXI_PORT` selects its reserved bridge port.
- `CHROME_DEVTOOLS_AXI_BROWSER_URL` selects the verified exact `http://127.0.0.1:<CDP port>` endpoint.
- `CHROME_DEVTOOLS_AXI_MCP_PATH` selects the existing declared npm MCP entry point without fallback installation.

Personal auto-connect, inherited profile selection, shared MCP URLs and arbitrary backend overrides are not forwarded.
CLI execution remains asynchronous so the same-process synthetic HTTP server can answer Chrome while the upstream bridge starts and lists pages.
Upstream launches its own detached bridge as its supported implementation.
The repository owner keeps Chrome and the fixture foreground-owned; there is no custom foreground attach-bridge command.

Exit zero, bridge health and a named session alone are insufficient for readiness.
The page inventory must contain exactly the synthetic fixture page at its exact URL and a valid safe numeric page ID.
The `selected` field must be a valid boolean; either value is acceptable because CLI routing selection does not select a native window.
The owner does not invoke `selectpage`, snapshot, navigation or any CLI control command.
Readiness means that owned fixture metadata is available, not that a native window has been acquired or rendered evidence observed.
Chrome ownership is rechecked after the public command, and the new bridge's recorded PID, UID, start identity, command and exclusive loopback listener are checked.
While foreground, the owner monitors those original process/profile/listener identities and closes the fixture on loss.
It does not navigate or inspect unrelated pages or reconstruct the deleted browser UI target rejection policy.
Do not issue standalone CLI commands from copied state; further diagnostics require fresh owner verification and reviewed scope.
Initial public page output is retained in private 0600 diagnostic files before any parsing refusal can close the fixture.
The private state records those paths and the observed fixture HTTP statuses.
A failed page observation is not retrospectively explained by querying the browser after its fixture has closed.
OS process probes use the fixed C locale for consistent start-identity text.
The unsigned private state file is convenience evidence, not a durable approval lease.

## Native proof

Readiness prints the private state path, which contains the exact synthetic page routing context.
Keep the owner foreground for the bounded proof.
The active root Codex host must independently acquire the actual matching Chrome window using its own normal Computer Use API.
Match live process/profile evidence and the actual fixture URL/title/rendered state before interaction.
App selection or title alone does not prove ownership.
If the native API cannot uniquely acquire that window, stop and record the routing gap.

Use a fresh Pi visual-tester session and owner-private queue bound to its session header, canonical checkout, role, exact fixture, task, root thread, nonce and expiry.
Only the active root host opens the lease and services its normal native tool.
Return actual observed findings and screenshot to that child, then verify completion and independent parent delivery.
CLI output, fixture source and token reads are not rendered evidence.
Chrome observations do not establish Zen, terminal UI or unattended native acceptance.

## Retention and validation

There is no stop/cleanup subcommand, automatic browser signal, profile removal, kill-all or worktree pruning.
Interruption closes only the helper's synthetic listener and reports Chrome/profile retained.
Failure retains private state/logs, the profile and any launched browser/bridge.
The separate Chrome signal group prevents owner interruption from signaling Chrome.
Closing the fixture ends this proof even if a rendered page remains visible.
Retiring exact resources requires separate current ownership verification and scope.

Tests exercise admission, fresh-session sequencing, fixed launch/environment, sole exact fixture discovery with valid CLI selection booleans, ownership failure, profile changes, interruption retention and the synthetic HTTP boundary.
A real newly spawned Node process and IPv4 listener exercise macOS process/socket parsing without launching a browser.
An actual child HTTP request to the owner fixture while a CLI command is pending reproduces synchronous starvation and verifies the asynchronous command boundary.
Test adapters are import-only and cannot be selected by production CLI or environment.
Source/mock and Node process/socket evidence do not establish successful Chrome isolation or native permissions.
Browser acceptance still requires a fresh actual Chrome run and root Computer Use evidence.

## Historical guard refusal

On 2026-10-14 the previous helper launched a fresh Chrome/profile, and the then-active public guard verified ownership but refused target scope.
The original report counted one permitted page, one foreign target and three unsupported targets.
The owner closed only its fixture and retained exact browser/profile/state resources, preserving prior focus and workspaces.
No successful Chrome navigation, native Chrome proof or Pi browser visual request followed that refusal.
That refusal remains historical evidence for its original configuration.
The user subsequently removed the custom guard in dotfiles commit `abed985`; its deleted APIs and target-category policy are not current prerequisites.
Do not reuse the historical profile, receipt, PID, bridge or closed fixture as fresh proof.
Ticket #41's browser criterion remains incomplete until the new upstream route and native child/parent delivery are actually exercised.

## Historical async run and native acquisition boundary

The subsequent async owner run observed HTTP 200 before and after page discovery, with one page at the exact owned fixture URL and `selected:false`.
This confirmed the fixture remained responsive through upstream CLI startup.
The old helper then invoked `selectpage`, which also takes a DOM snapshot internally, and that command failed before readiness.
A session selection file existed afterwards, but this does not establish which part of that command failed or any native evidence.
The owner closed only its fixture and retained its resources; no root Computer Use proof followed.
The current helper omits that unnecessary CLI control step because this proof uses root-native window acquisition instead of later page-scoped CDP operations.
The root must still freshly verify the actual owned window, URL, title and pixels before interaction.
The retained failed run is historical evidence and cannot be reused as a fresh proof.

## Native app selection

The owner launches Chrome for Testing with bundle ID `com.google.chrome.for.testing`, distinct from regular Chrome's `com.google.Chrome`.
Root selects the exact testing app path through Computer Use and verifies this run's synthetic URL and token before input.
Bundle-ID-only selection is insufficient when cached testing builds share that identifier.
Keep one native Computer Use proof active against the testing app at a time.
The dotfiles Nix package pins Google's official archive by version and SHA256; the owner verifies the resulting Nix store path.
This official testing archive is ad-hoc signed, so it is not checked against regular Chrome's vendor signing certificate.
Browser evidence establishes the observed Chrome for Testing configuration.
