import { useEffect, useState } from 'react';
import { listUsers, getFaceCounts } from '../../lib/adminApi';
import { getPourers } from '../../lib/api';
import { useAdminContext } from './useAdminContext';
import { UsersPage } from './UsersPage';
import { PourersPage } from './PourersPage';

/**
 * `/admin/people` (redesign 4h): the merged People page. One nav entry, a shared header
 * count, and two tabs — Pourers (passwordless drinkers, all roles) and Accounts (login users
 * + face data, admin only). The two existing pages render embedded (header suppressed) under
 * the tabs, so their full management UIs are preserved without a risky rewrite.
 */
export function PeoplePage() {
  const { me } = useAdminContext();
  const isAdmin = me.role === 'admin';
  const [tab, setTab] = useState<'pourers' | 'accounts'>('pourers');
  const [accounts, setAccounts] = useState<number | null>(null);
  const [pourers, setPourers] = useState<number | null>(null);
  const [faces, setFaces] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPourers().then((r) => { if (!cancelled && r.ok) setPourers(r.data.length); });
    if (isAdmin) {
      listUsers().then((r) => { if (!cancelled && r.ok) setAccounts(r.data.filter((u) => u.username != null).length); });
      getFaceCounts().then((r) => {
        if (!cancelled && r.ok) setFaces(r.data.filter((c) => c.count > 0).length);
      });
    }
    return () => { cancelled = true; };
  }, [isAdmin]);

  const summary = [
    isAdmin && accounts != null ? `${accounts} accounts` : null,
    pourers != null ? `${pourers} pourers` : null,
    isAdmin && faces != null ? `${faces} faces enrolled` : null,
  ].filter(Boolean).join(' · ');

  return (
    <section data-testid="admin-people-page">
      <header className="admin-page-header">
        <div className="admin-page-header__lead">
          <h1 className="admin-page-header__title font-display">People</h1>
          {summary && <span className="beers-summary font-tabular" data-testid="people-summary">{summary}</span>}
        </div>
      </header>

      <div className="analytics-tabs" role="tablist" aria-label="People sections" data-testid="people-tabs">
        <button
          type="button"
          role="tab"
          className="analytics-tab"
          data-testid="people-tab-pourers"
          aria-selected={tab === 'pourers'}
          onClick={() => setTab('pourers')}
        >
          Pourers
        </button>
        {isAdmin && (
          <button
            type="button"
            role="tab"
            className="analytics-tab"
            data-testid="people-tab-accounts"
            aria-selected={tab === 'accounts'}
            onClick={() => setTab('accounts')}
          >
            Accounts
          </button>
        )}
      </div>

      <div hidden={tab !== 'pourers'} data-testid="people-panel-pourers">
        <PourersPage embedded />
      </div>
      {isAdmin && (
        <div hidden={tab !== 'accounts'} data-testid="people-panel-accounts">
          <UsersPage embedded />
        </div>
      )}
    </section>
  );
}
