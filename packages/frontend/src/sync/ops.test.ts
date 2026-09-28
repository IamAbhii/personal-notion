import { afterEach, describe, expect, it } from 'vitest';
import { isLeaving, readStashedOps, stashOps } from './ops';

// Covers the storage utility functions in ops.ts that the pageOps test does not exercise.

afterEach(() => {
  localStorage.clear();
});

describe('readStashedOps', () => {
  it('returns an empty array when localStorage has no pending ops key', () => {
    expect(readStashedOps()).toEqual([]);
  });

  it('returns the stashed ops when they exist in localStorage', () => {
    // Build a minimal op payload and stash it.
    const fakeProp = {
      opId: 'op-1',
      workspaceId: 'ws-1',
      entity: 'page',
      entityId: 'page-1',
      type: 'page.delete',
      baseVersion: 1,
      payload: {},
      clientSeq: 1,
      createdAt: 1,
    };
    localStorage.setItem('personal-space:pendingOps', JSON.stringify([fakeProp]));
    expect(readStashedOps()).toHaveLength(1);
  });

  it('returns an empty array when localStorage contains malformed JSON (catch path)', () => {
    // Malformed JSON triggers JSON.parse to throw; the catch block returns [] instead of crashing.
    localStorage.setItem('personal-space:pendingOps', 'not-valid-json');
    expect(readStashedOps()).toEqual([]);
  });

  it('returns an empty array when the stored value is not an array', () => {
    localStorage.setItem('personal-space:pendingOps', JSON.stringify({ ops: [] }));
    expect(readStashedOps()).toEqual([]);
  });
});

describe('stashOps', () => {
  it('appends ops to an existing stash', () => {
    const op1 = {
      opId: 'a',
      workspaceId: 'ws',
      entity: 'page',
      entityId: 'p1',
      type: 'page.delete',
      baseVersion: 1,
      payload: {},
      clientSeq: 1,
      createdAt: 1,
    };
    const op2 = {
      opId: 'b',
      workspaceId: 'ws',
      entity: 'page',
      entityId: 'p2',
      type: 'page.delete',
      baseVersion: 1,
      payload: {},
      clientSeq: 2,
      createdAt: 2,
    };
    stashOps([op1 as never]);
    stashOps([op2 as never]);
    expect(readStashedOps()).toHaveLength(2);
  });
});

describe('isLeaving', () => {
  it('returns false before any unload event fires', () => {
    // The module-level `leaving` starts false; this just confirms the default.
    expect(isLeaving()).toBe(false);
  });
});
