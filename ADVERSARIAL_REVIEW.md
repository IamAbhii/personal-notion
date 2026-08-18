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

## ADV-011: The first character typed after Enter lands in the block you just left

- Session: phase-2 gate
- Suggested severity: HIGH

What I did: typed continuously with Enter between lines, at ordinary human speed (100 ms between
keystrokes - about 120 characters a minute), on an empty page:

1. Launch the app at http://localhost:8787 (fresh reset).
2. Click "Add a top-level page" in the sidebar, then click "This page is empty" to create the first
   block.
3. Type `First line typed at normal speed`, press Enter, type `Second line`, press Enter, type
   `Third line` - never pausing between the Enter and the next character.

Expected: three blocks reading `First line typed at normal speed`, `Second line`, `Third line`.

Actual: the text is cut and re-glued across the block boundary. The page reads
`First line typed at normal speedS` / `econd lineT` / `hird line`, and that is what is stored on the
server (confirmed in the snapshot, and after a reload). Every line loses its first character to the
line above.

The cause is visible from the browser: `Enter` posts a `block.create` and awaits the op **and** the
snapshot refetch before the new block exists to focus, so `document.activeElement` is still the old
textarea for a while after Enter. I measured that window on this machine at **62 ms** - so anything
faster than roughly 16 characters a second is mis-routed, and at 100 ms per keystroke exactly one
character per line goes to the wrong block, deterministically, on every line. Against a real
deployment (a Cloudflare round trip rather than localhost) the window is larger and several
characters per line would be lost.

At 5 ms per keystroke - a paste-like burst or a fast repeat - it degrades much further: typing
`one two three four five six seven eight` with Enter between the words produced blocks reading
`onetwothre`, `e`, `efourfiv`, `seven`, `(empty)`, `(empty)`, `six`, `eight`, `(empty)`.

This directly undermines Phase 2 criterion 3 ("type into a block, refresh, and the content is
unchanged"): the content is not what was typed, and it is the saved copy that is wrong, not just the
screen.

Screenshot: screenshots/adv-011.png

Disposition: ACCEPTED -> DEF-011. The most serious finding of the pass and the one that blocks the phase gate.
The screenshot is post-reload, so this is stored text, not a rendering artefact: the character after
Enter is committed to the wrong block. Enter is the most-used gesture in the editor, so this corrupts
data in ordinary use and breaks Phase 2 criterion 3. Note that 24 end-to-end and 189 unit tests all
pass over it, because synthetic typing is faster than a human and never hits the race.

## ADV-012: Text typed while the slash menu is open is never saved, but stays on screen until a reload throws it away

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did:

1. Launch the app, click "Add a top-level page", click "This page is empty".
2. In the new empty block type `/my important note` - the slash menu opens on the `/` and stays open
   because the text still begins with a slash. It shows "No block type matches that."
3. Click anywhere outside the block (I clicked the page header) so the textarea blurs.
4. Read the block on screen, then reload the page.

Expected: either the typed text is kept (it is ordinary text - the user clearly abandoned the
command) or it visibly disappears the moment the menu closes. Not both.

Actual: after the blur the block still shows `/my important note` on screen, but the server has `""`
for that block - the snapshot confirms it. Nothing on screen says the text is unsaved, and there is
no save indicator anywhere. After a reload the block is empty and the sentence is gone.

The mechanism is that a keystroke while the menu is open goes through the non-dirtying `reset` path
rather than `edit`, so the blur handler's `flush()` has nothing marked dirty to write. Pressing
Escape instead of clicking away does save the text, so the two ways of dismissing the menu disagree.

Screenshot: screenshots/adv-012.png (the text on screen; the server holds an empty string at that
moment)

Disposition: ACCEPTED -> DEF-012. Data loss, and the worst kind: the text stays on screen, so the user has every
reason to believe it was saved until a reload discards it.

## ADV-013: Keystrokes inside the 500 ms autosave window are lost on a reload, with no flush on unload

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did:

1. Launch the app on Home.
2. Click into the first block, press End, type `LOSTTEXT`.
3. Press reload (Cmd+R) immediately - within the 500 ms debounce, before typing settles.

Expected: the pending edit is written before the page goes away, as it is on blur and on unmount.
There is no save button anywhere in the product, so the debounce window is the only thing standing
between the user and a lost sentence.

Actual: after the reload the block reads `Start here` - `LOSTTEXT` is gone, from the screen and from
the server. Typing the same text and waiting ~900 ms before reloading persists it, which confirms the
window rather than anything else is the cause. Navigating away in the app (clicking another page in
the sidebar) inside the same window **does** save, so it is specifically unload that has no flush:
there is no `beforeunload`/`pagehide` handler, so a reload, a tab close or a navigation away from the
app drops whatever has not settled.

Reported even though the window is short, because a lost half-sentence on reload is invisible to the
user and Phase 2 criterion 3 is about exactly this gesture.

Disposition: ACCEPTED -> DEF-013. The debounce is a deliberate design choice and stays; what is missing is a
flush at the unload boundary. Fixed by flushing on pagehide and on visibilitychange, not by
shortening the debounce, which would narrow the window rather than close it.

## ADV-014: Pasting more than 10000 characters silently discards the excess with no feedback

- Session: phase-2 gate
- Suggested severity: LOW

What I did:

1. Launch the app, click "Add a top-level page", click "This page is empty".
2. Paste a 63000-character wall of text (`"The quick brown fox jumps over the lazy dog. "` repeated
   1400 times) into the block.

Expected: some indication that the block cannot hold that much - a notice, or a refusal - since the
limit is a product decision the user cannot see.

Actual: the block silently ends up with exactly the first 10000 characters, mid-sentence, and the
server stores that. No notice appears, nothing is logged, and there is no visual cue that 53000
characters were dropped. The block is not split into several blocks either. A user pasting a long
document from elsewhere would not know they had lost most of it until they read to the end.

Screenshot: screenshots/adv-014.png

Disposition: ACCEPTED -> DEF-014. Same code path as DEF-015 and fixed in the same change: clamping is defensible,
clamping silently is not.

## ADV-015: A paste whose 10000-character cut falls inside an emoji corrupts the text and stores 10002 characters, over the server's own limit

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did:

1. Launch the app, click "Add a top-level page", click "This page is empty".
2. Paste a string of 9999 ordinary characters followed by one emoji (U+1F600) and some trailing text.
   Any paste whose character 10000 lands in the middle of a surrogate pair reproduces it.
3. Read the end of the block, then reload and read it again.

Expected: either the emoji survives whole or the text is cut cleanly before it, and the stored text
is at most the documented 10000 characters.

Actual: the client's `slice(0, 10000)` cuts the emoji in half. The op is posted with a 10000-character
text whose last unit is a lone high surrogate (I confirmed this on the wire: the request body carries
`... 78 78 78 d83d`), the server accepts it, and what comes back and is stored is **10002 characters
ending in three U+FFFD replacement characters** - visible mojibake in the block, surviving a reload.
Two consequences: text the user pasted is corrupted rather than truncated, and the stored value is two
characters longer than the maximum the server documents and enforces (10000), so the cap is escapable
through the ordinary paste path.

Screenshot: screenshots/adv-015.png (the end of the block after a reload - the three replacement
characters)

Disposition: ACCEPTED -> DEF-015. Accepted over its mild-looking symptom because it stores 10002 characters, past
the server's own cap - the clamp is not merely ugly, it is wrong. It must count code points so a
surrogate pair is never cut in half, while still satisfying the server's UTF-16 length check.

## ADV-016: Concurrent block.create ops with no sortKey mint duplicate sort keys

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did: through the API only, since the sync endpoint is a public surface and the browser is not
its only client.

1. `POST /api/workspaces/<ws>/sync` with `page.create` for a fresh page.
2. Ten separate concurrent requests (ten threads), each one `block.create` for that page with
   `{pageId, type:"paragraph", text:"b<i>"}` and **no** `sortKey`, so the server computes the key with
   `nextBlockKey`.

Expected: ten distinct fractional keys, as ten sequential requests produce.

Actual: two distinct keys across ten blocks - `a0` once and `a1` **nine times**. Each concurrent
request read the same projected state and appended after the same last key. This is the block-path
twin of Phase 1's DEF-007 (rapid page creates minting duplicate sibling keys); the browser happens to
be protected because `useBlockMutations` reserves keys client-side, so this is reachable through the
API, a second device, or any retry that overlaps.

To be fair to the editor: I checked what the UI does when a page already holds duplicate keys (three
blocks all `a1`, created deliberately by API) and it copes - the order is stable across reloads and a
drag re-keys the moved row correctly. So the damage is confined to the ordering being arbitrary until
someone drags, not to a broken page.

Disposition: ACCEPTED -> DEF-016. The block-path twin of DEF-007, and this time on the server, where the client's
in-flight reservation cannot help: concurrent requests each compute an append key from the same
snapshot of state. Not to be fixed by serialising writes. Make duplicate keys harmless with a
deterministic (sort_key, id) tiebreak, so the order is total even when two keys collide.

## ADV-017: A block being dragged is translucent with no background, so its text collides with the text it passes over

- Session: phase-2 gate
- Suggested severity: LOW

What I did:

1. Launch the app on Home.
2. Press the drag handle of the first block ("Start here", a heading) and move the pointer down over
   the bullet list without releasing.

Expected: the block being moved reads as a distinct object lifted off the page - an opaque row, a
shadow, or a drag overlay - so both it and the row underneath stay readable.

Actual: the dragged block is drawn at 65% opacity with no background (`.block--dragging` sets only
`z-index` and `opacity`), directly on top of the row it is passing, so "Start here" and "Journal for
the weekly review and the yearly intentions" overlap into unreadable text. The reorder itself works;
this is only how it looks mid-drag, and it looks broken rather than deliberate.

Screenshot: screenshots/adv-017.png

Disposition: ACCEPTED -> DEF-017. A small CSS fix on a gesture that is a headline feature of this phase.

## ADV-018: With a slash query that matches nothing, Enter is swallowed indefinitely

- Session: phase-2 gate
- Suggested severity: LOW

What I did:

1. Launch the app, click "Add a top-level page", click "This page is empty".
2. In the empty block type `/nomatch`. The menu stays open and says "No block type matches that."
3. Press Enter. Press Enter again.

Expected: Enter does something - inserts the paragraph below as it does everywhere else, or closes
the menu and treats the text as content.

Actual: nothing happens, on either press. The block count stays at 1, the text stays `/nomatch`, and
the menu stays open. The only ways out are Escape, clicking away, or deleting characters until the
query matches something. Pressing the app's most-used key twice with no effect and no explanation is
a dead control, even though the menu does tell you there is no match.

Screenshot: screenshots/adv-018.png

Disposition: ACCEPTED -> DEF-018. Enter with no highlighted option should close the menu and leave the text
alone, not be swallowed.

## ADV-019: Drag-and-drop screen-reader announcements read raw block UUIDs

- Session: phase-2 gate
- Suggested severity: LOW

What I did: focused a block's drag handle by keyboard and pressed Space to pick the block up, then
read the live region.

Expected: an announcement naming the block in human terms, as the handle's own accessible name does
("Move the heading 2 block").

Actual: the live region announces
`Draggable item f2660a3d-12f3-4948-b69c-a7f898d6f5ba was moved over droppable area f2660a3d-12f3-4948-b69c-a7f898d6f5ba.`

- dnd-kit's default announcements, unconfigured, reading two identical UUIDs. The keyboard reorder
  itself works correctly (Space, ArrowDown, ArrowDown, Space moved the block two positions and the
  order matched on the server), so this is only what a screen reader hears while doing it.

Disposition: ACCEPTED -> DEF-019. Announce the block's own text and type, which the component already has to
hand.

## ADV-020: Reaching the page body by keyboard takes 118 Tab stops through the sidebar

- Session: phase-2 gate
- Suggested severity: LOW

What I did: loaded the app with the seeded workspace and pressed Tab repeatedly from the top of the
document, counting stops until focus first landed on any control inside the page body.

Expected: a keyboard user can reach the editor in a few stops - a skip link, or the body early in the
tab order.

Actual: **118** Tab presses. Every sidebar row contributes five stops (collapse, the page link,
rename, add-inside, delete), the seed has 25 pages, and there is no skip link and no landmark
shortcut. Within the editor the order is then sensible (handle, delete, textarea per block) and the
focus ring is clearly visible, so this is about getting in, not about moving around once you are
there. It is arguably a Phase 1 shell issue, but Phase 2 is what put the thing worth reaching at the
far end of it.

Disposition: ACCEPTED -> DEF-020. Fixed with a skip link to the page body. Deliberately not by removing the
gutter controls from the tab order: the drag handle must stay focusable or the keyboard drag path -
the one the end-to-end suite depends on - stops working.

## ADV-021: A block containing many blank lines grows to 51000 pixels, and the page with it

- Session: phase-2 gate
- Suggested severity: LOW

What I did: created a page by API with a paragraph block whose text is 2000 newline characters (the
kind of thing a paste from a text file produces), plus a 400-line code block, then opened the page in
the browser.

Expected: not sure - but something that keeps the page navigable, for example a maximum height on the
textarea with its own scrollbar.

Actual: the auto-grow textarea renders that one block **51159 px** tall and the page body 60661 px,
so the two ordinary paragraphs on either side of it are a full screen-height of scrolling apart and
the window scrollbar becomes a hairline. Nothing errors and nothing is lost, and an auto-growing
textarea arguably has to do this, so I record it as surprising rather than clearly wrong: there is no
cap anywhere between one line and 2000.

Screenshot: screenshots/adv-021.png

Disposition: REJECTED - working as intended. The block genuinely contains 2000 blank lines, and rendering the
content a user actually typed is correct. Nothing in REQUIREMENTS.md caps a block's height, and
capping it would put a nested scroll region inside an editable block, which is a worse experience
than a long block. Recorded as surprising rather than broken, which is how it was filed.

## ADV-022: A long line in a code block is clipped with no scrollbar and no way to reach the tail

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did: created a page with a code block whose single line is about 700 characters
(`const x = "aaa…"; // bbb…`), opened it at 1280x800, clicked into the block, pressed End, and then
tried a horizontal wheel scroll over the block.

Expected: either the line wraps, or the code block scrolls horizontally so the rest of the line can
be read.

Actual: the code textarea computes `white-space: pre` with `overflow: hidden`, so `scrollWidth` is
6043px against a `clientWidth` of 672px. The line is cut dead at the right edge of the block with no
ellipsis and no scrollbar; `scrollLeft` stays at 0 after End and after `mouse.wheel(400, 0)`, so
about 90 percent of the line is unreachable by mouse and by keyboard. The text is not lost - a reload
still has it, and the other ten block types wrap correctly (`overflow-wrap: break-word`) - it is only
the code block, which is exactly the type most likely to hold a long line.

Screenshot: screenshots/adv-022.png

Disposition: ACCEPTED -> DEF-027. The code block is the one block type whose content is expected not
to wrap, so it is also the one where clipping loses access to real content rather than merely looking
untidy - and the remainder is unreachable by mouse and by keyboard alike. Every other block on the
page wraps, which makes this a gap in the migration rather than a deliberate choice.

## ADV-023: In light theme the sidebar row action menu is white-on-white - two of its three items are invisible

- Session: phase-2 gate
- Suggested severity: HIGH

What I did: at 320px wide (light theme, the default in `index.html`) opened the navigation drawer,
tapped the overflow trigger on a page row, and read the computed colours of the three menu items.

Expected: the menu's items are readable on the menu's surface in both themes.

Actual: `DropdownMenu` gives its content panel the themed `bg-surface` (white in light theme) but
`DropdownMenuItem` colours its text with the dark-panel token: `text-panel-text` is `#eae8ee`, which
against white is a contrast ratio of **1.22:1**. "Rename" and "Add a page inside" are effectively
invisible - I could only find them by reading the DOM. The danger variant, `text-danger-soft`
`#f08a84`, comes out at **2.42:1**, also under the 4.5:1 minimum. In dark theme the same items are
14.48:1 and 7.27:1, so the bug is light-theme only, and the dropdown is the only path to rename,
add-inside or delete a page below the `md` breakpoint - the three desktop icon buttons are
`md:hidden`'s counterpart and do not exist there. `DropdownMenu` is used in exactly one place today
(the sidebar row), so the blast radius is that one menu, but the token misuse is in the shared
primitive.

Screenshot: screenshots/adv-023.png

Disposition: ACCEPTED -> DEF-026. The most serious finding of the pass and the only one I would call
urgent. Light is the default theme, and below the md breakpoint this dropdown is the only route to
rename, add inside or delete a page - the controls are present, focusable and functional, and cannot
be seen. The cause is the general lesson of this pass: the menu borrows the dark sidebar's panel text
tokens and then renders on a white surface, so it looked correct for as long as anyone only checked
it against the drawer.

## ADV-024: At mobile widths the closed drawer stays in the tab order, and Enter on an invisible button creates a page

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did: at 320x800 with the drawer closed, pressed Tab repeatedly from a fresh load and logged
the focused element and its bounding box, then pressed Enter on the third stop.

Expected: a closed off-canvas drawer is out of the tab order, so tabbing goes from the skip link and
the hamburger straight into the page body.

Actual: Tab 1 is the skip link, Tab 2 is "Open navigation", and Tab 3 onwards walks the whole page
tree inside the drawer while the drawer is closed and translated off-canvas - "Add a top-level page"
at x=-69, "Collapse Home" at x=-250, "Home" at x=-174, and so on for all 25 seed pages. The focus
ring is drawn off screen, so the page looks unfocused and the user has no idea where they are. The
drawer wrapper also keeps `pointer-events-auto` while closed. Pressing Enter on the invisible "Add a
top-level page" button created a page and navigated to it, with the only visible feedback being the
title changing to "Untitled" - the drawer itself never opened. A keyboard user on a narrow window can
operate the whole sidebar blind.

Screenshot: screenshots/adv-024.png

Disposition: ACCEPTED -> DEF-028. A closed drawer is not part of the page, and keeping its contents
focusable means a keyboard user tabs into controls they cannot see and can create a page by pressing
Enter on nothing. The fix is to take the closed drawer out of the tab order rather than to hide it
visually alone.

## ADV-025: The emoji picker is wider than a 320px viewport and its right column cannot be reached

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did: at 320x800 opened a page and clicked the page icon to open the emoji picker, then
measured the picker and tried to scroll horizontally.

Expected: at the narrowest supported width the picker fits inside the viewport, or the page scrolls
so the rest of it can be reached.

Actual: the picker renders 340px wide from x=8 to x=348 in a 320px viewport, so its last 28px sit
outside the window. `document.documentElement.scrollWidth` is still 320 and there is no horizontal
scroll, so the clipped strip - the rightmost emoji column, the tail of the category nav row and the
picker's own scrollbar - is permanently unreachable. The same picker at 1280 sits fully inside the
viewport, so this is width-specific. Nothing errors; the picker is usable for the emojis that happen
to fall in the visible columns.

Screenshot: screenshots/adv-025.png

Disposition: ACCEPTED -> DEF-029. 320px is the width the project's own mobile-first standard names as
the floor, so a picker that is wider than the viewport with an unreachable column fails at a
supported size. The picker is a third-party component, so the fix is likely to be constraining its
width from the popover rather than changing its internals.

## ADV-026: At 320px, sidebar rows nested ten deep show one character of their title

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did: created a chain of 15 nested pages titled "Level N nesting depth test", then opened the
drawer at 320x800 and measured the width of each row's title element.

Expected: however deep the tree goes, a row keeps enough width to tell one page from another - the
indent should stop growing well before that.

Actual: the indent does stop growing (every row from level 10 down starts at x=182), but at 320px the
292px drawer minus that indent minus the 48px overflow trigger leaves the title **17px** wide: every
row from level 10 to level 15 renders as `L…` and the six pages are indistinguishable. At 1280 the
same rows get 89px, which is tight but legible. Nothing is broken functionally - the rows still
navigate - but the mobile drawer stops being usable as a way of finding a deeply nested page.

Screenshot: screenshots/adv-026.png

Disposition: ACCEPTED -> DEF-030. Nesting as deep as you like is an advertised feature of the page
tree, so a depth the product invites must stay legible at the width the product supports. A per-level
indent that is fixed in pixels cannot survive both; the indent needs a ceiling, or deep levels need a
different affordance than raw indentation.

## ADV-027: The block gutter's drag and delete controls are 22x24px and 2px apart on a touch-width viewport

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did: opened a 50-block page at 320x800 and measured the drag handle and the delete button in
the block gutter, at rest and with the block focused.

Expected: on a touch-width viewport the two controls are large enough to hit, and the destructive one
is not immediately adjacent to the one you use most.

Actual: both are 22x24px - well under the 48px touch minimum the rest of the UI honours (the sidebar
rows and the dropdown items are all `min-h-12`) - and the delete button's left edge is 24px from the
drag handle's, i.e. a 2px gap between two 22px targets, with delete on the right where a
right-handed thumb lands. On a real touch device there is also no hover, so the pair only appears
once the block is focused. Reordering a block on a phone therefore means hitting a 22px target 2px
from "delete block". No confirmation dialog stands behind block deletion, unlike page deletion.

Screenshot: screenshots/adv-027.png

Disposition: ACCEPTED -> DEF-031. Already known and flagged in PR-8 as a design decision rather than a
restyle detail; this pass supplies the part that settles it. 22x24px is under the 48px the project's
own standard requires, and the adversary's addition is that the delete control sits 2px from the drag
handle at the width where the pointer is a finger - an unconfirmed destructive action next to the
control a user reaches for most. That combination makes it a defect rather than a preference. The fix
needs the gutter column widened, which is a visible layout change, so it is a task of its own.

## ADV-028: StatusCard's accent eyebrow labels fail contrast on the light surface

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did: forced the workspace snapshot to take six seconds so the loading StatusCard stayed on
screen, in light theme, and measured the eyebrow label; then measured the "Not found" card's eyebrow
by visiting a page id that does not exist.

Expected: a 12px uppercase label meets 4.5:1 against the card it sits on, in both themes.

Actual: the three eyebrow intents all use accent hues tuned for the dark surface and are reused
unchanged on the white card: `accent` is `--amber #ecad0a` at **1.99:1** ("PERSONAL SPACE" on the
loading and error cards - it reads as a pale yellow smudge), `info` is `--blue #209dd7` at
**3.06:1** ("NOT FOUND"), and only `error` `--danger #cf3b34` clears the bar at 4.85:1. In dark
theme amber on the card surface is 8.84:1, so again this is light-theme only. The lead line beneath
each eyebrow is high contrast, so nothing is unreadable in the sense of unusable - the label above it
is.

Screenshot: screenshots/adv-028.png

Disposition: ACCEPTED -> DEF-032. Amber at 1.99:1 and blue at 3.06:1 on the light surface both fail
WCAG AA for the size they are used at. Same root cause as DEF-026: brand colours chosen against a
dark panel, reused on white. Worth fixing at the token level rather than per component, since
StatusCard is now the shared primitive and any later caller inherits the same problem.

## ADV-029: A keyboard block drag loses most ArrowDown presses at key auto-repeat speed

- Session: phase-2 gate
- Suggested severity: LOW

What I did: on the 50-block page, focused the first block's drag handle, pressed Space to pick it up,
then pressed ArrowDown 20 times at three cadences, reading the dnd-kit live region after each run.

Expected: 20 presses move the block 20 positions, whatever the cadence.

Actual: with an 80ms gap the block reaches position 21 (all 20 registered). With a 40ms gap - about
the auto-repeat rate of a held arrow key on macOS - it reaches position 16, so five presses are
dropped. With no gap it reaches position 4: 17 of 20 presses are lost. The announcements themselves
are correct and now name the block's text rather than its UUID, and a single deliberate press always
works, so this only bites the user who holds the key down to move a block a long way - they get a
much smaller move than they asked for and no sign that anything was dropped.

Disposition: ACCEPTED -> DEF-033. Kept at LOW: a single deliberate press always lands, so the drag is
not broken, and the loss is silent rather than destructive. Accepted rather than rejected because
holding an arrow key is the natural way to move a block a long way, and dropping 17 of 20 presses is a
real ceiling on the gesture. This is likely dnd-kit's own keyboard coordinate getter rather than our
code, so the fix may be a configuration change or an upstream constraint we document instead.

## ADV-030: At 320x400 the slash menu sits flush against the right and bottom edges

- Session: phase-2 gate
- Suggested severity: LOW

What I did: at 320x400 opened a 50-block page, created an empty block at the end and typed "/".

Expected: the menu keeps a small margin from the viewport edge, the way the Radix dropdown does with
its `collisionPadding: 8`.

Actual: the menu measures left 24, right 320, top 84, bottom 400 in a 320x400 viewport - its right
edge is exactly on the viewport's right edge and its bottom exactly on the bottom, so the rounded
corner and the drop shadow are clipped on two sides and the list has no visual end. The menu does
scroll internally (`max-height: 316px`, `overflow-y: auto`) and every item is reachable by arrow
keys, and at the bottom of a long page at 1280x800 it correctly flips above the caret, so this is
cosmetic rather than a trap. Recorded because the two popover families are inconsistent: one pads
against collisions and the other does not.

Screenshot: screenshots/adv-030.png

Disposition: ACCEPTED -> DEF-034. Cosmetic, and correctly rated LOW - the menu is usable, it just has
no breathing room at the smallest supported viewport. Grouped into the same fix batch as the other
320px findings because it is the same collision-padding question the emoji picker raises.

## ADV-031: A 500-character title fills 646px of the header and pushes every block below the fold

- Session: phase-2 gate
- Suggested severity: LOW

What I did: created a page whose title is exactly 500 characters - the server's own maximum, which
`InlineTitleInput` also enforces with `maxLength` - and opened it at 1280x800. (Typing 600 characters
into the rename input is correctly capped at 500, and the value survives a reload.)

Expected: not sure - but something that keeps the page's content reachable without a screen and a
half of scrolling.

Actual: the h1 wraps to 646px tall, the header to 770px, so at 1280x800 the viewport holds nothing
but the icon and the title: the "Updated" line, the first block and the whole editor are below the
fold. The title wraps cleanly and nothing overflows sideways, the sidebar row truncates with an
ellipsis and the breadcrumb clamps to 22 characters, so the layout holds - it is only the header that
has no ceiling. Since 500 characters is the documented limit rather than an abuse, a page at the
limit is a state the product allows and the header does not budget for.

Screenshot: screenshots/adv-031.png

Disposition: REJECTED - working as intended. A title is the page's own content, and 500 characters is
the documented maximum rather than an abuse, so a title at the limit legitimately occupies the space
it needs. The finding itself establishes that the layout holds: the h1 wraps cleanly, nothing overflows
sideways, the sidebar row truncates and the breadcrumb clamps. What is left is a very long title
pushing content down, and the alternatives are worse - clamping the h1 would hide part of what the
user typed, and scrolling the header away would leave the page unlabelled. The user who writes a
500-character title has asked for a 500-character heading. Reconsider only if a real user does this by
accident rather than an adversary doing it deliberately.

## ADV-032: A url cell's link can never be opened - clicking it or focusing it turns it into an input

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Book Tracker" from the sidebar, and tried to follow the Link
cell of the first row ("bookshop.org/p/books/the-design-of-everyday-things"), which renders as an
underlined anchor with `href="https://bookshop.org/..."`, `target="_blank"` and
`rel="noopener noreferrer"`. Tried a left click directly on the link text, then a keyboard-only run
(Tab from the page title through the row).

Expected: clicking the link opens the URL in a new tab, as its own markup advertises; a keyboard user
can reach the anchor and press Enter to open it.

Actual: no tab ever opens. The click lands on the cell, the cell swaps the anchor for a text input,
and the anchor's navigation never happens (`context.on('page')` counted 0 new pages; the URL stayed on
the same route). By keyboard it is worse: tabbing through the row never lands on the anchor at all -
focus goes straight from the multi-select chip to an `INPUT` for the Link cell, so the anchor does not
exist in the tab order. The mouse-down appears to focus the cell, re-render it as an input, and the
mouse-up then lands on the input rather than the anchor. So the url property renders a link that is
decorative: there is no gesture, mouse or keyboard, that opens it from the table. The row page has the
same behaviour.

Screenshot: screenshots/adv-032.png

Disposition: ACCEPTED -> DEF-043

## ADV-033: A url cell prefixes "https://" to literally anything, producing links to nonsense

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, opened "Book Tracker", and typed each of these into the Link cell of a
row, blurring after each: `javascript:alert(1)`, `data:text/html,<h1>x</h1>`, `//evil.com`,
`ftp://files.example.com`, `not a url at all`, `  spaces.com  `, `#`, `HTTP://Example.COM`,
`http://user:pass@evil.com`, `мойсайт.рф`.

Expected: something that either validates lightly or at least does not present garbage as a link -
and at minimum trims surrounding whitespace.

Actual: every value is stored verbatim and rendered as an anchor whose href is the value with
`https://` glued on unless it already begins with `http`. The resulting hrefs include
`https://javascript:alert(1)`, `https://data:text/html,<h1>x</h1>`, `https://not a url at all`,
`https://ftp://files.example.com`, `https://#` and `https://  spaces.com  ` (leading and trailing
spaces preserved inside the href). `//evil.com` becomes `https:////evil.com`. The good news is that
the blind prefix neutralises the `javascript:` and `data:` schemes, so this is not an injection; what
is left is that the cell will happily show a blue underlined link that cannot resolve, and never
trims. `HTTP://Example.COM` is passed through unprefixed, so the scheme check is case-sensitive in one
direction only. The contract says a url is not rejected for shape, so the storage is intended - the
surprise is the rendering, which asserts "this is a link" for input that plainly is not one.

Screenshot: screenshots/adv-033.png

Disposition: ACCEPTED -> DEF-044

## ADV-034: Enter does not commit a text, number or url cell - only blur saves, so Enter-then-reload loses the edit

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Work Projects", clicked the "Effort (days)" cell of the first
row, replaced 5 with 42, pressed Enter, waited, then reloaded the page. Repeated the same with the
Notes text cell in "Book Tracker" and with a url cell.

Expected: Enter in a single-line cell editor commits the value (the pattern the rest of the product
uses - Enter commits the page rename, and Enter in the option editor's "New option" box creates the
option).

Actual: Enter does nothing at all. No save, no visual confirmation, no exit from edit mode. Polling
the snapshot showed the stored value still `5` two and a half seconds after Enter, and still `5` after
a further 1.5s; it only became `42` once focus left the input. So after pressing Enter and reloading,
the cell is back to 5 and the edit is gone. The same holds for text cells (stored value unchanged
after Enter, written on blur) and url cells. A user who types a value, presses Enter because that is
what Enter does everywhere else in this app, and then navigates with the browser's reload or closes
the tab, loses the edit silently. There is also no debounce fallback, so blur is the only trigger.

Disposition: ACCEPTED -> DEF-045

## ADV-035: An empty or whitespace-only property name leaves "Add" enabled and does nothing at all, with no message

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Work Projects", clicked "Add property", left the name box
empty, and clicked "Add". Then typed five spaces and clicked "Add" again. Separately, opened a
column's header menu, chose "Rename", cleared the input and pressed Enter.

Expected: either a disabled "Add" button with a hint, or a validation message - the same treatment
that blanking a page title gets, which shows the notice "A page needs a name, so the old one was
kept."

Actual: the "Add" button is enabled in both cases. Clicking it does nothing observable: no property is
created, the popover stays open with the same content, and no notice, inline error or toast appears
anywhere on the page. The user is left clicking a live-looking button that never responds and is given
no reason. Renaming a property to blank behaves the same way - the header silently keeps the old name
with no message. The contrast is stark because over-length names are handled well: a 120-character
property name produces "...dropped by the server: name must be at most 100 characters. The workspace
has been refreshed." So feedback exists for one invalid name and is entirely absent for another. The
option editor has the identical hole: "Add" is enabled for an empty or whitespace-only option name and
the option is dropped without explanation.

Screenshot: screenshots/adv-035.png

Disposition: ACCEPTED -> DEF-046

## ADV-036: An option's name can be saved as empty, producing a nameless chip with no accessible name and no way to clear it

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Work Projects", opened the Status column's menu, chose "Manage
options", cleared the "Backlog" text box entirely, and clicked Save. Then looked at row 2
("Accessibility audit"), which had Backlog selected, and opened its Status picker.

Expected: an option name is rejected or trimmed back to its previous value the way a blank page title
and a blank property name are.

Actual: the server accepts it - the snapshot shows `{"name":"","color":"gray"}`. The row's cell now
renders an empty gray pill: a `<button>` whose only child is a `<span>` with no text, so its
accessible name is empty and a screen reader announces an unlabelled button. In the option picker the
option is likewise a `button` with no accessible name, sitting between "In progress" and "Done", so it
is unidentifiable and unreachable by name. The value is still set, so the row is in a state where the
user can see a colour but no label, and the only way back is to guess which blank pill is which in the
manage-options editor. Reproduced twice.

Screenshot: screenshots/adv-036.png (cell), screenshots/adv-036b.png (picker)

Disposition: ACCEPTED -> DEF-047

## ADV-037: Two properties can share a name, and two options can share a name, with nothing to tell them apart

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, opened "Work Projects", used "Add property" twice with the name
"Status" and type Select. Separately, in the Status column's manage-options editor, added a second
option also called "Backlog" and saved.

Expected: not certain the contract forbids it - but some signal, since the columns and the chips are
then indistinguishable.

Actual: the table ends up with three columns headed "Status", each with its own independent values and
its own "Status options" menu; the accessible names of the three header buttons are identical, so a
keyboard or screen reader user has no way to pick the right one, and Playwright's own role queries hit
a strict-mode violation on them. The duplicate option likewise persists ("Backlog" twice in the
picker) and the picker gives no hint which is which; whichever the user clicks writes a different
option id, so two rows that look identically tagged are not. Recorded because it surprised me that a
duplicate name is not even nudged against, while a 101-character name is refused.

Screenshot: screenshots/adv-037.png

Disposition: REJECTED - duplicate property names and duplicate option names are permitted by design. REQUIREMENTS.md does not forbid them and comparable tools allow them; a uniqueness rule would block the legitimate case of two similarly named properties on one database.

## ADV-038: Deleting a select option that rows still use silently leaves a dangling value the user cannot clear

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Work Projects", noted that row 1 has Status "In progress",
opened the Status column menu, chose "Manage options", clicked the bin next to "In progress" and
clicked Save. Then looked at row 1 and opened its Status picker. Reproduced a second time by
replacing a property's whole option list.

Actual: no confirmation and no warning that a row uses the option. After the save, row 1's Status cell
reads "Select..." as though empty - but the snapshot still holds
`value: "\"da9cbe94-...\""` for that cell, pointing at an option that no longer exists. The stale
value survives a reload. Worse, because the cell now looks empty the picker no longer offers its
"Clear" control, so there is no way for the user to remove the dangling value except by setting some
other option. Phase 4's grouping and filtering read these values, so a row that displays as empty but
stores a deleted option id is a trap waiting there. Expected either a warning naming the affected
rows, or the values for the removed option cleared as part of the same op.

Screenshot: screenshots/adv-038.png

Disposition: ACCEPTED -> DEF-048

## ADV-039: "Delete property" destroys a whole column of values with one click and no confirmation

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Work Projects", opened the "Effort (days)" header menu and
clicked "Delete property". Then deleted all six properties the same way.

Expected: the same confirmation the product already insists on elsewhere. Deleting a single row shows
"Delete ... This will permanently delete the row, its content, and all its property values. Deletion
is permanent - there is no trash." Deleting a page shows a dialog naming its nested pages.

Actual: the column and every cell value in it are gone immediately, no dialog, no undo, no notice. One
misclick in a menu whose neighbouring item is the harmless "Rename" destroys the data for every row in
the database - three rows in the seed, but fifty or five hundred in real use. Deleting all six
properties in six clicks left the table with nothing but a Title column. The cascade itself is correct
(no orphaned values remained), which is exactly why the deletion is irreversible.

Disposition: ACCEPTED -> DEF-049

## ADV-040: A select with 50 options - the documented maximum - renders a 2151px popover that does not scroll, so most options are unreachable

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, gave the "Work Projects" Status property 50 options (the contract's
`MAX_OPTIONS_PER_PROPERTY`) through the product's own `property.update` op, reloaded, and clicked a
Status cell at 1280x800. Then opened the same column's "Manage options".

Expected: the popover scrolls internally, as the block editor's slash menu does (ADV-030 records that
menu capping at `max-height: 316px` with `overflow-y: auto`).

Actual: the popover is 201px wide and **2151px tall** with no max-height and no internal scroll. Its
last option sits at y=2524 in the viewport. The document itself is only 1582px tall, so scrolling the
page to its very end still leaves that option at y=1742 - far below the 800px viewport. Roughly the
first twenty options are reachable and the remaining thirty cannot be selected by any means at this
viewport. "Manage options" is the same shape: the table header row grows to 1926px tall, pushing the
entire table off the bottom of the screen. This is not an abusive input - it is the maximum the
product's own validation permits.

Screenshot: screenshots/adv-040.png (picker), screenshots/adv-040b.png (manage options)

Disposition: ACCEPTED -> DEF-050

## ADV-041: The date picker ignores the cell's existing date - it opens on today's month with nothing selected

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Work Projects" and clicked the "Due date" cell of row 1, which
displays "15 Sept 2026". Today is 14 August 2026.

Expected: the calendar opens on September 2026 with the 15th marked as the selected day, so the
current value is visible and a nearby date is one click away.

Actual: the calendar opens on **August 2026** and no day is marked selected at all (a count of
`[aria-selected="true"]`, `[data-selected="true"]` and `.rdp-selected` inside the popover returns 0);
only "today" is emphasised. So the editor gives no feedback about what the cell currently holds, and
nudging a date from 15 September to 16 September requires noticing that you are in the wrong month
first. There is also no month or year jump control, only single-step previous/next arrows, so a date
in 1990 is about 435 clicks away and a date far in the future is unreachable in practice; and there is
no way to type a date, so hand-entry, locale formats and out-of-range years cannot be tested at all
through the UI.

Screenshot: screenshots/adv-041.png

Disposition: ACCEPTED -> DEF-051

## ADV-042: A multi-select chip's remove control cannot be activated by keyboard - Enter opens the picker instead

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Book Tracker", focused the "Remove Design" control on the
Topics chip of row 1 with the keyboard, and pressed Enter.

Expected: the chip is removed, as it is when clicked with the mouse.

Actual: the chip is not removed - the stored value is unchanged - and the multi-select picker popover
opens instead. The control is a `<span role="button" tabindex="0">` nested **inside** the cell's real
`<button>`, so it is focusable and announces as a button, but it has no key handler of its own and the
keystroke activates the parent. A keyboard user can reach a control that does nothing and gets an
unrelated popover as the response. Nested interactive elements are also invalid HTML
(`button button` matches once per chip). By contrast the date cell's "Clear date" control is a real
nested `<button>` and Enter on it correctly clears the date without opening the picker, so the two
cell editors disagree with each other.

Screenshot: screenshots/adv-042.png

Disposition: ACCEPTED -> DEF-066

## ADV-043: Recolouring an option is a blind cycle button, and in dark theme the colour swatches are indistinguishable

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Work Projects" > Status > "Manage options", and clicked the
circular swatch to the left of an option name eight times, reading its `aria-label` each time. Then
repeated the whole thing in dark theme.

Expected: a colour picker showing the six palette colours, as "recolor" in the phase contract
suggests.

Actual: there is no picker. The swatch is a cycle button that advances gray -> amber -> blue -> purple
-> teal -> rose -> gray on each click, with no popover, no list and no preview of what comes next
(checked: 0 elements with role menu, dialog or listbox open at any point). Setting rose from gray is
five clicks of guesswork. Its accessible name is the _current_ colour ("Color: gray"), not the action,
so a screen reader user is told a state and never that pressing it changes anything or what to. In
dark theme this is compounded: the swatch paints the option colour at 20% alpha
(`oklab(... / 0.2)`) over the dark panel with a gray border, and gray, blue and teal all resolve to
near-identical dark circles - I could not tell them apart by eye in the screenshot and had to read the
computed styles. Recolouring in dark theme is effectively guess-and-check.

Screenshot: screenshots/adv-043.png

Disposition: ACCEPTED -> DEF-052

## ADV-044: "New row" navigates away from the table to the new row's page, and focuses nothing there

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Work Projects", clicked "New row". Then went back and clicked
"New row" five more times in quick succession. Also did it on a freshly created empty database.

Expected: a new empty row appears at the bottom of the table with its title ready to type, so several
rows can be added in a row. That is what the affordance's position (a footer under the last row, next
to a plus) implies.

Actual: the click creates the row and immediately navigates to that row's own page. `document.activeElement`
is `BODY` there - nothing is focused, so the user has to find and click the "Untitled" title before
typing. Adding five rows therefore means five navigations away and five trips back through the
breadcrumb or sidebar. On a brand-new empty database it is worse: you land on a page showing "This
page is empty", with no properties panel (the database has none yet) and nothing to identify it as a
database row except a breadcrumb reading "Untitled / Untitled", so the "New row" click looks as if it
created a stray page. Five rapid clicks did each create a row, so nothing is lost - it is the flow
that breaks down.

Screenshot: screenshots/adv-044.png

Disposition: ACCEPTED -> DEF-053

## ADV-045: Neither the table header nor the title column stays put when scrolling, so a large table becomes unreadable

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, built a "Stress DB" with 20 properties (one of each type, cycling) and
50 rows through the product's own ops, opened it at 1280x800, then scrolled down 2000px and separately
scrolled the table right by 3000px.

Expected: at these sizes something anchors the reader - a sticky header row, or a frozen title column,
or both.

Actual: neither. Scrolling down puts the `thead` at y=-566, so with 50 rows there is no way to tell
which column a cell belongs to; the multi-select column makes some rows 170px tall, so only four or
five rows fit a screen and the header is gone almost immediately. Scrolling right (the table is 4577px
wide and lives in a `w-full overflow-x-auto` container 956px wide) carries the Title column away, so
the visible cells belong to unidentifiable rows - the screenshot shows five rows of "https://example.com"
and "Select..." with nothing to say whose they are. Rendering itself held up: all 50 rows and 22
columns rendered, no console errors, first paint about 3.5s.

Screenshot: screenshots/adv-045.png (header gone), screenshots/adv-045b.png (title column gone)

Disposition: ACCEPTED -> DEF-054 (deferred to Phase 4, where the view switcher lands and sticky headers can be solved once for table, board and list)

## ADV-046: "Manage options" expands the header row in place, shoving the table down and the "Add property" control off-screen

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, opened "Work Projects", opened the Status header menu and chose "Manage
options" at 1280x800.

Expected: a popover layered over the table, like the cell pickers and the header menu itself.

Actual: the editor is rendered inside the `<th>`, so the whole header row grows to about 260px, the
Status column widens, every row is pushed down by that amount, and the columns to the right shift
sideways - the Spec column is clipped at the viewport edge and the "Add property" plus button leaves
the screen entirely, so you cannot add a property while an option editor is open. The rest of the page
also stays fully interactive underneath (the editor is not a modal), so it is possible to open a cell
picker in a row while a header editor is mid-edit. With four options it is merely disorienting; with
50 it is the failure in ADV-040.

Screenshot: screenshots/adv-046.png

Disposition: ACCEPTED -> DEF-055

## ADV-047: A row page keeps rendering a row that has been deleted, and only flips to NOT FOUND when the user tries to write

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, opened the row page for "Phase 3: databases and table view" in one tab.
In a second tab opened "Work Projects", used the row's actions menu, chose "Delete row" and confirmed
"Delete permanently". Then watched the first tab, waited six seconds, and finally edited a cell in it.

Expected: the open tab notices and shows the NOT FOUND state it already has for a missing page.

Actual: the first tab keeps rendering the deleted row in full - title, the entire properties panel
with its values, and all its blocks - indefinitely (still there after six seconds, `h1` unchanged).
Nothing marks it as gone. Typing 77 into the Effort cell and blurring appears to work; the write is
rejected, the client refetches, and the page then turns into "NOT FOUND / This page no longer exists"
with **no notice at all** explaining that the value the user just typed was thrown away - which is odd
given that a value rejected for length does produce a clear notice ("Saving the cell value was dropped
by the server: ... The workspace has been refreshed."). A reload also shows NOT FOUND correctly. May
well be the intended "no realtime" behaviour, but the silent discard of the typed value on the way to
NOT FOUND is the part I would not have expected.

Screenshot: screenshots/adv-047.png

Disposition: ACCEPTED -> DEF-056 (deferred to Phase 6, which owns the sync queue and cross-client invalidation)

## ADV-048: Two tabs editing the same cell - the losing tab keeps showing its own value forever, with no sign it lost

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, opened "Work Projects" in two tabs. In tab 1 set the "Effort (days)"
cell of row 1 to 111 and blurred; in tab 2 set the same cell to 222 and blurred, a moment later.

Expected: last write wins on the server (it does), and the losing tab reconciles at some point, or at
least is not left presenting a value that is no longer true.

Actual: the server converges on 222, correctly, through the composite `rowPageId:propertyId` key - no
duplicate cells, no errors. But tab 1 goes on displaying 111 indefinitely (still 111 after a further
four seconds), with nothing to indicate it is stale. There appears to be no background poll: an
earlier probe showed a property deletion reaching the other tab only after that tab was clicked in.
Two windows side by side therefore disagree about a cell's value with no cue as to which is right.
Possibly intended for an offline-first product; recording it because a user with two windows open will
read the wrong number and never know.

Screenshot: screenshots/adv-048.png

Disposition: ACCEPTED -> DEF-057 (deferred to Phase 6, which owns the sync queue and cross-client invalidation)

## ADV-049: Cell editors carry no accessible name - a screen reader hears "0" and "Empty" instead of the property

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app, opened "Work Projects" and "Book Tracker" and read the accessibility
tree of the table, then of the row page.

Expected: each cell editor named for its property and row, since a table cell's context is not
conveyed by a bare control.

Actual: every editor takes its accessible name from its placeholder or from its value, or has none at
all. A number cell is `spinbutton "0"` - the name is the placeholder "0", so all six number cells in
a table announce identically as "0". A text cell is `textbox "Empty"`. An empty url cell is
`textbox "https://example.com"`. A select cell is a `button` whose name is the selected option
("In progress"), and when empty it is `button` with the name "Select..."; when the option name is
blank (ADV-036) it has no name whatsoever. The option picker and the date picker open as
`dialog` with no accessible name. The multi-select cell's name is the concatenation of its chips and
their remove buttons ("Frontend Remove Frontend Backend Remove Backend"). Nowhere in any of this does
the property name appear, so a non-visual user moving through the table cannot tell which property a
control edits. The header cells themselves are fine (`columnheader "Status options"`).

Disposition: ACCEPTED -> DEF-058

## ADV-050: The sidebar's database marker is aria-hidden, so a database is indistinguishable from a page to a screen reader

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app and read the accessibility tree of the sidebar page tree, then the DOM of
the "Work Projects" tree row.

Expected: the phase contract asks for "a distinct affordance marking a database row in the tree"; a
marker that only exists visually is half of that.

Actual: the marker is there in the DOM - a small `lucide-table-2` badge overlaid on the page icon,
`data-testid="database-marker"` - but it sits inside a wrapper carrying `aria-hidden="true"`, and no
other text or attribute distinguishes the row. In the accessibility tree the entry is exactly
`treeitem "Work Projects" > button "Work Projects"`, identical in shape to every ordinary page. So a
screen reader or keyboard user navigating the tree cannot tell which entries open a table and which
open a document, and finds out only after activating one.

Disposition: ACCEPTED -> DEF-059

## ADV-051: At desktop width the sidebar row overlay offers only Rename and Delete - "Add a database inside" is mobile-only

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: launched the app at 1280x800, hovered every kind of sidebar tree row (an ordinary page, a
page with children, a database) and read the revealed controls and the DOM.

Expected: the phase contract asks for a "New database" entry "alongside today's page creation
affordances (top-level and in the row action menu)". The top-level one is there and works ("Add a
top-level database").

Actual: the row action _menu_ - the one that contains "Rename", "Add a page inside X", "Add a database
inside X" and "Delete X" - lives in a `<span class="flex-none md:hidden">` and is therefore not
rendered at all at 1280px. What appears on hover at desktop width is a different element,
`data-testid="page-row-desktop-actions"`, containing exactly two buttons: "Rename X" and "Delete X".
So at every desktop viewport there is no way to create a nested page or a nested database from a tree
row; the only reachable creation affordances are the two top-level ones. Playwright's role query for
"Actions for Work Projects" finds nothing at 1280px while the element exists in the DOM, which is how
I noticed. This may predate Phase 3 (the overlay was touched by DEF-035/036), but the phase's own
"New database in the row action menu" requirement is unreachable on desktop because of it.

Screenshot: screenshots/adv-051.png

Disposition: ACCEPTED -> DEF-060

## ADV-052: Number cells print raw float precision - "528.7752545877175" in a column 200px wide

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, built a database whose number cells hold values like `Math.random()*1000`
through the product's own `value.set` op, and viewed the table. Separately typed
`0.1000000000000000055511151231257827`, `1e400`, `NaN`, `Infinity`, `1,234`, `+5`, `0x1F`, `--3`,
`٣٤` and thirty nines into a number cell.

Actual: the cell renders whatever the stored double stringifies to, so a column shows
"528.7752545877175", "92.68871997680739", "952.3667130446294" side by side - 16 significant digits in
a narrow column, with no formatting and no thousands separators. The input abuse itself was handled
safely by the native number input: `1e400`, `NaN`, `Infinity`, `--3` and `٣٤` are refused as you type
(the input goes empty), `+5` becomes 5, `1,234` becomes 1234, `12abc` becomes 12, `0x1F` becomes 01
and `  7  ` becomes 7, so no non-finite value ever reached the server. `-0` is typed and stored as
`-0`. Recording only the display: a number property with no formatting is going to look broken the
first time someone stores a computed value.

Screenshot: screenshots/adv-052.png

Disposition: ACCEPTED -> DEF-061

## ADV-053: In dark theme an unchecked checkbox cell is a solid white square

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app in dark theme (`personal-space:theme = dark`), opened "Work Projects" and
looked at the "Done" column, then captured the cell on its own and read its computed styles.

Expected: a checkbox styled for the theme, like the to-do checkboxes in the block editor.

Actual: the checkbox is a native `input[type=checkbox]` with `appearance: auto` and no theming, so in
dark theme the browser paints its default: a bright white filled square on a near-black row. Next to
the checked state - a blue box with a white tick - the unchecked one reads as the more "active" of the
two, which is backwards. In light theme it is unremarkable. The computed style confirms the element is
unstyled (`background-color: rgba(0,0,0,0)`, `appearance: auto`), so it will follow the OS rather than
the product palette on any platform.

Screenshot: screenshots/adv-053.png

Disposition: ACCEPTED -> DEF-062

## ADV-054: On a row page nothing in the sidebar is marked current, so the tree loses the reader's place

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, opened "Work Projects", clicked a row title to open its row page, and
looked for the current-page highlight in the sidebar.

Expected: since row pages are deliberately excluded from the tree, the row's parent database would be
marked current - it is the nearest thing in the tree and the breadcrumb already names it.

Actual: no element in the tree carries `data-current="true"` at all (the query returns an empty list),
so the amber highlight that marks your position everywhere else in the product simply goes out. On a
long tree scrolled away from the database, the sidebar gives no indication of where you are. The
breadcrumb still reads "Work Projects / <row>", so the information exists; it is only the tree that
goes blank.

Screenshot: screenshots/adv-054.png

Disposition: ACCEPTED -> DEF-063

## ADV-055: The delete-database dialog calls rows "pages" and does not mention the properties it will destroy

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, opened a row page of "Work Projects", hovered the database in the
sidebar and clicked its Delete control.

Actual: the dialog reads: `Delete "Work Projects"? 3 pages nested inside it will be deleted too: Phase
3: databases and table view, Accessibility audit, Performance baseline. Deletion is permanent - there
is no trash.` The cascade it performs is correct and complete (database, three rows, their blocks, six
properties, all values - I checked the snapshot afterwards and found no orphans), and it correctly
returned me to Home rather than leaving me on a dead row. But the wording describes the rows as
"pages", which is not how the user met them, and it never mentions that the six properties and every
value in the table go with it - which the row-delete dialog does say ("...and all its property
values"). The two dialogs are inconsistent about the same class of data, and the more destructive one
says less.

Screenshot: screenshots/adv-055.png

Disposition: ACCEPTED -> DEF-064

## ADV-056: A new database and a new row are both given a page icon, so rows in one table are indented differently

- Session: phase-3 gate
- Suggested severity: LOW

What I did: launched the app, clicked "Add a top-level database", then opened "Work Projects" and
clicked "New row", then went back to the table.

Actual: the created database is `{"kind":"database","icon":"📄","title":"Untitled"}` - a document icon
for a table, next to the seed's 🗂️ and 📖, and the same icon an ordinary new page gets, so the only
thing marking it as a database in the sidebar is the small badge from ADV-050. New rows get the same
📄, while the seeded rows have no icon at all, so the Title column ends up with some rows prefixed by
an icon and some not, and their titles start at different x positions in the same column. Small, but
it is the kind of thing that makes a table look untidy from the first row a user adds.

Screenshot: screenshots/adv-056.png

Disposition: ACCEPTED -> DEF-065

## ADV-057: Deleting a property leaves the view filtering and sorting by it, and the Filter panel then shows a filter that is not the one stored

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did: opened "Work Projects" in the table view, added a filter `Effort (days) is 3` and a sort
on `Spec`, then deleted both of those properties from their column menus ("Delete property" ->
"Delete permanently"), then reloaded and reopened the Filter / Sort panel.
Expected: deleting a property clears any filter or sort that referenced it, and the Filter badge and
panel describe the settings that are actually in force.
Actual: the view record still holds the deleted ids -
`filters:[{propertyId:"dcfa7e48…",operator:"is",value:"3"}]` and `sort:{propertyId:"bda761c0…"}`,
neither of which exists in `properties` any more. The rows are (correctly) shown unfiltered, but the
Filter button still shows the badge "2", and the panel renders the dangling filter as
`Status | is | — empty —` because the selects fall back to their first option. So the panel claims a
filter that would show one row while the table shows all six, and the stored sort is invisible in the
panel ("— none —"). Touching any control in that row would then save a filter the user never asked
for.
Screenshot: screenshots/adv-057.png

Disposition: ACCEPTED -> DEF-071

## ADV-058: A filter that matches nothing leaves the table view completely blank, with no empty state - the list view has one

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did: in "Work Projects" table view, added two contradictory filters -
`Status is Backlog` AND `Status is not Backlog` - then did the equivalent in the list view
(`Done is not checked` AND `Done is checked`).
Expected: consistent "no rows match" messaging in every view.
Actual: the table view shows the header row, nothing under it, and the "New row" button - no
explanation at all, so a user who forgets the filter sees an apparently emptied database. The list
view for the same situation says "No rows match the current filters.", and the board says nothing
either (all columns render, all empty). Three views, three different empty behaviours for the same
cause.
Screenshot: screenshots/adv-058.png

Disposition: ACCEPTED -> DEF-072

## ADV-059: Creating a database throws "sortKey is not a valid fractional index"; the server rejects all three view.create ops, so the new database has no views

- Session: phase-4 gate
- Suggested severity: HIGH

What I did: reset the workspace, opened "Work Projects", clicked "Add a top-level database" in the
sidebar. Watched the console and the `/sync` traffic, then reloaded.
Expected: a new database is created with its three views, and the app navigates to it - as clicking
"Add a top-level page" does for a page.
Actual: an uncaught error reaches the window: `sortKey is not a valid fractional index`. The three
`view.create` ops are sent with `"sortKey":"a"`, `"b"`, `"c"` and the server rejects all three
(`{"status":"rejected","reason":"sortKey is not a valid fractional index"}`); the `page.create` for
the database itself is applied. The app does not navigate to the new database (the URL stays on Work
Projects), nothing tells the user anything went wrong, and the sidebar entry for the new database
sometimes disappears after a reload. The result is a database with zero views - see ADV-060 for what
that does to the view switcher. Creating an ordinary page in the same session produced no error and
navigated correctly, so this is specific to the database (view-minting) path.
Screenshot: screenshots/adv-059.png

Disposition: ACCEPTED -> DEF-070

## ADV-060: A database with no views shows all three tabs but no Filter control, and the board tells you to use a control that is not on screen

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did: opened the "Untitled" database left behind by ADV-059 (a database whose three views were
never persisted) and clicked through Table, Board and List.
Expected: either the views are minted on demand, or the switcher reflects what the database actually
has.
Actual: all three tabs render. The Filter / Sort control is absent entirely. The board shows
"Pick a Select property to group by using the Filter / Sort control above." - a dead end, because
there is no such control to use. The list shows "No rows match the current filters." although no
filter exists (see ADV-072). Nothing in the UI hints that this database is missing its views or how
to recover it.
Screenshot: screenshots/adv-060.png

Disposition: ACCEPTED -> DEF-073

## ADV-061: Card-move toasts and drag announcements name the card by raw UUID

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did: dragged "Accessibility audit" from Backlog to Done on the "Work Projects" board; also
dropped a card outside any column, cancelled a drag with Escape, and picked a card up with the
keyboard.
Expected: the feedback names the card, e.g. `Moved "Accessibility audit" to "Done"`.
Actual: every message substitutes the row id:
`Moved "ce1d6798-7cbb-4cca-845a-89fb624053c9" to "Done".`,
`Card "b6390a6a-…" was dropped outside a column and stayed in place.`,
`Cancelled moving "29345c0d-…".`, and the live-region announcement
`Card "3da47d9a-…" is over the "Backlog" column.` The column name is resolved correctly in the same
sentence, so only the card is affected. It matters most when the move makes the card vanish (a filter
excludes the destination column): the toast is then the only evidence of what happened, and it is a
UUID.
Screenshot: screenshots/adv-061.png

Disposition: ACCEPTED -> DEF-074

## ADV-062: A card dropped inside one column lands in the next one, and the last column cannot be reached at all

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did: on the "Work Projects" board at 1280x800 I measured the column rects
(Backlog 308-568, In progress 584-844, Done 860-1120, On hold 1136-1396, No value 1412-1672) and
released a dragged card 8px inside the right edge of "In progress" (x=836, unambiguously inside it).
Then I tried to drag a card to the "No value" column, which sits off the right of the viewport.
Expected: the card goes to the column the pointer is over; dragging towards the right edge auto
scrolls the board so the trailing column can be reached.
Actual: the drop at x=836 moved the card to "Done" - one column to the right of where it was
released ("Moved … to Done"). The drop target appears to be chosen from the dragged card overlay's
rectangle rather than the pointer, so the right-hand half of every column behaves as the next column.
The same cause makes the off-screen "No value" column unreachable: the board never auto-scrolls
during a drag, and dropping at the viewport edge either reports "dropped outside a column and stayed
in place" or silently lands in a neighbour. Manually scrolling the board first and then dragging does
work.
Screenshot: screenshots/adv-062.png

Disposition: ACCEPTED -> DEF-075

## ADV-063: "Add card to Done" creates a card with no value for the grouping property, so it appears in the "No value" column

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did: on the "Work Projects" board clicked "Add card to Done", then reopened the board and
looked at the columns and the stored values.
Expected: a card added from a column's own "Add card" control belongs to that column - Status = Done.
Actual: the new row is created with no Status value at all, so the card is placed in the trailing
"No value" column, at the far right and usually off screen. Nothing appears in the column you clicked,
and (because the board does not scroll to it) the click looks like it did nothing. Repeating it six
times in the Backlog column produced six untitled cards, all in "No value". The row page itself is
created correctly.
Screenshot: screenshots/adv-063.png

Disposition: ACCEPTED -> DEF-076

## ADV-064: A keyboard user can pick a card up but can never move it to another column

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did: focused a card's drag handle with Tab, pressed Space (the handle announces
`aria-roledescription="draggable"`), then pressed ArrowRight twice, ArrowDown, and Tab, then Space.
Expected: arrow keys move the lifted card between columns, Space drops it there, Escape cancels -
the standard dnd-kit keyboard flow the drag handle advertises.
Actual: the pickup is announced ("Card … is over the \"Backlog\" column"), but every arrow key leaves
the announcement unchanged - the card never leaves its own column. Pressing Tab ends the drag and
writes a move back to the column it started in ("Moved … to \"Backlog\""), i.e. Tab commits rather
than cancels. So changing a card's group is mouse-only, and the keyboard path additionally issues a
pointless `value.set`.
Screenshot: screenshots/adv-064.png

Disposition: ACCEPTED -> DEF-077

## ADV-065: The view switcher is a tablist that ignores arrow keys

- Session: phase-4 gate
- Suggested severity: LOW

What I did: focused the "Table view" tab and pressed ArrowRight, then Enter.
Expected: for `role="tablist"` / `role="tab"`, arrow keys move between tabs (and activate, or Enter
activates).
Actual: ArrowRight does nothing at all - focus and selection both stay on "Table view", and Enter
re-selects the same tab. The tabs are individually reachable with Tab, so the control is operable,
but it does not behave the way its own ARIA roles promise, and a screen-reader user following the
tabs pattern will think the switcher is broken.

Disposition: ACCEPTED -> DEF-080

## ADV-066: Offline, a card drag reports "Moved … to Done" while the card stays where it was

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did: opened the "Work Projects" board, went offline in the browser, dragged "Accessibility
audit" from Backlog to Done, changed the sort, then came back online and reloaded.
Expected: either the card moves optimistically and the queued op syncs later, or the UI says the move
is pending.
Actual: the toast says `Moved "…" to "Done"` but the board does not change - the card is still in
Backlog, and the column counts are unchanged. There is no offline indicator anywhere on the screen,
so the only feedback contradicts what is on screen. On reconnect the queue flushes, the server value
becomes Done, and the board converges (nothing was lost), but for as long as the connection is down
the board disagrees with its own success message.
Screenshot: screenshots/adv-066.png

Disposition: ACCEPTED -> DEF-078

## ADV-067: The chosen view is forgotten on every reload and on any navigation away and back

- Session: phase-4 gate
- Suggested severity: LOW

What I did: selected the Board view on "Work Projects", then (a) reloaded, (b) navigated away and
came back with the browser's Back/Forward buttons, (c) refreshed mid-drag.
Expected: for something described as a local preference, the view I chose is still showing when I
come back to that database.
Actual: every one of those returns to the Table view. Nothing is stored - not in the URL, not in
localStorage - so a user who works in a board loses it on every reload, and a link to a database can
never point at its board. The filters, sort and grouping do survive (they are server state), which
makes the reset more jarring: the board's settings are remembered but the board is not.

Disposition: ACCEPTED -> DEF-081

## ADV-068: Two select options can be given the same name, and the board then shows two identical columns

- Session: phase-4 gate
- Suggested severity: LOW

What I did: opened Status -> "Manage options" on "Work Projects", typed "Done" (an existing option
name) into "New option…" - the Add button stayed enabled - added it and saved, then opened the board.
Expected: a duplicate option name is refused, or at least flagged, as a whitespace-only name already
is (Add is correctly disabled for " ").
Actual: the property now has two options called "Done", and the board renders two columns both
labelled "Done", one of them empty, with nothing to tell them apart. The same duplicate appears twice
in every Status cell editor and twice in the filter value list, where picking the wrong one silently
matches no rows.
Screenshot: screenshots/adv-068.png

Disposition: ACCEPTED -> DEF-082

## ADV-069: An option name the server rejects is discarded silently, taking every other edit in the same save with it

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did: in Status -> "Manage options" I renamed "Backlog" to a 90+ character string containing
emoji and Arabic text and pressed Save. Separately, I renamed it to " " and pressed Save. In a third
run I renamed "Backlog" to "Icebox" _and_ added a duplicate option in the same dialog and saved.
Expected: the dialog reports what was refused and keeps the dialog open, or the client validates the
same rules the server enforces (<=100 chars, non-empty).
Actual: the dialog closes as though the save succeeded, no toast, no console error, and the options
are unchanged. The `/sync` response shows the op rejected -
`"reason":"option name must be at most 100 characters"` and `"reason":"option name must not be
empty"`. In the third run the legitimate rename to "Icebox" was lost too, because the whole batch was
dropped, so a user can silently lose good edits alongside a bad one.

Disposition: ACCEPTED -> DEF-079

## ADV-070: The list view prints dates as raw ISO strings where every other surface formats them

- Session: phase-4 gate
- Suggested severity: LOW

What I did: compared the "Due date" property for the same rows in the table and the list views of
"Work Projects".
Expected: one date format across the product.
Actual: the table (and the board's row page) shows "15 Sept 2026"; the list view shows "2026-09-15".
Screenshot: screenshots/adv-070.png

Disposition: ACCEPTED -> DEF-083

## ADV-071: List view properties are unlabelled, unaligned, and omitted when empty, so a value cannot be attributed to its property

- Session: phase-4 gate
- Suggested severity: LOW

What I did: opened the list view of "Book Tracker" at 1280x800 and read down the rows.
Expected: the properties shown for each row line up, so the column of pills means the same thing on
every row.
Actual: each row lays its properties out right-aligned and omits any property that is empty, so
nothing lines up: "Want to read" sits at a different x on every row, and the last row shows a single
pill, "Science", which is a _Topics_ value but reads as a Status because that is where Status appears
on the rows above. The property name exists only as a `title` attribute on a wrapper span, so it is
invisible and not announced. The first three properties are shown and the rest are dropped with no
indication (Book Tracker's Finished, Rating and Notes never appear).
Screenshot: screenshots/adv-071.png

Disposition: ACCEPTED -> DEF-084

## ADV-072: A database with no rows says "No rows match the current filters" although no filter is set

- Session: phase-4 gate
- Suggested severity: LOW

What I did: opened the list view of a database that has no rows and no filters.
Expected: something like "This database has no rows yet" plus a way to add one.
Actual: "No rows match the current filters." - which sends the user looking for a filter that does
not exist. The message is correct for ADV-058's case and wrong here; the two cases are not
distinguished.
Screenshot: screenshots/adv-060.png

Disposition: ACCEPTED -> DEF-085

## ADV-073: A second tab keeps rendering a deleted grouping property, although a filter change in one tab does reach the other

- Session: phase-4 gate
- Suggested severity: LOW

What I did: opened "Work Projects" in two tabs, both on the Board view. In tab B I deleted the Status
property (the property the board is grouped by). Then I looked at tab A without reloading. Separately,
I added a filter in tab B and looked at tab A.
Expected: consistent behaviour - either both kinds of change propagate to the other tab, or neither
does.
Actual: the filter change propagates immediately (tab A's Filter badge and columns update). The
property deletion does not: tab A keeps drawing five columns of a property that no longer exists,
including cards under option names that are gone, until it is reloaded - at which point it correctly
shows "Pick a Select property to group by…". Dragging in that stale board is still possible.

Disposition: REJECTED - the same root cause as ADV-057 (a view keeps referencing a deleted property); fixing DEF-071 fixes this, and a second ledger entry for one cause would be fixed twice and closed once

## ADV-074: Deleting the database you are viewing sometimes leaves a "This page no longer exists" screen instead of returning to Home

- Session: phase-4 gate
- Suggested severity: LOW

What I did: opened "Work Projects", switched to the Board view, then deleted the database from its
sidebar row and confirmed. Repeated.
Expected: the same behaviour every time - Phase 3's pass recorded that this returns you to Home.
Actual: on one run the app stayed on the dead URL and showed
"NOT FOUND / This page no longer exists. / Pick another page from the sidebar."; on the next run,
with the same steps, it navigated to Home. So the redirect after deleting the page you are on is
racy. Caveat for triage: another agent's end-to-end suite was resetting this workspace during part of
my session, and a reset also produces that screen, so this one may be environmental - it is recorded
because I could not rule it in or out. The same screen appeared once in a second tab opened on a URL
the first tab was rendering fine.

Disposition: REJECTED - did not reproduce in five isolated runs of the stated steps; the "This page no longer exists" screen came from a concurrent end-to-end run resetting the workspace, which the finding itself flags as the likely cause, not from a redirect race in the product.

## ADV-075: Sorting by a select property sorts by option name, not by the option order the board and the editor show

- Session: phase-4 gate
- Suggested severity: LOW

What I did: sorted "Work Projects" by Status ascending. The property's options are, in order,
Backlog, In progress, Done, On hold - the order the board columns and the cell editor use.
Expected: rows ordered by that option order, as a board-shaped product implies.
Actual: rows come out Backlog, Backlog, Done, In progress, On hold - alphabetical by option name, so
the sorted table disagrees with the column order of the board next to it. Empty values sort last in
both directions, which is the right call and worth keeping.

Disposition: ACCEPTED -> DEF-086

## ADV-076: The board has no accessible structure, and the filter / sort popover has no accessible name

- Session: phase-4 gate
- Suggested severity: LOW

What I did: read the accessibility tree of the board view and of the open Filter / Sort panel.
Expected: columns exposed as groups or regions with their option name and count as an accessible
name, cards as list items, and the popover named ("Filter and sort").
Actual: the board is a flat run of text and buttons - the column name and its count are bare `text`
nodes, there is no grouping element, and nothing associates a card with its column, so a screen
reader user hears "Backlog, 2, Drag "Accessibility audit", Accessibility audit, Add card, In progress,
1, …" with no structure to navigate. The popover is exposed as an unnamed `dialog`. Inside it, the
regions are named ("Filters", "Sort", "Group by"), which shows the intent was there.

Disposition: ACCEPTED -> DEF-087

## ADV-077: The filter property list omits Title while the sort list includes it

- Session: phase-4 gate
- Suggested severity: LOW

What I did: opened the Filter / Sort panel on "Work Projects" and compared the "Filter property" and
"Sort property" lists.
Expected: the two lists agree about what can be filtered and sorted, or the difference is explained.
Actual: "Sort property" offers Title (value `title`) alongside the six properties; "Filter property"
offers only the six. Since Title is text, `contains`/`notContains` would apply to it exactly as they
do to the Notes property, so its absence reads as an oversight rather than a decision - and filtering
a database by title is the first thing most people try.

Disposition: ACCEPTED -> DEF-088
