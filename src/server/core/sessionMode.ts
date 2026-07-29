import type Database from 'better-sqlite3';

/**
 * Session mode (design 6c): a group tab started on the tablet. One active
 * session at a time (a kegerator hosts one gathering), in-memory — a session
 * is an evening-scale object, not history; the pours themselves are already
 * durably recorded and attributed, so per-member totals are COMPUTED from the
 * pours table (member + ts >= startedAt), never double-tracked.
 */

export interface SessionMember {
  drinkerId: number;
  name: string;
  color: string | null;
}

export interface ActiveSession {
  name: string;
  startedAt: string;
  members: SessionMember[];
}

export interface SessionMemberTotals extends SessionMember {
  pourCount: number;
  volumeMl: number;
}

export interface SessionSnapshot extends ActiveSession {
  totals: SessionMemberTotals[];
}

export class SessionRegistry {
  private session: ActiveSession | null = null;

  start(name?: string): ActiveSession {
    this.session = {
      name: name?.trim() || 'Session',
      startedAt: new Date().toISOString(),
      members: [],
    };
    return this.session;
  }

  join(member: SessionMember): ActiveSession | null {
    if (!this.session) return null;
    if (!this.session.members.some((m) => m.drinkerId === member.drinkerId)) {
      this.session.members.push(member);
    }
    return this.session;
  }

  current(): ActiveSession | null {
    return this.session;
  }

  /** Live per-member totals — the tablet's bars + the end-of-session recap. */
  snapshot(db: Database.Database): SessionSnapshot | null {
    if (!this.session) return null;
    const totals = this.session.members.map((member) => {
      const row = db.prepare(
        'SELECT COUNT(*) c, COALESCE(SUM(volume_ml), 0) v FROM pours WHERE drinker_id = ? AND ts >= ?',
      ).get(member.drinkerId, this.session!.startedAt) as { c: number; v: number };
      return { ...member, pourCount: row.c, volumeMl: row.v };
    }).sort((a, b) => b.volumeMl - a.volumeMl);
    return { ...this.session, totals };
  }

  /** Ends the session, returning the final recap. */
  end(db: Database.Database): SessionSnapshot | null {
    const recap = this.snapshot(db);
    this.session = null;
    return recap;
  }
}
