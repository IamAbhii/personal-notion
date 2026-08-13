/**
 * Regression specs for DEF-037 through DEF-040.
 *
 * DEF-037: Block drag handle is vertically centred on the first text line for every block type.
 * DEF-038: Enter in a list block continues the list; Enter on an empty list item exits it.
 * DEF-039: Consecutive same-type list items are visually tighter than a type-transition gap.
 * DEF-040: Notice toast auto-dismisses after its lifetime with no user interaction.
 *
 * Every assertion is unconditional — no `if (visible)` guards. Each was verified to go red when
 * the fix is absent (handle at top-0, Enter always making paragraph, uniform mt-1, Infinity
 * duration) before being accepted as a real regression gate.
 */

import { test, expect, type Page } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new top-level page and opens the block editor.
 * Navigates to '/', clicks "Add a top-level page", then clicks the empty-page placeholder.
 */
async function createFreshPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Add a top-level page' }).click();
  await page.waitForURL(/\/w\/[^/]+\/page\/[^/]+/);
  const emptyPlaceholder = page.getByRole('button', { name: 'This page is empty' });
  await expect(emptyPlaceholder).toBeVisible();
  await emptyPlaceholder.click();
  await page.waitForLoadState('networkidle');
  // Wait until the textarea created by the optimistic block add is the document's active element.
  // The layout effect focuses it synchronously after the React commit, but the CDP keyboard
  // channel can be dispatched before the commit lands when the test runs inside a warm Playwright
  // process (previous tests have left the browser with a stale focus context). Polling via
  // waitForFunction sends no DOM events and does not disturb the focus state.
  await page.waitForFunction(
    () => {
      const ta = document.querySelector(
        '[data-testid="block-editor"] textarea',
      ) as HTMLTextAreaElement | null;
      return ta != null && document.activeElement === ta;
    },
    { timeout: 3000 },
  );
  // Give the browser one more scheduler tick after focus is confirmed. The waitForFunction
  // check can resolve during a transient focus state if a React re-render is in flight;
  // this pause lets any in-progress commit finish before we start sending keystrokes.
  await page.waitForTimeout(100);
}

/**
 * Opens the slash menu by typing a query into the currently-focused empty block and clicks the
 * first matching result. The focused block must be empty: the slash menu only opens when the block
 * value is '' and the block type is not 'code'.
 */
async function pickFromSlashMenu(page: Page, query: string): Promise<void> {
  await page.keyboard.type(`/${query}`);
  await page.waitForTimeout(200);
  const firstItem = page.locator('[data-testid="slash-menu-item"]').first();
  await expect(firstItem).toBeVisible({ timeout: 3000 });
  await firstItem.click();
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// DEF-037: Drag handle vertical alignment
// ---------------------------------------------------------------------------

test.describe('DEF-037: block drag handle centred on first text line', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  /**
   * Creates one block of every textual type and measures the pixel delta between the handle's
   * centre-Y and the first text line's centre-Y for each. Asserts every delta is within 4 px.
   *
   * Measurement: handle_CY = handleRect.top + handleRect.height/2.
   * First-line_CY = textareaRect.top + computed paddingTop + computed lineHeight/2.
   * All values come from getBoundingClientRect() and getComputedStyle() in the real browser,
   * so they are unaffected by sub-pixel rounding in the Tailwind class values.
   *
   * Without the fix (handle at top-0 for every type) the paragraph delta is ~+9 px and the
   * heading-2 delta is ~−7 px, both failing the ≤4 px threshold.
   */
  test('handle centre is within 4 px of the first text line for every block type', async ({
    page,
  }) => {
    await createFreshPage(page);

    // One block per type in an order that avoids the code-block restriction: code traps Enter
    // as a newline (not a block-create), so it goes last. After each non-code block pressing
    // Enter creates either a new paragraph or a same-type list item — both are empty and both
    // accept the slash menu (the menu opens on any empty non-code block).
    const blockSeq: ReadonlyArray<{ query: string; text: string }> = [
      { query: 'Heading 1', text: 'Heading one text' },
      { query: 'Heading 2', text: 'Heading two text' },
      { query: 'Heading 3', text: 'Heading three text' },
      { query: 'Text', text: 'Paragraph text' },
      { query: 'Bulleted', text: 'Bulleted text' },
      { query: 'Numbered', text: 'Numbered text' },
      { query: 'To-do', text: 'Todo text' },
      { query: 'Quote', text: 'Quote text' },
      { query: 'Callout', text: 'Callout text' },
      // Code is last: Enter inside code adds a newline, so we never press Enter after it.
      { query: 'Code', text: 'code text' },
    ];

    for (let i = 0; i < blockSeq.length; i++) {
      const { query, text } = blockSeq[i]!;
      await pickFromSlashMenu(page, query);
      await page.keyboard.type(text);
      // For every type except the last, press Enter to land in a new empty block ready for the
      // next slash menu invocation.
      if (i < blockSeq.length - 1) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(100);
      }
    }

    await page.waitForTimeout(300);

    // Measure all blocks in one evaluate() call to avoid multiple round trips.
    type Measurement = {
      type: string;
      delta: number;
      handleCY: number;
      firstLineCY: number;
    };

    const measurements = await page.evaluate((): Measurement[] => {
      const results: Measurement[] = [];
      for (const blockDiv of Array.from(document.querySelectorAll('[data-block-type]'))) {
        const type = (blockDiv as HTMLElement).dataset['blockType'] ?? 'unknown';
        if (type === 'divider') continue;

        const handle = blockDiv.querySelector(
          '[data-testid="block-drag-handle"]',
        ) as HTMLElement | null;
        const textarea = blockDiv.querySelector('textarea') as HTMLTextAreaElement | null;
        if (!handle || !textarea) continue;

        const hRect = handle.getBoundingClientRect();
        const tRect = textarea.getBoundingClientRect();
        const cs = window.getComputedStyle(textarea);

        const handleCY = hRect.top + hRect.height / 2;
        const paddingTop = parseFloat(cs.paddingTop);
        const lineHeight = parseFloat(cs.lineHeight);
        const firstLineCY = tRect.top + paddingTop + lineHeight / 2;

        results.push({
          type,
          // Round to 1 dp so the console output is readable.
          delta: Math.round((handleCY - firstLineCY) * 10) / 10,
          handleCY: Math.round(handleCY),
          firstLineCY: Math.round(firstLineCY),
        });
      }
      return results;
    });

    console.log('DEF-037 handle delta measurements (positive = handle below line centre):');
    console.table(measurements);

    for (const m of measurements) {
      expect(
        Math.abs(m.delta),
        `${m.type}: handle delta ${m.delta} px exceeds 4 px tolerance ` +
          `(handle CY=${m.handleCY}, first-line CY=${m.firstLineCY})`,
      ).toBeLessThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-038: Enter continues the list; Enter on empty exits it
// ---------------------------------------------------------------------------

test.describe('DEF-038: Enter in a list block continues the list', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  /**
   * Helper: creates a fresh page, opens a list of the given type via the slash menu, types three
   * items with Enter between them, and asserts:
   *   1. Three blocks of the expected type exist.
   *   2. Each textarea has the right value (regression for DEF-011: first character after Enter
   *      must not land in the block the user left).
   *   3. For numbered lists: the three <ol> elements carry start="1", "2", "3".
   */
  async function assertListContinuation(
    page: Page,
    slashQuery: string,
    blockType: string,
  ): Promise<void> {
    await createFreshPage(page);
    const blockEditor = page.locator('[data-testid="block-editor"]');

    await pickFromSlashMenu(page, slashQuery);
    await page.keyboard.type('First item');
    // Wait after each Enter: the layout effect that moves caret to the new block runs synchronously
    // in the same commit, but Playwright's CDP event queue means keyboard events can be delivered
    // before React has committed the focus move. 300 ms is enough to let the commit land.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Second item');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Third item');
    await page.waitForTimeout(300);

    const blocks = blockEditor.locator(`[data-block-type="${blockType}"]`);
    await expect(blocks).toHaveCount(3);

    // Verify text values — if DEF-011 regressed, block 0 would end with 'itemS' and block 1
    // would start with 'econd item'.
    const textareas = blocks.locator('textarea');
    await expect(textareas.nth(0)).toHaveValue('First item');
    await expect(textareas.nth(1)).toHaveValue('Second item');
    await expect(textareas.nth(2)).toHaveValue('Third item');

    if (blockType === 'numberedList') {
      // Each <ol> carries the sequential marker number rendered by the browser.
      const ols = blocks.locator('ol');
      await expect(ols.nth(0)).toHaveAttribute('start', '1');
      await expect(ols.nth(1)).toHaveAttribute('start', '2');
      await expect(ols.nth(2)).toHaveAttribute('start', '3');
    }
  }

  test('Enter on a non-empty numbered list item creates the next numbered item', async ({
    page,
  }) => {
    await assertListContinuation(page, 'Numbered', 'numberedList');
  });

  test('Enter on a non-empty bulleted list item creates the next bulleted item', async ({
    page,
  }) => {
    await assertListContinuation(page, 'Bulleted', 'bulletedList');
  });

  test('Enter on a non-empty to-do item creates the next to-do item', async ({ page }) => {
    await assertListContinuation(page, 'To-do', 'todo');
  });

  /**
   * Enter on an *empty* list item converts it to a paragraph (exits the list).
   * Without the fix, Enter on empty would create another list item; the last block's type would
   * remain 'numberedList', failing the 'paragraph' assertion.
   */
  test('Enter on an empty list item converts it to a paragraph', async ({ page }) => {
    await createFreshPage(page);
    const blockEditor = page.locator('[data-testid="block-editor"]');

    await pickFromSlashMenu(page, 'Numbered');
    await page.keyboard.type('Only item');
    // Enter on non-empty → creates a second empty numbered item (DEF-038 fix in action).
    await page.keyboard.press('Enter');
    // Wait for the layout effect to move focus to the new empty block before pressing Enter again.
    await page.waitForTimeout(300);
    // Enter on the empty second item → exits list, converts it to paragraph.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // There should still be exactly one numbered list block.
    await expect(blockEditor.locator('[data-block-type="numberedList"]')).toHaveCount(1);

    // The block that had the empty item should now be a paragraph.
    const allBlocks = blockEditor.locator('[data-block-type]');
    const lastBlock = allBlocks.last();
    await expect(lastBlock).toHaveAttribute('data-block-type', 'paragraph');
  });
});

// ---------------------------------------------------------------------------
// DEF-039: Same-type list items are visually grouped (tighter spacing)
// ---------------------------------------------------------------------------

test.describe('DEF-039: consecutive same-type list items are tighter than a type transition', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  /**
   * Creates three consecutive numbered list items followed by a paragraph. Measures:
   *   - continueGap: vertical gap between item 1 and item 2 (both numberedList → mt-0).
   *   - transitionGap: vertical gap between item 3 (numberedList) and the paragraph (mt-3 = 12 px).
   *
   * Asserts continueGap < 4 px (flush) and transitionGap >= 8 px (clearly separated).
   * Without the fix (all blocks at mt-1 = 4 px), both gaps are equal and the transition assertion
   * `transitionGap > continueGap * 2` fails.
   */
  test('same-type gap is flush (< 4 px); type-transition gap is ≥ 8 px', async ({ page }) => {
    await createFreshPage(page);

    // Build three numbered list items, then add a paragraph by picking "Text" from the slash menu
    // on the 4th (empty) numbered item. Using the slash menu here avoids a dependency on the
    // DEF-038 empty-list-exit fix; this test should gate the spacing independently.
    await pickFromSlashMenu(page, 'Numbered');
    await page.keyboard.type('Item one');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Item two');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Item three');
    // Enter on non-empty → 4th empty numbered item; wait for focus to settle there.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    // Convert the 4th block to paragraph via slash menu — reliable and independent of DEF-038.
    await pickFromSlashMenu(page, 'Text');
    await page.keyboard.type('After list');
    await page.waitForTimeout(300);

    // Measure vertical gaps using getBoundingClientRect().
    type GapResult = {
      continueGap: number;
      transitionGap: number;
    };

    const gaps = await page.evaluate((): GapResult => {
      const numbered = Array.from(
        document.querySelectorAll('[data-block-type="numberedList"]'),
      ) as HTMLElement[];
      const paragraph = document.querySelector('[data-block-type="paragraph"]') as HTMLElement;

      const r0 = numbered[0]!.getBoundingClientRect();
      const r1 = numbered[1]!.getBoundingClientRect();
      const r2 = numbered[2]!.getBoundingClientRect();
      const rP = paragraph.getBoundingClientRect();

      return {
        // Gap between consecutive list items: item-1.top - item-0.bottom
        continueGap: Math.round(r1.top - r0.bottom),
        // Gap from last list item to the following paragraph: paragraph.top - item-2.bottom
        transitionGap: Math.round(rP.top - r2.bottom),
      };
    });

    console.log(
      `DEF-039 spacing: same-type gap=${gaps.continueGap}px, type-transition gap=${gaps.transitionGap}px`,
    );

    // Same-type list continuation should be flush (mt-0 → 0 px gap).
    expect(
      gaps.continueGap,
      `Same-type list gap ${gaps.continueGap}px should be < 4 px`,
    ).toBeLessThan(4);

    // Type transition should carry the full inter-block gap (mt-3 → 12 px).
    expect(
      gaps.transitionGap,
      `Type-transition gap ${gaps.transitionGap}px should be ≥ 8 px`,
    ).toBeGreaterThanOrEqual(8);

    // The transition gap must be strictly larger than the continuation gap, making the list read
    // as one group. This is the composite assertion that fails when the fix is absent.
    expect(
      gaps.transitionGap,
      `Transition gap (${gaps.transitionGap}px) should exceed same-type gap (${gaps.continueGap}px)`,
    ).toBeGreaterThan(gaps.continueGap);
  });
});

// ---------------------------------------------------------------------------
// DEF-040: Notice toast auto-dismisses
// ---------------------------------------------------------------------------

test.describe('DEF-040: notice auto-dismisses after its lifetime', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  /**
   * Triggers the paste-clamp notice by setting the textarea value to 10 001 characters via the
   * native HTMLTextAreaElement value setter (bypasses React's synthetic tracking so React fires
   * onChange with the oversized string) then dispatching a native input event.
   *
   * Asserts the notice is visible immediately after the trigger and gone after 3 seconds.
   * Without the fix (duration: Infinity) the `not.toBeVisible()` assertion times out. With the
   * 2 000 ms duration the notice should be fully dismissed well within 3 seconds.
   */
  test('paste-clamp notice disappears on its own within 3 seconds of appearing', async ({
    page,
  }) => {
    await createFreshPage(page);

    // Click into the first textarea to give it focus.
    const firstTextarea = page.locator('[data-testid="block-editor"] textarea').first();
    await expect(firstTextarea).toBeVisible();
    await firstTextarea.click();

    // Trigger the paste-clamp notice: set 10 001 chars via the native setter so React fires
    // onChange → handleChange → clampBlockText → onNotice → notify({ duration: 2000 }).
    await page.evaluate(() => {
      const ta = document.querySelector(
        '[data-testid="block-editor"] textarea',
      ) as HTMLTextAreaElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      if (!nativeSetter) throw new Error('Could not get HTMLTextAreaElement native value setter');
      nativeSetter.call(ta, 'x'.repeat(10001));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const notice = page.locator('[data-testid="notice"]');

    // The notice must be visible shortly after the trigger.
    await expect(notice).toBeVisible({ timeout: 1500 });

    // After 3 seconds (> NOTICE_DURATION_MS=2000) the notice must have auto-dismissed without any
    // user interaction. The test takes no action between the visibility assertion and this check.
    await page.waitForTimeout(3000);
    await expect(notice).not.toBeVisible({ timeout: 500 });
  });
});
