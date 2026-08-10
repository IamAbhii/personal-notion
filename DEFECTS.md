## DEF-001: Sidebar inline rename operation does not commit new page title

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 1

Steps to reproduce:

1. Navigate to the app at http://localhost:8787
2. Create a new page by clicking "Add a top-level page" in the sidebar
3. Click the "Rename Untitled" button in the sidebar row
4. Type a new name (e.g., "Test Page") in the inline text input
5. Press Enter to commit the rename

Expected: The page title should update in both the sidebar row and the page header (h1.page__title)
Actual: The inline rename input closes but the page title remains "Untitled" in the page header, and the page name does not update in the sidebar

History:

- orchestrator: relaying frontend-dev, CANNOT REPRODUCE. "I ran the app and drove a real headed
  Chromium through DEF-001's exact steps. Enter commit: sidebar row updated, h1.page\_\_title read the
  new title, one page.update op posted with baseVersion 1 and the response was applied, version 2;
  survived a reload. Blur commit: same result, version 3, survives reload. No race between commit and
  query invalidation - submitOps is awaited and the snapshot invalidation runs in the mutation's
  onSuccess, so the refetch cannot precede the write. Two identically titled pages: renamed the
  second, the correct row changed and the other stayed Untitled. Zero console errors throughout.
  Replicating QA's locator verbatim by hand, a different page got renamed than the one the route is
  showing - so the sidebar assertion passes and the h1 assertion fails, which is DEF-001's Actual
  verbatim. The snapshot at the start of my session had 21 leftover Untitled pages plus seven
  'Rename Test' pages at version 3-5, so QA's own runs had already committed renames successfully to
  the backend."
- orchestrator: dispute accepted on the evidence. The cause is the spec, not the product:
  `.getByRole('button', { name: 'Rename Untitled' }).first()` resolves to a different row than the
  one under test, because `playwright.config.ts` sets `fullyParallel: true` while `start-server.sh`
  cleans the local D1 only once per run, so concurrent specs mint `Untitled` rows under each other.
  Verified independently from screenshots/def-001-qa-selector-wrong-row.png: the renamed row is not
  the current row, and the tree is full of successfully renamed pages from earlier runs. Routed to qa
  as a spec fix; qa closes this once the specs pass against the unchanged product.
- orchestrator: root cause found, and it is not the one first suspected. I reran the suite myself
  serially (`--workers=1`) against a wiped local D1 and a verified-free port, with qa's new
  `data-page-id` selectors in place: rename and persistence still failed, header reading `Untitled`
  while the sidebar showed the new title. Querying the local D1 after the run settles it. The page
  that got renamed, `c5515658`, is the **earliest-created top-level page** — a seeded page — while all
  three spec-created pages are still `Untitled` at version 1. The specs do
  `await createButton.click()` then `await page.waitForURL(/\/w\/[^/]+\/page\/[^/]+/)`, but `/`
  already redirects to `/w/:workspaceId/page/:seededPageId`, so that pattern **matched before the
  click had navigated**. `waitForURL` returned immediately, `page.url()` still held the seeded page's
  id, and the spec renamed that row. By assertion time the route had moved on to the newly created
  page, so the header legitimately read `Untitled`. `data-page-id` removed the selector ambiguity but
  was handed an already-stale id. The product is correct in both the sidebar and the header.
  Separately: a single rename gesture took the seeded page from version 1 to version 3, i.e. two
  write ops for one gesture (Enter commits, then blur commits again) - raised with frontend-dev as its
  own low-severity item, not part of this defect. The unit tests (Sidebar.test.tsx, InlineTitleInput.tsx) show rename works in isolation, but e2e tests via Playwright show the rename operation doesn't persist to the UI or backend. This affects criteria 2 (rename and delete operations) and criterion 3 (persistence across reload).
- qa: worked the spec fixes. Fixed playwright config location (moved to e2e/), fixed selector issues
  (use .locator().filter() instead of :has-text(), use data-page-id for unambiguous targeting, specify
  .row__action to get rename button not title button), fixed console error listeners (attach before
  navigation), improved disclosure button selector in delete-page to handle both expanded and collapsed
  states. Unit tests pass (39 worker + 33 frontend). Delete-page and seeded-tree specs pass. Manual
  test confirms rename works: page created, renamed to unique name, title updates in sidebar and header.
  However, rename-page and persistence specs still fail in full e2e suite despite selector fixes. Issue
  appears to be test harness/environment related, not product code. Renamed pages exist in database
  (version increments confirm backend commits) but UI updates are not being detected by spec assertions
  in parallel test runs. Leaving OPEN pending root cause analysis of test environment.
- qa: retested with full serial suite run (workers: 1, fullyParallel: false, fresh database). All 5
  e2e specs pass, including 0-seeded-tree, delete-page (with cascade and cancel), create-page,
  rename-page, and persistence. Rename operations confirmed working end-to-end: pages renamed in
  sidebar and header update correctly, changes persist across reload. Manual restart test (criterion 3) confirmed: created page persists across full app restart, workspace is not re-seeded. Product
  code is correct; specs were fixed by improving selectors (data-page-id targeting) and properly
  sequencing waits. CLOSED.
