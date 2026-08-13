// D1 has no interactive transactions: atomicity comes from db.batch([...]), which applies an array
// of statements as a unit. Every multi-statement write in the product goes through this helper.
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from './client';

export type Statement = BatchItem<'sqlite'>;

// Runs statements as one atomic D1 batch. Empty batches are skipped because D1 rejects them, which
// keeps callers free of "did I build any statements" guards.
export async function runBatch(db: Db, statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [Statement, ...Statement[]]);
}
