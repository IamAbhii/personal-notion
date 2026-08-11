import { createContext, useContext } from 'react';
import type { BlockRecord, PageRecord } from '../api/types';
import type { PageMutations } from '../hooks/usePageMutations';
import type { BlockMutations } from '../hooks/useBlockMutations';

export interface WorkspaceContextValue {
  userId: string;
  workspaceId: string;
  pages: PageRecord[];
  /** Every block in the workspace, flat; a page filters to its own with `blocksForPage`. */
  blocks: BlockRecord[];
  mutations: PageMutations;
  blockMutations: BlockMutations;
  selectPage: (pageId: string) => void;
  /** Creates a page and opens it, so every create in the app lands the user on the new page. */
  createAndOpenPage: (parentId: string | null) => void;
}

/**
 * The current workspace, provided by the workspace shell and read by everything inside it. The
 * value carries the workspace id explicitly; there is deliberately no "the workspace" global.
 */
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Reads the current workspace. Throws outside the shell, which is a programming error. */
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside the workspace shell');
  return value;
}
