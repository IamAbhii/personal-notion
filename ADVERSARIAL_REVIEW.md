# Adversarial review

Findings from adversarial sessions against the running app. Written by the adversary; Disposition is
filled in by the orchestrator.

## ADV-001: Two ops with the same opId in one batch return a 500 and the whole batch is lost

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did: with the app running on http://localhost:8787, posted one sync request whose `ops` array
contained the same op object twice (identical `opId`), to
`POST /api/workspaces/907b58e9-f24a-4f9f-9a68-ba3e43705288/sync`:

```
{"ops":[ {opId:"X", entity:"page", entityId:"<uuid>", type:"page.create",
          payload:{parentId:null,title:"Dup",icon:"🔂",sortKey:"b1"}, baseVersion:0, clientSeq:1, createdAt:...},
         <the same object again> ]}
```

Expected: the second occurrence is treated the way a cross-request replay is treated - the first is
`applied`, the second comes back `replayed` - or, failing that, a 400 with the JSON error envelope.
A cross-request replay of the same opId is handled correctly (`status: "replayed"`), so within-batch
duplication is the same idempotency contract.

Actual: HTTP 500 with the plain-text body `Internal Server Error` (not the JSON error envelope every
other failure uses). The worker log shows
`D1_ERROR: UNIQUE constraint failed: applied_ops.op_id: SQLITE_CONSTRAINT_PRIMARYKEY`. Neither op is
applied - the page named "Dup" does not exist in the snapshot afterwards - so a client that batches
an accidentally duplicated op loses every other op in that batch too, and gets no per-op result to
tell it which.

Disposition: ACCEPTED -> DEF-004

## ADV-002: A sortKey the server accepts but fractional-indexing rejects permanently breaks page creation, in the API and in the UI

- Session: phase-1 gate
- Suggested severity: HIGH

What I did: `sortKey` in a `page.create` payload is stored verbatim with no validation that it is a
valid fractional index. From app launch:

1. Create a parent: `page.create` with payload `{parentId:null,title:"SortLab",icon:"🧪",sortKey:"a9"}`.
2. Create two children with no `sortKey` in the payload (the server derives one): both return 200 and
   get `a0`, `a1`.
3. Create a third child with `sortKey: "zz"` - a string that is not a valid fractional index. It
   returns 200, `status: "applied"`, and is stored.
4. Create a fourth child with no `sortKey`.

Then the same thing through the UI: post a `page.create` with `sortKey: "z7"` and `parentId: null`
(so the poisoned key sits among the top-level siblings), reload http://localhost:8787 and click the
sidebar's "Add a top-level page" (+) button.

Expected: step 3 is rejected with a validation error, because an unparseable sort key is not a
position; and in no case does one stored row stop new pages being created.

Actual: step 4 returns HTTP 500 `Internal Server Error` (plain text). The worker log shows
`Error: invalid order key: zz` thrown out of `nextSiblingKey` (packages/worker/src/sync/apply.ts:242)
via `generateKeyBetween`. In the UI the click on "Add a top-level page" does nothing at all: no page
is created, the sidebar row count is unchanged, no error is shown to the user, and the console
records an uncaught `invalid order key: z7` - the frontend computes the key with the same library
(`sortKeyForNewChild` in packages/frontend/src/lib/pageTree.ts) and throws on the poisoned sibling.
The effect is permanent and data-resident: until the offending row is deleted, no page can be created
under that parent by any means. Screenshot shows the UI after the click - the tree is unchanged and
there is no feedback.

Screenshot: screenshots/adv-001-create-after-poison.png

Disposition: ACCEPTED -> DEF-003

## ADV-003: No maximum length on title or icon; an oversized title returns a plain-text 500

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did: `page.create` with a title of 100,000 characters, and separately with a title of 8,000,000
characters; also `page.create` with an `icon` of 5,000 emoji characters.

Expected: a length limit, rejected with the JSON `invalid_request` envelope. An icon is one emoji.

Actual: the 100,000-character title and the 5,000-character icon are accepted (200, applied) and come
back in the snapshot intact. The 8,000,000-character title returns HTTP 500 with the plain-text body
`Internal Server Error`; the worker log shows `D1_ERROR: string or blob too big: SQLITE_TOOBIG`. The
multi-thousand-character icon renders in the sidebar as a vertical column of emoji that runs the full
height of the tree and obscures the rows behind it (visible on the left of the screenshot below,
where the 🔥 stripe is the icon of one page). Two consequences: unbounded strings reach D1 directly,
and an internal exception is reported as a bare 500 rather than through the error envelope the rest of
the API uses.

Screenshot: screenshots/adv-001-create-after-poison.png

Disposition: ACCEPTED -> DEF-005

## ADV-004: A long page title is neither wrapped nor truncated in the page header or the breadcrumb

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did: from app launch, clicked "Add a top-level page", clicked the new "Untitled" row, clicked
its rename (pencil) action, typed 500 `X` characters and pressed Enter. Viewport 1280x800.

Expected: the title wraps onto several lines, or is truncated with an ellipsis, the way the sidebar
row does it.

Actual: the `h1.page__title` renders as one unbroken line 14,230px wide inside a main column whose
client width is 860px, and the breadcrumb bar at the top of the page does the same. Everything past
roughly the first 60 characters is unreachable - the document itself does not scroll horizontally
(`documentElement.scrollWidth` stays 1280) - so most of the title simply cannot be read, and the
header area is visually broken. The sidebar row truncates correctly, so only the page area is
affected. The title round-trips to the server and back intact.

Screenshot: screenshots/adv-002-long-title-overflow.png

Disposition: ACCEPTED -> DEF-008

## ADV-005: Beyond about twelve levels of nesting, sidebar rows lose their title entirely and the breadcrumb is clipped out of the viewport

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did: created a chain of 26 nested pages by API (`DeepRoot` then `Level 1` .. `Level 25`, each
the child of the previous), then opened `Level 25` in the browser at 1280x800 and looked at the
sidebar and the top bar.

Expected: nesting is specified to any depth, so deep rows should stay legible - indentation capped,
or the row scrollable/truncated - and the breadcrumb should collapse rather than grow without bound.

Actual: indentation is 16px per level with no cap, and the sidebar tree is 271px wide. Measured title
widths by depth: `Level 10` 43px, `Level 11` 27px, `Level 12` 11px, `Level 13` and everything deeper
**0px**. The currently selected deep row therefore renders as an empty highlighted bar with no text
and no icon visible at all - there is nothing on screen to say which page you are on. The breadcrumb
for the same page wraps to three lines and overflows the top bar upward, so its first lines are
clipped off the top of the viewport.

Screenshot: screenshots/adv-008-deep-nesting.png

Disposition: ACCEPTED -> DEF-009

## ADV-006: A rejected op surfaces as an uncaught console error and leaves stale data on screen with no feedback

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did: opened http://localhost:8787, clicked a leaf page's row, clicked its rename action and
typed a new title into the inline input. While that input was still open, deleted the same page from
outside the tab (a `page.delete` op posted to the sync endpoint with the page's current version).
Then pressed Enter in the rename input.

Expected: the client notices the op was rejected - the response says
`status: "rejected", reason: "page no longer exists"` - and tells the user something, for example
dropping the row and moving off the dead page.

Actual: the browser console records an uncaught page error whose message is `page no longer exists`.
Nothing changes on screen: the sidebar row is still there, the page header still shows the old title,
and there is no message of any kind. Only a manual reload clears it, after which the row is gone. So
a rejected op is both invisible to the user and an unhandled exception.

Disposition: ACCEPTED -> DEF-006

## ADV-007: Rapid clicks on "Add a top-level page" mint duplicate sortKeys for siblings

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did: from app launch, clicked the sidebar's "Add a top-level page" (+) button ten times in
immediate succession without waiting, then read
`GET /api/workspaces/907b58e9-f24a-4f9f-9a68-ba3e43705288/snapshot`.

Expected: ten new pages, each with a distinct sortKey, since a fractional index is meant to give a
total order over siblings.

Actual: ten pages were created (sidebar rows 30 -> 40, no console errors), but two of them share the
sortKey `aA`: the top-level keys read `a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,aA,aA,aB,...`. The new key is
computed from the client's current page list, so two clicks that land before the first result is
applied compute the same key. The order of the two colliding rows is then decided by whatever order
the snapshot query happens to return, and a later insert cannot be placed between them - which
matters for the drag-to-reorder work the sidebar comment says is coming.

Disposition: ACCEPTED -> DEF-007

## ADV-008: Creating a page while offline looks like a dead button, and the queued op is lost if the tab reloads

- Session: phase-1 gate
- Suggested severity: LOW

What I did: loaded the app, put the browser context offline, clicked "Add a top-level page", waited.
Then, in a second run, did the same and reloaded the tab while still offline before going back online.

Expected: given the sync-queue design, either an optimistic row appears immediately with some pending
indication, or the click is refused with a message. Either way the click should not look like nothing
happened.

Actual: while offline the click produces no row, no toast, no pending marker and no console error -
the button appears dead. The op is held in memory only: going back online (without reloading) flushes
it and the row appears several seconds later. But reloading while offline loses the op permanently -
after going back online the page count is unchanged, and nothing tells the user their page was
dropped. Separately, a reload while offline shows a card reading "Something went wrong / Failed to
fetch", which is the raw fetch error text rather than an offline message.

Screenshot: screenshots/adv-offline-reload.png

Disposition: REJECTED - out of phase scope, with one part folded into DEF-006. The durable IndexedDB
queue is deliberately Phase 6 work (docs/architecture/offline-sync.md: Phases 1-5 build the op and
post it immediately; Phase 6 adds the queue, the flush loop and the status indicator). Losing an
in-memory op on reload while offline is therefore the designed behaviour today, not a defect, and
fixing it now would mean building Phase 6 early. The parts that are real today - a click that gives
no feedback, and a raw "Failed to fetch" shown to the user - are the same missing-feedback path as
ADV-006 and are covered by DEF-006. Re-test this finding at the Phase 6 gate, when the queue exists;
that is the point at which an op lost on reload becomes a genuine defect.

## ADV-010: A page with ten or more levels nested under it cannot be deleted at all - the cascade returns 500

- Session: phase-1 gate
- Suggested severity: HIGH

What I did: built chains of nested pages by API and deleted the top of each chain. Each chain is
`ChainN` at the top level, then a single child per level below it:

1. `page.create` `{parentId:null,title:"Chain",icon:"🔗",sortKey:"a5"}`, then N further
   `page.create` ops, each with `parentId` set to the previous page's id and `sortKey:"a0"`.
2. `page.delete` on the top page with its current `baseVersion`.

Repeated for N = 5, 8, 9, 10, 15, and for a 25-level chain.

Expected: the delete cascades to every descendant, as it does for shallow trees and as criterion 2
requires ("deleting a page with nested pages removes them too"). Requirements say pages nest to any
depth.

Actual: N = 5, 8 and 9 return 200 and cascade correctly. **N = 10, N = 15 and N = 25 return HTTP 500
with the plain-text body `Internal Server Error`, and nothing is deleted** - the whole subtree stays.
The worker log gives the cause:
`D1_ERROR: too many levels of trigger recursion: SQLITE_ERROR`, thrown from the D1 batch, so the
cascade is implemented by a recursive SQLite trigger and D1's trigger-recursion limit caps it at nine
levels of descendants. It is not transient: retrying the same delete fails again every time. The only
way I could remove the subtree was to delete all 26 pages one at a time from the leaf upward. Ten
levels of nesting is well within what the product invites, and there is no error path for it: the API
returns an unhandled 500 rather than the JSON error envelope.

I exercised this through the API only, so how the sidebar's confirmation dialog reports the failure is
not covered here - but ADV-006 shows that a failed op is not surfaced to the user, so the likely UI
behaviour is a confirmation that appears to do nothing.

Disposition: ACCEPTED -> DEF-002. The most serious finding of the pass. It breaks a Phase 1 success
criterion outright ("deleting a page with nested pages removes them too") and contradicts
REQUIREMENTS.md's "pages nest inside pages to any depth", so a nine-level ceiling is not a limit the
product is allowed to have. The cause is structural rather than a slip, and more subtle than it first
looked: there was no hand-written trigger. Migration 0001 declared
`parent_id TEXT REFERENCES pages (id) ON DELETE CASCADE`, and SQLite implements that action as an
internal trigger — so the depth ceiling was inherited from a one-line schema declaration, where D1
enforces it and no amount of retrying helps. The fix is to compute the subtree in the repository layer and delete it as one
statement, which is what the applier already does for every other decision - it reads the page skeleton
once and decides in memory precisely to stay inside D1's query budget.

## ADV-009: Renaming a page to blank or to spaces silently discards the edit

- Session: phase-1 gate
- Suggested severity: LOW

What I did: opened a page's inline rename input in the sidebar, cleared it completely and pressed
Enter; then repeated with three spaces.

Expected: either the empty name is refused visibly, or the page falls back to "Untitled".

Actual: the input closes and the old title stays, in both the sidebar and the header, with no
indication that the edit was thrown away. It is the right end state but it reads as the app ignoring
you - and it is the same gesture that works for every other string, so nothing distinguishes the
"nothing happened" case from a lost write.

Disposition: ACCEPTED -> DEF-010
