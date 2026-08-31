// Applies a batch of ops in client_seq order as a single D1 batch: either the whole chunk lands or
// none of it does, which is what lets the client retry a chunk safely.
import type { Db } from '../db/client';
import { runBatch, type Statement } from '../db/batch';
import { appliedOps } from '../db/schema';
import { lastInOrder, nextKeyAfter, type Ordered } from '../lib/sortKey';
import { findAppliedOps, recordAppliedOpStatement, type AppliedOpRecord } from '../repo/appliedOps';
import {
  buildBlockRow,
  deleteBlocksForPagesStatements,
  deleteBlocksStatements,
  insertBlockStatement,
  listBlockStates,
  updateBlockStatement,
  type BlockPatch,
} from '../repo/blocks';
import type { Ctx } from '../repo/context';
import {
  buildPageRow,
  deletePagesStatements,
  insertPageStatement,
  listPageStates,
  updatePageStatement,
  type PagePatch,
} from '../repo/pages';
import {
  buildPropertyRow,
  deletePropertiesForDatabasesStatements,
  deletePropertyStatement,
  insertPropertyStatement,
  listPropertyStates,
  parseOptions,
  updatePropertyStatement,
  type PropertyPatch,
} from '../repo/properties';
import {
  deleteValuesForPropertiesStatements,
  deleteValuesForRowsStatements,
  listValueStates,
  upsertValueStatement,
} from '../repo/propertyValues';
import {
  buildViewRow,
  deleteViewsForDatabasesStatements,
  deleteViewStatement,
  insertViewStatement,
  listViewStates,
  updateViewStatement,
} from '../repo/views';
import {
  MAX_PROPERTIES_PER_DATABASE,
  OPERATORS_BY_TYPE,
  payloadRejection,
  type BlockType,
  type FilterOperator,
  type Op,
  type OpResult,
  type PropertyType,
  type SelectOption,
  type VersionMismatch,
} from './ops';

// applied_ops binds 10 parameters per row, and D1 allows 100 per query, so the outcome log is
// written as multi-row inserts of at most 10 rows. Without this a 25-op chunk would need 25 extra
// statements and blow the 50-queries-per-invocation limit.
const OP_RECORDS_PER_INSERT = 10;

export type SyncOutcome = {
  results: OpResult[];
  versionMismatches: VersionMismatch[];
};

// The subset of each page the applier needs in memory: enough to check existence, compare versions,
// walk the tree for cascade deletes, detect a parent cycle and enforce kind/parent rules.
type PageState = {
  version: number;
  parentId: string | null;
  sortKey: string;
  kind: 'page' | 'database' | 'row';
};

// The same for blocks: existence, version, which page it sits on, where in that page, and the
// stored type so a block.update omitting type can still select the right props size limit.
type BlockState = { version: number; pageId: string; type: string; sortKey: string };

// What the applier needs per property: existence, version, which database it belongs to, its type
// (for value validation) and its parsed options (for select/multiSelect option id checks).
type PropertyState = {
  version: number;
  databasePageId: string;
  type: string;
  options: SelectOption[];
  sortKey: string;
};

// What the applier needs per value: the version and the stored JSON string. The value is needed so
// that a property.update removing option ids can clean up dangling select/multiSelect references
// in memory and emit the right upsert statements in the same atomic batch.
type ValueState = { version: number; value: string | null };

// What the applier needs per view: existence, version, which database it belongs to, and its sortKey
// (for the next-key-after computation when new views are appended without an explicit sortKey).
type ViewState = { version: number; databasePageId: string; sortKey: string };

// Applies ops to a workspace and returns one result per op, in the order they were given.
// Ops are re-ordered to client_seq before applying, because a later op may depend on an earlier one
// (a child created under a page created in the same chunk).
export async function applyOps(db: Db, ctx: Ctx, ops: Op[]): Promise<SyncOutcome> {
  const ordered = [...ops].sort((a, b) => a.clientSeq - b.clientSeq);
  const alreadyApplied = await findAppliedOps(
    db,
    ctx,
    ordered.map((op) => op.opId),
  );

  // Five reads - pages, blocks, properties, values and views - then every decision is made in memory.
  // Doing it per op would spend the whole D1 query budget on lookups.
  const [rows, blockRows, propRows, valueRows, viewRows] = await Promise.all([
    listPageStates(db, ctx),
    listBlockStates(db, ctx),
    listPropertyStates(db, ctx),
    listValueStates(db, ctx),
    listViewStates(db, ctx),
  ]);

  const state = new Map<string, PageState>(
    rows.map((row) => [
      row.id,
      {
        version: row.version,
        parentId: row.parentId,
        sortKey: row.sortKey,
        kind: (row.kind as 'page' | 'database' | 'row') ?? 'page',
      },
    ]),
  );
  const blockState = new Map<string, BlockState>(
    blockRows.map((row) => [
      row.id,
      { version: row.version, pageId: row.pageId, type: row.type, sortKey: row.sortKey },
    ]),
  );
  const propertyState = new Map<string, PropertyState>(
    propRows.map((row) => [
      row.id,
      {
        version: row.version,
        databasePageId: row.databasePageId,
        type: row.type,
        options: parseOptions(row.options),
        sortKey: row.sortKey,
      },
    ]),
  );
  // Value state is keyed by the derived id `${rowPageId}:${propertyId}`.
  const valueState = new Map<string, ValueState>(
    valueRows.map((row) => [
      `${row.rowPageId}:${row.propertyId}`,
      { version: row.version, value: row.value },
    ]),
  );
  const viewState = new Map<string, ViewState>(
    viewRows.map((row) => [
      row.id,
      { version: row.version, databasePageId: row.databasePageId, sortKey: row.sortKey },
    ]),
  );

  const now = Date.now();
  const dataStatements: Statement[] = [];
  const records: AppliedOpRecord[] = [];
  // Results are keyed by op object, not by opId, because one batch may legally contain the same
  // opId twice and each occurrence needs its own line in the response.
  const resultByOp = new Map<Op, OpResult>();
  const firstResultByOpId = new Map<string, OpResult>();
  const versionMismatches: VersionMismatch[] = [];

  // Stores an op's outcome, and remembers the first outcome seen for each opId so a duplicate of it
  // later in the same batch can report a replay instead of applying again.
  const record = (op: Op, result: OpResult) => {
    resultByOp.set(op, result);
    if (!firstResultByOpId.has(op.opId)) firstResultByOpId.set(op.opId, result);
  };

  const reject = (op: Op, reason: string) => {
    record(op, {
      opId: op.opId,
      status: 'rejected',
      reason,
      entityId: op.entityId,
    });
    records.push({
      opId: op.opId,
      entity: op.entity,
      entityId: op.entityId,
      type: op.type,
      status: 'rejected',
      reason,
      resultVersion: null,
      clientSeq: op.clientSeq,
    });
  };

  // version is null for a delete: the row is gone, so there is no version to report.
  const accept = (op: Op, version: number | null) => {
    record(op, {
      opId: op.opId,
      status: 'applied',
      entityId: op.entityId,
      ...(version !== null ? { version } : {}),
    });
    records.push({
      opId: op.opId,
      entity: op.entity,
      entityId: op.entityId,
      type: op.type,
      status: 'applied',
      reason: null,
      resultVersion: version,
      clientSeq: op.clientSeq,
    });
  };

  for (const op of ordered) {
    // A replayed op returns its original outcome rather than applying twice. This is what makes a
    // retry after a mobile timeout safe.
    const previous = alreadyApplied.get(op.opId);
    if (previous) {
      record(op, {
        opId: op.opId,
        status: 'replayed',
        entityId: previous.entityId,
        ...(previous.resultVersion !== null ? { version: previous.resultVersion } : {}),
        ...(previous.reason !== null ? { reason: previous.reason } : {}),
      });
      continue;
    }

    // The same opId twice inside one batch is the same idempotency case as a cross-request retry:
    // the first occurrence is applied and the rest report its outcome. Applying both would violate
    // the applied_ops primary key and take the whole batch down with it.
    const earlier = firstResultByOpId.get(op.opId);
    if (earlier) {
      resultByOp.set(op, { ...earlier, status: 'replayed' });
      continue;
    }

    // Field limits and sort-key validity are checked here rather than in the zod schema, so one bad
    // field costs the client that op and not the whole batch.
    // For block.update, pass the stored block type so the props limit is chosen from the effective
    // type (payload.type when present, stored type when the payload omits it). See ops.ts.
    const storedBlockType =
      op.type === 'block.update' ? blockState.get(op.entityId)?.type : undefined;
    const badPayload = payloadRejection(op, storedBlockType);
    if (badPayload) {
      reject(op, badPayload);
      continue;
    }

    if (op.type === 'page.create') {
      if (state.has(op.entityId)) {
        reject(op, 'page already exists');
        continue;
      }
      const parentId = op.payload.parentId ?? null;
      const kind = op.payload.kind ?? 'page';

      // An op whose target no longer exists is dropped, not resurrected: recreating a deleted
      // ancestor to host an orphan would silently undo an explicit deletion.
      if (parentId !== null && !state.has(parentId)) {
        reject(op, 'parent page no longer exists');
        continue;
      }

      // Kind/parent rules: a row must sit under a database; pages and databases must not sit under
      // a database or row. These keep the tree structure well-formed for the table view.
      if (kind === 'row') {
        if (parentId === null || state.get(parentId)?.kind !== 'database') {
          reject(op, 'a row page must have a database page as its parent');
          continue;
        }
      } else {
        if (parentId !== null) {
          const parentKind = state.get(parentId)?.kind;
          if (parentKind === 'database' || parentKind === 'row') {
            reject(op, 'a page or database cannot be parented to a database or row page');
            continue;
          }
        }
      }

      const sortKey = op.payload.sortKey ?? nextSiblingKey(state, parentId);
      const row = buildPageRow(
        ctx,
        {
          id: op.entityId,
          parentId,
          title: op.payload.title,
          icon: op.payload.icon,
          kind,
        },
        sortKey,
        now,
      );
      dataStatements.push(insertPageStatement(db, row));
      state.set(row.id, { version: row.version, parentId, sortKey, kind });
      accept(op, row.version);
      continue;
    }

    if (op.type === 'page.update') {
      const current = state.get(op.entityId);
      if (!current) {
        reject(op, 'page no longer exists');
        continue;
      }
      const patch: PagePatch = op.payload;
      if (patch.parentId !== undefined && patch.parentId !== null) {
        if (!state.has(patch.parentId)) {
          reject(op, 'parent page no longer exists');
          continue;
        }
        if (createsCycle(state, op.entityId, patch.parentId)) {
          reject(op, 'a page cannot be moved inside itself');
          continue;
        }
        // Enforce kind/parent rules on reparenting, same as page.create.
        const newParentKind = state.get(patch.parentId)?.kind;
        if (current.kind === 'row') {
          if (newParentKind !== 'database') {
            reject(op, 'a row page must have a database page as its parent');
            continue;
          }
        } else {
          if (newParentKind === 'database' || newParentKind === 'row') {
            reject(op, 'a page or database cannot be parented to a database or row page');
            continue;
          }
        }
      }
      // Future: reject on mismatch to enable optimistic concurrency. Today the policy is last write
      // wins by server arrival order, and the mismatch is reported so the client can tell the user
      // "N changes overwrote newer edits" instead of losing them silently.
      if (typeof op.baseVersion === 'number' && op.baseVersion !== current.version) {
        versionMismatches.push({
          opId: op.opId,
          entityId: op.entityId,
          baseVersion: op.baseVersion,
          serverVersion: current.version,
        });
      }
      dataStatements.push(updatePageStatement(db, ctx, op.entityId, patch, now));
      const nextVersion = current.version + 1;
      state.set(op.entityId, {
        version: nextVersion,
        parentId: patch.parentId !== undefined ? patch.parentId : current.parentId,
        sortKey: patch.sortKey ?? current.sortKey,
        kind: current.kind,
      });
      accept(op, nextVersion);
      continue;
    }

    if (op.type === 'block.create') {
      if (blockState.has(op.entityId)) {
        reject(op, 'block already exists');
        continue;
      }
      // A block on a page that is gone would be invisible and undeletable, so it is dropped rather
      // than resurrecting the page.
      if (!state.has(op.payload.pageId)) {
        reject(op, 'page no longer exists');
        continue;
      }
      const sortKey = op.payload.sortKey ?? nextBlockKey(blockState, op.payload.pageId);
      const row = buildBlockRow(
        ctx,
        {
          id: op.entityId,
          pageId: op.payload.pageId,
          // Checked by payloadRejection above, so the cast narrows rather than assumes.
          type: op.payload.type as BlockType,
          text: op.payload.text,
          checked: op.payload.checked,
          props: op.payload.props,
        },
        sortKey,
        now,
      );
      dataStatements.push(insertBlockStatement(db, row));
      blockState.set(row.id, { version: row.version, pageId: row.pageId, type: row.type, sortKey });
      accept(op, row.version);
      continue;
    }

    if (op.type === 'block.update') {
      const current = blockState.get(op.entityId);
      if (!current) {
        reject(op, 'block no longer exists');
        continue;
      }
      // Built field by field rather than spread, because the payload also carries pageId, which
      // payloadRejection has already refused and which must never reach the update statement.
      const patch: BlockPatch = {
        ...(op.payload.type !== undefined ? { type: op.payload.type } : {}),
        ...(op.payload.text !== undefined ? { text: op.payload.text } : {}),
        ...(op.payload.checked !== undefined ? { checked: op.payload.checked } : {}),
        ...(op.payload.props !== undefined ? { props: op.payload.props } : {}),
        ...(op.payload.sortKey !== undefined ? { sortKey: op.payload.sortKey } : {}),
      };
      // Future: reject on mismatch to enable optimistic concurrency. Today the policy is last write
      // wins by server arrival order, and the mismatch is reported so the client can tell the user.
      if (typeof op.baseVersion === 'number' && op.baseVersion !== current.version) {
        versionMismatches.push({
          opId: op.opId,
          entityId: op.entityId,
          baseVersion: op.baseVersion,
          serverVersion: current.version,
        });
      }
      dataStatements.push(updateBlockStatement(db, ctx, op.entityId, patch, now));
      const nextVersion = current.version + 1;
      blockState.set(op.entityId, {
        version: nextVersion,
        pageId: current.pageId,
        type: patch.type ?? current.type,
        sortKey: patch.sortKey ?? current.sortKey,
      });
      accept(op, nextVersion);
      continue;
    }

    if (op.type === 'block.delete') {
      if (!blockState.has(op.entityId)) {
        reject(op, 'block no longer exists');
        continue;
      }
      dataStatements.push(...deleteBlocksStatements(db, ctx, [op.entityId]));
      blockState.delete(op.entityId);
      accept(op, null);
      continue;
    }

    if (op.type === 'property.create') {
      if (propertyState.has(op.entityId)) {
        reject(op, 'property already exists');
        continue;
      }
      const { databasePageId, name, type, options, sortKey: suppliedKey } = op.payload;
      const dbPage = state.get(databasePageId);
      if (!dbPage || dbPage.kind !== 'database') {
        reject(op, 'databasePageId is not a database page');
        continue;
      }
      const existing = countPropertiesForDatabase(propertyState, databasePageId);
      if (existing >= MAX_PROPERTIES_PER_DATABASE) {
        reject(op, `database has reached the limit of ${MAX_PROPERTIES_PER_DATABASE} properties`);
        continue;
      }
      const sortKey = suppliedKey ?? nextPropertyKey(propertyState, databasePageId);
      // Trim the name and each option name on write: "  Status  " and "Status" must not coexist,
      // and leading/trailing whitespace has no meaning in a column header or chip label.
      const trimmedOptions = options?.map((o) => ({ ...o, name: o.name.trim() }));
      const row = buildPropertyRow(
        ctx,
        {
          id: op.entityId,
          databasePageId,
          name: name.trim(),
          // payloadRejection already confirmed this is one of the seven PropertyType values, so
          // the cast is safe rather than defensive.
          type: type as PropertyType,
          options: trimmedOptions as SelectOption[] | undefined,
        },
        sortKey,
        now,
      );
      dataStatements.push(insertPropertyStatement(db, row));
      propertyState.set(row.id, {
        version: row.version,
        databasePageId,
        type,
        options: parseOptions(row.options),
        sortKey,
      });
      accept(op, row.version);
      continue;
    }

    if (op.type === 'property.update') {
      const current = propertyState.get(op.entityId);
      if (!current) {
        reject(op, 'property no longer exists');
        continue;
      }
      const { name, options, sortKey } = op.payload;
      // Trim the name and option names on write, consistent with property.create.
      const trimmedName = name !== undefined ? name.trim() : undefined;
      const trimmedOptions = options?.map((o) => ({ ...o, name: o.name.trim() }));
      const patch: PropertyPatch = {
        ...(trimmedName !== undefined ? { name: trimmedName } : {}),
        ...(trimmedOptions !== undefined ? { options: trimmedOptions as SelectOption[] } : {}),
        ...(sortKey !== undefined ? { sortKey } : {}),
      };
      // Future: reject on mismatch to enable optimistic concurrency. Same last-write-wins policy as
      // page.update and block.update.
      if (typeof op.baseVersion === 'number' && op.baseVersion !== current.version) {
        versionMismatches.push({
          opId: op.opId,
          entityId: op.entityId,
          baseVersion: op.baseVersion,
          serverVersion: current.version,
        });
      }
      dataStatements.push(updatePropertyStatement(db, ctx, op.entityId, patch, now));
      const nextVersion = current.version + 1;
      const updatedOptions =
        trimmedOptions !== undefined ? (trimmedOptions as SelectOption[]) : current.options;
      propertyState.set(op.entityId, {
        version: nextVersion,
        databasePageId: current.databasePageId,
        type: current.type,
        options: updatedOptions,
        sortKey: sortKey ?? current.sortKey,
      });

      // When options are changed on a select or multiSelect property, remove any cell values that
      // reference option ids no longer present in the new list. This prevents dangling references
      // that the UI cannot display or clear. The same atomic batch carries both the property update
      // and the value cleanups, so the data is always consistent.
      // Future: this could be extended to warn the client which rows were affected.
      if (
        trimmedOptions !== undefined &&
        (current.type === 'select' || current.type === 'multiSelect')
      ) {
        const newOptionIds = new Set(trimmedOptions.map((o) => o.id));
        const removedIds = new Set(
          current.options.filter((o) => !newOptionIds.has(o.id)).map((o) => o.id),
        );
        if (removedIds.size > 0) {
          clearDanglingOptionValues(
            db,
            ctx,
            op.entityId,
            current.type,
            removedIds,
            valueState,
            dataStatements,
            now,
          );
        }
      }

      accept(op, nextVersion);
      continue;
    }

    if (op.type === 'property.delete') {
      const current = propertyState.get(op.entityId);
      if (!current) {
        reject(op, 'property no longer exists');
        continue;
      }
      // Delete the property's values before the property itself; both go into the same batch.
      dataStatements.push(...deleteValuesForPropertiesStatements(db, ctx, [op.entityId]));
      dataStatements.push(deletePropertyStatement(db, ctx, op.entityId));
      // Remove affected values from the in-memory state.
      for (const key of valueState.keys()) {
        if (key.endsWith(`:${op.entityId}`)) valueState.delete(key);
      }
      propertyState.delete(op.entityId);
      accept(op, null);
      continue;
    }

    if (op.type === 'value.set') {
      const { rowPageId, propertyId, value } = op.payload;
      const rowPage = state.get(rowPageId);
      if (!rowPage || rowPage.kind !== 'row') {
        reject(op, 'rowPageId is not a row page');
        continue;
      }
      const prop = propertyState.get(propertyId);
      if (!prop) {
        reject(op, 'property no longer exists');
        continue;
      }
      // A value for a property that belongs to a different database than this row's database would
      // be unreachable and confusing, so it is refused.
      if (prop.databasePageId !== rowPage.parentId) {
        reject(op, "propertyId does not belong to this row's database");
        continue;
      }
      // Validate the JSON value against the property's type. null always means "clear the cell".
      if (value !== null) {
        const typeError = validateValue(prop.type, value, prop.options);
        if (typeError) {
          reject(op, typeError);
          continue;
        }
      }
      // entityId for value.set is the derived composite key, not a UUID.
      const entityId = `${rowPageId}:${propertyId}`;
      const existing = valueState.get(entityId);
      const nextVersion = existing ? existing.version + 1 : 1;
      dataStatements.push(
        upsertValueStatement(db, ctx, rowPageId, propertyId, value, nextVersion, now),
      );
      valueState.set(entityId, { version: nextVersion, value });
      // Future: reject on mismatch to enable optimistic concurrency. Same policy as other entity types.
      if (typeof op.baseVersion === 'number' && existing && op.baseVersion !== existing.version) {
        versionMismatches.push({
          opId: op.opId,
          entityId,
          baseVersion: op.baseVersion,
          serverVersion: existing.version,
        });
      }
      accept(op, nextVersion);
      continue;
    }

    if (op.type === 'view.create') {
      if (viewState.has(op.entityId)) {
        reject(op, 'view already exists');
        continue;
      }
      const {
        databasePageId,
        name,
        kind,
        groupPropertyId,
        filters,
        sort,
        sortKey: suppliedKey,
      } = op.payload;

      // databasePageId must be an existing database page in this workspace.
      const dbPage = state.get(databasePageId);
      if (!dbPage || dbPage.kind !== 'database') {
        reject(op, 'databasePageId is not a database page');
        continue;
      }

      // groupPropertyId, when non-null, must be a select property of that same database.
      if (groupPropertyId) {
        const gProp = propertyState.get(groupPropertyId);
        if (!gProp || gProp.databasePageId !== databasePageId) {
          reject(op, 'groupPropertyId is not a property of the specified database');
          continue;
        }
        if (gProp.type !== 'select') {
          reject(op, 'groupPropertyId must be a select property');
          continue;
        }
      }

      // Validate each filter: propertyId must belong to the database, operator must be legal for
      // its property type. Filtering and grouping are computed client-side; the server validates only.
      if (filters) {
        const filterError = validateViewFilters(filters, databasePageId, propertyState);
        if (filterError) {
          reject(op, filterError);
          continue;
        }
      }

      // sort.propertyId must be 'title' or a property of the database; direction already validated
      // structurally in payloadRejection.
      if (sort) {
        const sortError = validateViewSort(sort, databasePageId, propertyState);
        if (sortError) {
          reject(op, sortError);
          continue;
        }
      }

      const sortKey = suppliedKey ?? nextViewKey(viewState, databasePageId);
      const row = buildViewRow(
        ctx,
        {
          id: op.entityId,
          databasePageId,
          name: name.trim(),
          kind,
          groupPropertyId: groupPropertyId ?? null,
          filters: JSON.stringify(filters ?? []),
          sort: sort ? JSON.stringify(sort) : null,
        },
        sortKey,
        now,
      );
      dataStatements.push(insertViewStatement(db, row));
      viewState.set(row.id, { version: row.version, databasePageId, sortKey });
      accept(op, row.version);
      continue;
    }

    if (op.type === 'view.update') {
      const current = viewState.get(op.entityId);
      if (!current) {
        reject(op, 'view no longer exists');
        continue;
      }

      // groupPropertyId validation: same rules as view.create when a non-null value is provided.
      const { groupPropertyId, filters, sort, sortKey, name } = op.payload;
      if (groupPropertyId !== undefined && groupPropertyId !== null) {
        const gProp = propertyState.get(groupPropertyId);
        if (!gProp || gProp.databasePageId !== current.databasePageId) {
          reject(op, "groupPropertyId is not a property of this view's database");
          continue;
        }
        if (gProp.type !== 'select') {
          reject(op, 'groupPropertyId must be a select property');
          continue;
        }
      }

      if (filters !== undefined) {
        const filterError = validateViewFilters(filters, current.databasePageId, propertyState);
        if (filterError) {
          reject(op, filterError);
          continue;
        }
      }

      if (sort !== undefined && sort !== null) {
        const sortError = validateViewSort(sort, current.databasePageId, propertyState);
        if (sortError) {
          reject(op, sortError);
          continue;
        }
      }

      // Future: reject on mismatch to enable optimistic concurrency; same last-write-wins policy as
      // other entity types.
      if (typeof op.baseVersion === 'number' && op.baseVersion !== current.version) {
        versionMismatches.push({
          opId: op.opId,
          entityId: op.entityId,
          baseVersion: op.baseVersion,
          serverVersion: current.version,
        });
      }

      const nextVersion = current.version + 1;
      const patch = {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(Object.prototype.hasOwnProperty.call(op.payload, 'groupPropertyId')
          ? { groupPropertyId: groupPropertyId ?? null }
          : {}),
        ...(filters !== undefined ? { filters: JSON.stringify(filters) } : {}),
        ...(Object.prototype.hasOwnProperty.call(op.payload, 'sort')
          ? { sort: sort ? JSON.stringify(sort) : null }
          : {}),
        ...(sortKey !== undefined ? { sortKey } : {}),
        version: nextVersion,
      };
      dataStatements.push(updateViewStatement(db, ctx, op.entityId, patch, now));
      viewState.set(op.entityId, {
        version: nextVersion,
        databasePageId: current.databasePageId,
        sortKey: sortKey ?? current.sortKey,
      });
      accept(op, nextVersion);
      continue;
    }

    if (op.type === 'view.delete') {
      if (!viewState.has(op.entityId)) {
        reject(op, 'view no longer exists');
        continue;
      }
      dataStatements.push(deleteViewStatement(db, ctx, op.entityId));
      viewState.delete(op.entityId);
      accept(op, null);
      continue;
    }

    // page.delete: remove the page plus its whole subtree (blocks, properties, values, views) in one batch.
    if (!state.has(op.entityId)) {
      reject(op, 'page no longer exists');
      continue;
    }
    const ids = subtreeIds(state, op.entityId);
    dataStatements.push(...deletePagesStatements(db, ctx, ids));

    // Cascade blocks: blocks for every deleted page go in the same batch.
    const deletedPageIds = new Set(ids);
    const pagesWithBlocks = new Set<string>();
    for (const [blockId, block] of blockState) {
      if (!deletedPageIds.has(block.pageId)) continue;
      pagesWithBlocks.add(block.pageId);
      blockState.delete(blockId);
    }
    if (pagesWithBlocks.size > 0) {
      dataStatements.push(...deleteBlocksForPagesStatements(db, ctx, [...pagesWithBlocks]));
    }

    // Cascade properties: remove the property definitions for any deleted database pages.
    const deletedDatabaseIds = ids.filter((id) => state.get(id)?.kind === 'database');
    if (deletedDatabaseIds.length > 0) {
      // Track which properties are being deleted so their values can be cleared from in-memory state.
      const deletedPropIds: string[] = [];
      for (const [propId, prop] of propertyState) {
        if (deletedDatabaseIds.includes(prop.databasePageId)) {
          deletedPropIds.push(propId);
          propertyState.delete(propId);
        }
      }
      dataStatements.push(...deletePropertiesForDatabasesStatements(db, ctx, deletedDatabaseIds));

      // Cascade views: remove all views for any deleted database pages.
      for (const [viewId, view] of viewState) {
        if (deletedDatabaseIds.includes(view.databasePageId)) viewState.delete(viewId);
      }
      dataStatements.push(...deleteViewsForDatabasesStatements(db, ctx, deletedDatabaseIds));
    }

    // Cascade property values: remove the cell values for any deleted row pages (including rows
    // that belonged to a deleted database, which are already in the subtree via their parentId).
    const deletedRowIds = ids.filter((id) => state.get(id)?.kind === 'row');
    if (deletedRowIds.length > 0) {
      const deletedRowSet = new Set(deletedRowIds);
      for (const key of valueState.keys()) {
        const [rowPageId] = key.split(':');
        if (rowPageId && deletedRowSet.has(rowPageId)) valueState.delete(key);
      }
      dataStatements.push(...deleteValuesForRowsStatements(db, ctx, deletedRowIds));
    }

    for (const id of ids) state.delete(id);
    accept(op, null);
  }

  // The data writes and the idempotency log go into one batch, so the log can never disagree with
  // the data D1 actually holds.
  const recordStatements: Statement[] = [];
  for (let i = 0; i < records.length; i += OP_RECORDS_PER_INSERT) {
    const chunk = records.slice(i, i + OP_RECORDS_PER_INSERT);
    recordStatements.push(recordAppliedOpsStatement(db, ctx, chunk));
  }
  await runBatch(db, [...dataStatements, ...recordStatements]);

  return {
    results: ops.map(
      (op) => resultByOp.get(op) ?? { opId: op.opId, status: 'rejected', reason: 'unknown' },
    ),
    versionMismatches,
  };
}

// Multi-row insert of op outcomes. Falls back to the single-row builder for a chunk of one so there
// is one code path for the common case of a single op.
function recordAppliedOpsStatement(db: Db, ctx: Ctx, chunk: AppliedOpRecord[]): Statement {
  const [first] = chunk;
  if (chunk.length === 1 && first) return recordAppliedOpStatement(db, ctx, first);
  const appliedAt = Date.now();
  return db.insert(appliedOps).values(
    chunk.map((record) => ({
      opId: record.opId,
      workspaceId: ctx.workspaceId,
      entity: record.entity,
      entityId: record.entityId,
      type: record.type,
      status: record.status,
      reason: record.reason,
      resultVersion: record.resultVersion,
      clientSeq: record.clientSeq,
      appliedAt,
    })),
  );
}

// The next fractional sort_key after the last child of parentId, computed from projected state so a
// chunk that creates several siblings orders them correctly without re-reading the database. "Last"
// is decided by lastInOrder, the same (sort_key, id) order the reads use, so the key returned is a
// genuine upper bound on the siblings even when two of them share a key (DEF-016).
function nextSiblingKey(state: Map<string, PageState>, parentId: string | null): string {
  const siblings = ordered(state, (page) => page.parentId === parentId);
  return nextKeyAfter(lastInOrder(siblings)?.sortKey ?? null);
}

// The next fractional sort_key after the last block of pageId, computed from projected state so a
// chunk that appends several blocks to one page orders them correctly without re-reading the database.
// Same (sort_key, id) notion of "last" as nextSiblingKey.
function nextBlockKey(state: Map<string, BlockState>, pageId: string): string {
  const onPage = ordered(state, (block) => block.pageId === pageId);
  return nextKeyAfter(lastInOrder(onPage)?.sortKey ?? null);
}

// The next fractional sort_key after the last property of databasePageId, for append-when-omitted.
function nextPropertyKey(state: Map<string, PropertyState>, databasePageId: string): string {
  const forDb = ordered(state, (prop) => prop.databasePageId === databasePageId);
  return nextKeyAfter(lastInOrder(forDb)?.sortKey ?? null);
}

// The next fractional sort_key after the last view of databasePageId, for append-when-omitted.
function nextViewKey(state: Map<string, ViewState>, databasePageId: string): string {
  const forDb = ordered(state, (view) => view.databasePageId === databasePageId);
  return nextKeyAfter(lastInOrder(forDb)?.sortKey ?? null);
}

// How many properties currently exist for a given database, from in-memory projected state.
function countPropertiesForDatabase(
  state: Map<string, PropertyState>,
  databasePageId: string,
): number {
  let count = 0;
  for (const prop of state.values()) {
    if (prop.databasePageId === databasePageId) count += 1;
  }
  return count;
}

// The matching entries of a projected state map as Ordered rows, pairing each row's sort_key with the
// id the map is keyed by so the tiebreak has something to compare.
function ordered<T extends { sortKey: string }>(
  state: Map<string, T>,
  matches: (row: T) => boolean,
): Ordered[] {
  const rows: Ordered[] = [];
  for (const [id, row] of state) {
    if (matches(row)) rows.push({ id, sortKey: row.sortKey });
  }
  return rows;
}

// The page plus every descendant, from projected state, so a delete cascades over children created
// earlier in the same chunk.
function subtreeIds(state: Map<string, PageState>, rootId: string): string[] {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i += 1) {
    const parentId = ids[i];
    for (const [id, page] of state) {
      if (page.parentId === parentId) ids.push(id);
    }
  }
  return ids;
}

// True when moving pageId under newParentId would make the tree cyclic.
function createsCycle(state: Map<string, PageState>, pageId: string, newParentId: string): boolean {
  let cursor: string | null = newParentId;
  while (cursor !== null) {
    if (cursor === pageId) return true;
    cursor = state.get(cursor)?.parentId ?? null;
  }
  return false;
}

// Finds all value rows for a given property whose stored option id(s) reference any of the removed
// ids, and emits upsert statements to clear or filter them in the same batch as the property update.
// For select: any value equal to a removed id becomes null.
// For multiSelect: removed ids are dropped from the array; an array that empties becomes null.
// The in-memory valueState is updated so later ops in the same chunk see the corrected state.
function clearDanglingOptionValues(
  db: Db,
  ctx: Ctx,
  propertyId: string,
  type: string,
  removedIds: Set<string>,
  valueState: Map<string, ValueState>,
  dataStatements: Statement[],
  now: number,
): void {
  for (const [key, vs] of valueState) {
    if (vs.value === null) continue;
    // Key format is `${rowPageId}:${propertyId}`; UUIDs never contain ':'.
    const colonIdx = key.indexOf(':');
    if (colonIdx === -1 || key.slice(colonIdx + 1) !== propertyId) continue;
    const rowPageId = key.slice(0, colonIdx);

    let newValue: string | null;
    try {
      const parsed: unknown = JSON.parse(vs.value);
      if (type === 'select') {
        // A select value is a plain option id string; clear it if it is a removed id.
        if (typeof parsed !== 'string' || !removedIds.has(parsed)) continue;
        newValue = null;
      } else {
        // multiSelect: filter the removed ids from the array.
        if (!Array.isArray(parsed)) continue;
        const kept = parsed.filter(
          (id): id is string => typeof id === 'string' && !removedIds.has(id),
        );
        if (kept.length === parsed.length) continue; // nothing removed, skip
        newValue = kept.length === 0 ? null : JSON.stringify(kept);
      }
    } catch {
      continue; // malformed stored value; leave it alone
    }

    const nextVersion = vs.version + 1;
    dataStatements.push(
      upsertValueStatement(db, ctx, rowPageId, propertyId, newValue, nextVersion, now),
    );
    valueState.set(key, { version: nextVersion, value: newValue });
  }
}

// Validates that each filter's propertyId belongs to the given database and its operator is legal
// for the property's type. Returns a rejection reason or null when all filters are valid.
// Filtering is computed client-side; this validates settings only, not the resulting row set.
function validateViewFilters(
  filters: Array<{ id: string; propertyId: string; operator: string; value: string | null }>,
  databasePageId: string,
  propertyState: Map<string, PropertyState>,
): string | null {
  for (const f of filters) {
    const prop = propertyState.get(f.propertyId);
    if (!prop) return `filter propertyId ${f.propertyId} does not exist`;
    if (prop.databasePageId !== databasePageId) {
      return `filter propertyId ${f.propertyId} does not belong to the specified database`;
    }
    const allowed = OPERATORS_BY_TYPE[prop.type];
    if (!allowed || !allowed.includes(f.operator as FilterOperator)) {
      return `operator "${f.operator}" is not valid for property type "${prop.type}"`;
    }
  }
  return null;
}

// Validates that a sort's propertyId is either the literal 'title' or a property of the database.
// Returns a rejection reason or null when the sort is valid.
function validateViewSort(
  sort: { propertyId: string; direction: string },
  databasePageId: string,
  propertyState: Map<string, PropertyState>,
): string | null {
  if (sort.propertyId === 'title') return null;
  const prop = propertyState.get(sort.propertyId);
  if (!prop) return `sort propertyId ${sort.propertyId} does not exist`;
  if (prop.databasePageId !== databasePageId) {
    return `sort propertyId ${sort.propertyId} does not belong to the specified database`;
  }
  return null;
}

// Checks that a JSON-encoded value matches the expected property type. Returns a rejection reason
// string or null when the value is valid. The caller guarantees value is not null (null = clear).
function validateValue(type: string, value: string, options: SelectOption[]): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return 'value is not valid JSON';
  }

  switch (type) {
    case 'text':
    case 'url':
      if (typeof parsed !== 'string') return `value for type ${type} must be a string`;
      break;
    case 'number':
      if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
        return 'value for type number must be a finite number';
      }
      break;
    case 'select':
      if (typeof parsed !== 'string') return 'value for type select must be an option id string';
      if (!options.some((o) => o.id === parsed)) {
        return 'select value references an unknown option id';
      }
      break;
    case 'multiSelect':
      if (!Array.isArray(parsed)) return 'value for type multiSelect must be an array';
      for (const item of parsed) {
        if (typeof item !== 'string') return 'multiSelect value items must be strings';
        if (!options.some((o) => o.id === item)) {
          return 'multiSelect value references an unknown option id';
        }
      }
      break;
    case 'date':
      if (typeof parsed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
        return 'value for type date must be a YYYY-MM-DD string';
      }
      break;
    case 'checkbox':
      if (typeof parsed !== 'boolean') return 'value for type checkbox must be a boolean';
      break;
    default:
      break;
  }
  return null;
}
