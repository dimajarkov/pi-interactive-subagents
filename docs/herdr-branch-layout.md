# Herdr branch placement

Herdr keeps the master on the left and each direct child in its own column on the right.
Every descendant remains in its top-level branch column, stacked beneath its parent in contiguous depth-first accepted launch order.
Later root children add full-height columns, and completion order does not determine sibling order.

```text
master | A   | B
       | A1  | B1
       | A1a | B2
       | A2  |
```

## Required server support

The extension requires the separately named `terminal.job.branch_capabilities` and `terminal.job.launch_branch` managed methods.
An older server refuses before allocation; the extension does not fall back to legacy splits.
The capability response and successful managed-job receipt retain their existing version 1 shapes.
Other multiplexer backends retain their existing placement behavior.

Placement uses the verified calling terminal and original master identity rather than the focused pane.
The server checks current pane, terminal, launch and managed job identities and owns the accepted ordering and layout transaction.
A changed, released, moved, replaced or foreign layout refuses reflow instead of annexing panes.
A descendant cannot declare itself a new master to annex another branch.

## Capacity and failure behavior

Every affected terminal, including the master, must retain at least **40 usable columns and 12 usable rows** after Herdr's normal chrome and gutter calculations.
The complete proposed layout is checked before a child process is created.
Insufficient capacity and zoom produce explicit refusal without allocating another tab, overflowing nested panes sideways or silently toggling zoom.
Unrelated panes and keyboard focus remain unchanged.

A pre-dispatch connection failure has no child allocation.
An uncertain launch after dispatch retains ownership and exposes a recovery receipt when it can be written.
Do not blindly retry a mutation or close a guessed pane.
The server's exact managed-job receipt remains the authority for later child operations.

## Verification boundary

The public integration fixture supports `PI_HERDR_BUNDLED_PROOF=layout` for bundled autonomous roles.
It checks two branches, a deeper generation, a later root child, reversed completion order, remaining geometry, immediate-parent delivery and preserved unrelated identities.
Server and socket tests cover capacity, stale identity, zoom, unsupported-server refusal and transport ambiguity.
API geometry and terminal transcript evidence do not establish rendered native readability or physical keyboard behavior.
