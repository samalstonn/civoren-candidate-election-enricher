/**
 * Atomic audit-blob writes via Postgres `jsonb_set`.
 *
 * The pipeline runs general + contact tracks in parallel. Doing read-modify-
 * write in JS — read the full audit, merge in JS, write the full audit —
 * loses updates when both tracks race: each reads the same snapshot, each
 * writes back its own track-mutation on top of the OTHER track's stale data.
 *
 * These helpers move the merge into the database with `jsonb_set` so each
 * statement touches only its own JSON path. Concurrent updates to different
 * paths don't interfere.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface AuditStore {
  /** Unquoted table name, e.g. `EnrichmentRecord`. */
  table: string;
  /** Unquoted JSON column name, e.g. `matchAuditJson`. */
  jsonCol: string;
  /** Unquoted mirror status column (or null if not applicable). */
  statusCol: string | null;
  /** Equality predicates on the primary key. Each `{col, value}` becomes `"col" = $value` in SQL. */
  where: { col: string; value: string | number }[];
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(id: string): string {
  if (!IDENT_RE.test(id)) {
    throw new Error(`atomicAudit: unsafe identifier ${JSON.stringify(id)}`);
  }
  return `"${id}"`;
}

function whereSql(where: AuditStore["where"]): Prisma.Sql {
  return Prisma.join(
    where.map((w) => Prisma.sql`${Prisma.raw(quoteIdent(w.col))} = ${w.value}`),
    " AND "
  );
}

/**
 * Atomically merge `patch` into `audit[track]` via `jsonb_set` + jsonb-concat.
 *
 *   audit[track] = COALESCE(audit[track], {"status":"not_started"}) || patch
 *
 * Two concurrent calls — one for `general`, one for `contact` — never collide
 * because each writes a different JSON path.
 */
export async function setTrackAtomic(
  store: AuditStore,
  track: string,
  patch: Record<string, unknown>
): Promise<void> {
  const tbl = Prisma.raw(quoteIdent(store.table));
  const col = Prisma.raw(quoteIdent(store.jsonCol));
  const patchJson = JSON.stringify(patch);
  await prisma.$executeRaw`
    UPDATE ${tbl}
    SET ${col} = jsonb_set(
      COALESCE(${col}, '{}'::jsonb),
      ARRAY[${track}],
      COALESCE((${col} -> ${track}), '{"status":"not_started"}'::jsonb) || ${patchJson}::jsonb,
      true
    )
    WHERE ${whereSql(store.where)}
  `;
}

/**
 * Atomically replace one top-level audit field (e.g. `completedAt`, `runId`).
 * Replaces — does not merge. Use `setTrackAtomic` for track-level merges,
 * `appendErrorAtomic` for the errors array.
 */
export async function setAuditFieldAtomic(
  store: AuditStore,
  field: string,
  value: unknown
): Promise<void> {
  const tbl = Prisma.raw(quoteIdent(store.table));
  const col = Prisma.raw(quoteIdent(store.jsonCol));
  const valueJson = JSON.stringify(value);
  await prisma.$executeRaw`
    UPDATE ${tbl}
    SET ${col} = jsonb_set(
      COALESCE(${col}, '{}'::jsonb),
      ARRAY[${field}],
      ${valueJson}::jsonb,
      true
    )
    WHERE ${whereSql(store.where)}
  `;
}

/**
 * Atomically append one entry to the `errors` array. Two concurrent appends
 * from racing track failures both land.
 */
export async function appendErrorAtomic(
  store: AuditStore,
  err: { message: string; timestamp: string; track?: string }
): Promise<void> {
  const tbl = Prisma.raw(quoteIdent(store.table));
  const col = Prisma.raw(quoteIdent(store.jsonCol));
  // Wrap in a one-element array so `||` appends rather than concatenates the keys of an object.
  const errJson = JSON.stringify([err]);
  await prisma.$executeRaw`
    UPDATE ${tbl}
    SET ${col} = jsonb_set(
      COALESCE(${col}, '{}'::jsonb),
      '{errors}',
      COALESCE((${col} -> 'errors'), '[]'::jsonb) || ${errJson}::jsonb,
      true
    )
    WHERE ${whereSql(store.where)}
  `;
}

/**
 * Re-derive the mirror `enrichmentStatus` column from the current audit blob
 * and write it. Two statements (read full audit, write status); there's a
 * tiny window where another patch lands in between and the status briefly
 * trails by one update — converges on the next write. Acceptable.
 */
export async function refreshStatusMirror(
  store: AuditStore,
  deriveFromAudit: () => Promise<string | null>
): Promise<void> {
  if (!store.statusCol) return;
  const derived = await deriveFromAudit();
  if (!derived) return;
  const tbl = Prisma.raw(quoteIdent(store.table));
  const statusCol = Prisma.raw(quoteIdent(store.statusCol));
  await prisma.$executeRaw`
    UPDATE ${tbl} SET ${statusCol} = ${derived} WHERE ${whereSql(store.where)}
  `;
}
