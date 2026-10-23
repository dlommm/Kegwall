import { useEffect, useState } from 'react';
import { listUsers, getFaceCounts } from '../../lib/adminApi';
import { getLeaderboard, getPourers, type LeaderboardEntryPublic } from '../../lib/api';
import { formatBoardVolume } from '../../components/LeaderboardBoard';
import { capitalize, countWord } from '../../lib/tonightAttention';
import type { VolumeUnits } from '../../lib/units';
import { useAdminContext } from './useAdminContext';
import { UsersPage } from './UsersPage';
import { PourersPage } from './PourersPage';
import { PageTemplate } from './PageTemplate';
import { Tabs, tabId } from './ui';

type PeopleTab = 'pourers' | 'accounts';

/** "Seven pourers. Jordan leads this month with 3.2 gal." */
export function peopleHeadline(
  pourers: number | null, leader: LeaderboardEntryPublic | null, units: VolumeUnits,
): string {
  if (pourers === null) return 'People';
  if (pourers === 0) return 'No pourers yet.';
  const first = pourers === 1 ? 'One pourer.' : `${capitalize(countWord(pourers))} pourers.`;
  if (!leader) return `${first} Nobody has poured yet this month.`;
  return `${first} ${leader.displayName} leads this month with ${formatBoardVolume(leader.volumeMl, units)}.`;
}

/**
 * `/admin/people` (Kegwall V2 M8, prototypes/admin-people.html): pourers and the accounts that
 * can sign in, under one sentence header with two tabs — Pourers (passwordless drinkers, all
 * roles) and Accounts (login users + face data, admin only).
 */
export function PeoplePage() {
  const { me, units } = useAdminContext();
  const isAdmin = me.role === 'admin';
  const [tab, setTab] = useState<PeopleTab>('pourers');
  const [accounts, setAccounts] = useState<number | null>(null);
  const [pourers, setPourers] = useState<number | null>(null);
  const [faces, setFaces] = useState<number | null>(null);
  const [leader, setLeader] = useState<LeaderboardEntryPublic | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPourers().then((r) => { if (!cancelled && r.ok) setPourers(r.data.length); });
    getLeaderboard('month').then((r) => {
      if (!cancelled && r.ok) setLeader(r.data.entries.find((e) => e.volumeMl > 0) ?? null);
    });
    if (isAdmin) {
      listUsers().then((r) => { if (!cancelled && r.ok) setAccounts(r.data.filter((u) => u.username != null).length); });
      getFaceCounts().then((r) => {
        if (!cancelled && r.ok) setFaces(r.data.filter((c) => c.count > 0).length);
      });
    }
    return () => { cancelled = true; };
  }, [isAdmin]);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const summary = [
    isAdmin && accounts != null ? plural(accounts, 'account') : null,
    pourers != null ? plural(pourers, 'pourer') : null,
    isAdmin && faces != null ? `${faces} with face sign-in` : null,
  ].filter(Boolean).join(' · ');

  return (
    <PageTemplate
      testId="admin-people-page"
      title={peopleHeadline(pourers, leader, units)}
      sub={(
        <>
          Pourers sign in on the tablet or claim pours on their phone. No email or password needed.
          {summary && <span className="people-v2__summary" data-testid="people-summary">{summary}</span>}
        </>
      )}
    >
      <Tabs<PeopleTab>
        label="People sections"
        idBase="people"
        testId="people-tabs"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'pourers', label: 'Pourers', count: pourers ?? undefined, testId: 'people-tab-pourers' },
          ...(isAdmin
            ? [{ value: 'accounts' as const, label: 'Accounts', count: accounts ?? undefined, testId: 'people-tab-accounts' }]
            : []),
        ]}
      />

      <div role="tabpanel" aria-labelledby={tabId('people', 'pourers')} hidden={tab !== 'pourers'} data-testid="people-panel-pourers">
        <PourersPage embedded />
      </div>
      {isAdmin && (
        <div role="tabpanel" aria-labelledby={tabId('people', 'accounts')} hidden={tab !== 'accounts'} data-testid="people-panel-accounts">
          <UsersPage embedded />
        </div>
      )}
    </PageTemplate>
  );
}
