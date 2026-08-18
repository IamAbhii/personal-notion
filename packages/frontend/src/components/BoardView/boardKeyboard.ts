/**
 * Board keyboard-drag utilities extracted from BoardView.tsx so the component file exports only
 * React components (react-refresh/only-export-components requires this separation).
 */

import { KeyboardCode, closestCenter, pointerWithin } from '@dnd-kit/core';
import type { CollisionDetection, KeyboardCoordinateGetter } from '@dnd-kit/core';
import type { BoardColumn } from '../../lib/viewData';

// ── Keyboard coordinate getter ────────────────────────────────────────────────

/**
 * Factory for the board keyboard coordinate getter. Closing over `columns` lets the getter
 * find the card's source column when `over` is null at the start of a keyboard drag — the
 * original module-level getter fell back to sorted[0] (the leftmost column) instead of starting
 * from the card's actual column, so ArrowRight on a card in column 0 produced a no-op (DEF-077).
 *
 * ArrowLeft/ArrowRight navigate between adjacent columns; other keys are passed through to the
 * default sensor. Returns the centre of the target column's droppable rect.
 */
export function createBoardKeyboardCoordinates(columns: BoardColumn[]): KeyboardCoordinateGetter {
  return (event, { active, context }) => {
    if (event.code !== KeyboardCode.Right && event.code !== KeyboardCode.Left) return;
    event.preventDefault();

    const { droppableContainers, droppableRects, over } = context;

    // Collect all droppable entries that have a known rect, sorted left-to-right by centre x.
    const sorted = [...droppableContainers.values()]
      .map((container) => {
        const rect = droppableRects.get(container.id);
        if (!rect) return null;
        return {
          id: container.id,
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .sort((a, b) => a.cx - b.cx);

    if (sorted.length === 0) return;

    let currentIndex = sorted.findIndex((d) => d.id === over?.id);

    if (currentIndex === -1) {
      // No column targeted yet (over is null at the start of a keyboard drag). Find which column
      // the dragged card lives in and use that as the origin so the first arrow key moves to an
      // adjacent column rather than the absolute first column (DEF-077).
      const activeId = String(active);
      const sourceColumn = columns.find((c) => c.rows.some((r) => r.id === activeId));
      const sourceDroppableId = sourceColumn?.optionId ?? 'uncat';
      currentIndex = sorted.findIndex((d) => String(d.id) === sourceDroppableId);
    }

    if (currentIndex === -1) {
      // Source column still not found (unusual) — navigate to the first column as a safe fallback.
      const first = sorted[0];
      if (!first) return;
      return { x: first.cx, y: first.cy };
    }

    const delta = event.code === KeyboardCode.Right ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(sorted.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) return;
    const next = sorted[nextIndex];
    if (!next) return;
    return { x: next.cx, y: next.cy };
  };
}

// ── Collision detection ───────────────────────────────────────────────────────

/**
 * Hybrid collision detection for the board view.
 *
 * During pointer/touch drags `pointerWithin` is used so the drop target is determined by where
 * the cursor is rather than the overlay card rectangle (DEF-075).
 *
 * During keyboard drags `pointerCoordinates` is null because the keyboard sensor produces no
 * pointer events. `pointerWithin` always returns the source column in that case (since the last
 * known pointer position is inside the drag-start column), so we fall back to `closestCenter`
 * which uses the translated `collisionRect` that the keyboard coordinate getter does update to
 * the target column's centre (DEF-077).
 */
export const boardCollisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    return pointerWithin(args);
  }
  return closestCenter(args);
};
