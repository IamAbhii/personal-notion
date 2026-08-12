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
