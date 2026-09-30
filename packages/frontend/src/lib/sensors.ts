import type { PointerEvent } from 'react';
import { PointerSensor } from '@dnd-kit/core';
import type { PointerSensorOptions } from '@dnd-kit/core';

/**
 * A PointerSensor subclass that only activates for mouse and pen pointers
 * (event.pointerType !== 'touch'). This lets it coexist with TouchSensor so
 * each input type gets its own activation constraint:
 *
 *   - Mouse/pen: activates after 4 px of movement via this sensor's onPointerDown.
 *   - Touch: activates after a 200 ms hold via TouchSensor, giving the browser time
 *     to decide the gesture is a drag rather than a scroll.
 *
 * Why not use MouseSensor?
 * MouseSensor listens for 'mousedown'. Radix DropdownMenu.Trigger calls
 * preventDefault() on 'pointerdown' when it opens; per the pointer-events spec
 * that suppresses the compatibility 'mousedown' that would follow, so MouseSensor
 * never fires on the combined drag-handle / dropdown-trigger button in BlockRow.
 * PointerSensor's 'onPointerDown' activator is fired before the compatibility
 * event is synthesised, so it is not affected by that preventDefault.
 *
 * // Future: @dnd-kit/core v2 ships PointerSensor.configure({ activationConstraints })
 * // that accepts a function keyed by pointerType, expressing this natively. When the
 * // project migrates to that version, this subclass can be removed and replaced with
 * // a single PointerSensor.configure() call.
 */
export class MouseCompatPointerSensor extends PointerSensor {
  static override activators: (typeof PointerSensor.activators)[number][] = [
    {
      eventName: 'onPointerDown' as const,
      handler: (
        { nativeEvent: event }: PointerEvent,
        { onActivation }: PointerSensorOptions,
      ): boolean => {
        // Decline touch pointers so TouchSensor handles them instead.
        if (event.pointerType === 'touch') {
          return false;
        }
        // Reproduce the stock PointerSensor checks: primary pointer, left button.
        if (!event.isPrimary || event.button !== 0) {
          return false;
        }
        onActivation?.({ event });
        return true;
      },
    },
  ];
}
