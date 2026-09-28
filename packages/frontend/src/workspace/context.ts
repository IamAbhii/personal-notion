import { createContext, useContext } from 'react';
import type {
  BlockRecord,
  PageRecord,
  PropertyRecord,
  PropertyValueRecord,
  ViewRecord,
} from '../api/types';
import type { PageMutations } from '../hooks/usePageMutations';
import type { BlockMutations } from '../hooks/useBlockMutations';
import type { PropertyMutations } from '../hooks/usePropertyMutations';
import type { ViewMutations } from '../hooks/useViewMutations';

export interface WorkspaceContextValue {
  userId: string;
  workspaceId: string;
  pages: PageRecord[];
  /** Every block in the workspace, flat; a page filters to its own with `blocksForPage`. */
  blocks: BlockRecord[];
  /** All properties for every database in this workspace. */
  properties: PropertyRecord[];
  /** All property values for every row in this workspace. */
  values: PropertyValueRecord[];
  /** All views for every database in this workspace. Absent on a pre-Phase-4 server returns []. */
  views: ViewRecord[];
  mutations: PageMutations;
  blockMutations: BlockMutations;
  propertyMutations: PropertyMutations;
  viewMutations: ViewMutations;
  selectPage: (pageId: string) => void;
  /** Posts a message to the notice stack - anything the app has to tell the user about a write. */
  notify: (message: string) => void;
  /** Creates a page and opens it, so every create in the app lands the user on the new page. */
  createAndOpenPage: (parentId: string | null) => void;
  /** Creates a database, mints its three default views, and opens it. */
  createAndOpenDatabase: (parentId: string | null) => void;
  /** Creates a row inside a database and opens its row page. */
  createAndOpenRow: (databasePageId: string) => void;
  /**
   * Creates a row inside a database without navigating away from the table. Returns the new row's
   * id so the table can switch the title cell into inline rename mode (ADV-044).
   */
  createRowInPlace: (databasePageId: string) => Promise<string | null>;
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
