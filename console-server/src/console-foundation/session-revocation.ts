// Per-session revocation (#104). Session cookies carry a random session id (sid);
// revoking a sid invalidates that session server-side before its signed max-age
// expires — so logout (or a targeted revoke) actually terminates the session, not
// just clears the client cookie. Only revoked sids are stored, each expiring at the
// session's signed lifetime, so the store stays bounded.

import crypto from "node:crypto";
import type { ConsoleSqlClient } from "./types";

export interface RevocationStore {
  /** True if the sid has been revoked and its revocation has not itself expired. */
  isRevoked(sid: string): Promise<boolean>;
  /** Revoke a sid until `expiresAtMs` (the session's signed max-age boundary). */
  revoke(sid: string, tenantId: string, expiresAtMs: number): Promise<void>;
}

/** Generate a fresh 128-bit session id (base64url). */
export function newSessionId(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * In-memory store — local mode, single-instance, and tests. Self-prunes expired
 * entries. NOT shared across processes, so multi-instance hosted deployments should
 * use the Postgres store (below) for revocation to propagate.
 */
export class InMemoryRevocationStore implements RevocationStore {
  private readonly revoked = new Map<string, number>();

  async isRevoked(sid: string): Promise<boolean> {
    const expiresAt = this.revoked.get(sid);
    if (expiresAt === undefined) return false;
    if (Date.now() >= expiresAt) {
      this.revoked.delete(sid);
      return false;
    }
    return true;
  }

  async revoke(sid: string, _tenantId: string, expiresAtMs: number): Promise<void> {
    this.revoked.set(sid, expiresAtMs);
    if (this.revoked.size > 1024) this.prune();
  }

  private prune(): void {
    const now = Date.now();
    for (const [sid, expiresAt] of this.revoked) {
      if (expiresAt <= now) this.revoked.delete(sid);
    }
  }
}

/**
 * Postgres store — hosted / multi-instance. Durable and shared across instances, so
 * a revoke on one instance is honored by all. Rows self-expire via `expires_at`.
 */
export class PostgresRevocationStore implements RevocationStore {
  constructor(private readonly sql: ConsoleSqlClient) {}

  async isRevoked(sid: string): Promise<boolean> {
    const result = await this.sql.query(
      "select sid from console_revoked_sessions where sid = $1 and expires_at > now() limit 1",
      [sid]
    );
    return result.rows.length > 0;
  }

  async revoke(sid: string, tenantId: string, expiresAtMs: number): Promise<void> {
    await this.sql.query(
      "insert into console_revoked_sessions (sid, tenant_id, expires_at) values ($1, $2, to_timestamp($3)) on conflict (sid) do nothing",
      [sid, tenantId, expiresAtMs / 1000]
    );
  }
}

/** Postgres-backed when a SQL client is available (hosted), else in-memory. */
export function createRevocationStore(sql: ConsoleSqlClient | undefined): RevocationStore {
  return sql ? new PostgresRevocationStore(sql) : new InMemoryRevocationStore();
}
