import { describe, expect, it } from 'vitest';
import { kegsHeadline } from '../../../src/web/routes/admin/KegsPage';
import { monitorsHeadline } from '../../../src/web/routes/admin/MonitorsPage';
import { groupMonitors } from '../../../src/web/lib/monitorDevices';
import type { KegHistoryRow } from '../../../src/web/lib/adminApi';
import type { Monitor } from '../../../src/server/db/monitors';

const now = new Date('2026-10-22T20:00:00');

const keg = (id: number, over: Partial<KegHistoryRow> = {}): KegHistoryRow => ({
  id, status: 'on_tap', beerId: 1, beerName: 'Amber', tapId: 1, tapNumber: 1, tapName: null,
  sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, kegType: null,
  costCents: null, depositCents: null, supplierId: null, supplierName: null, purchasedAt: null,
  createdAt: '2026-09-01', ...over,
});

describe('the Kegs sentence', () => {
  it('totals only this month’s logged costs', () => {
    expect(kegsHeadline([
      keg(1, { costCents: 13900, purchasedAt: '2026-10-03' }),
      keg(2, { costCents: 16500, purchasedAt: '2026-10-20' }),
      keg(3, { costCents: 99900, purchasedAt: '2026-09-30' }),
    ], now)).toBe('Three kegs on record. This month’s kegs cost $304.');
  });

  it('says so when nothing was costed this month', () => {
    expect(kegsHeadline([keg(1)], now)).toBe('One keg on record. No keg costs logged this month.');
    expect(kegsHeadline([], now)).toBe('No kegs yet.');
  });
});

describe('the Monitors sentence', () => {
  const mon = (id: number, identifier: string, port: number, over: Partial<Monitor> = {}): Monitor => ({
    id, type: 'kegtron_pro', identifier, serial: null, portIndex: port, tapId: null,
    lastSeen: '2026-10-22T19:58:00', meta: {}, name: null, enabled: true, ...over,
  });

  it('counts devices and ports and says when all are reporting', () => {
    const devices = groupMonitors([mon(1, 'a', 0), mon(2, 'a', 1), mon(3, 'b', 0)]);
    expect(monitorsHeadline(devices, now)).toBe('Two monitors on three ports. All of them are reporting.');
  });

  it('names a single quiet device, and ignores a disabled one', () => {
    const devices = groupMonitors([
      mon(1, 'a', 0, { name: 'Main kegerator', lastSeen: '2026-10-22T18:00:00' }),
      mon(2, 'b', 0, { enabled: false, lastSeen: null }),
    ]);
    expect(monitorsHeadline(devices, now))
      .toBe('Two monitors on two ports. Main kegerator hasn’t reported in the last 10 minutes.');
  });
});

describe('the Beers sentence', () => {
  it('counts the library, what is on and what is waiting', async () => {
    const { beersHeadline } = await import('../../../src/web/routes/admin/BeersPage');
    expect(beersHeadline(15, 11, 1)).toBe('15 beers. Eleven on tap, one waiting in the cellar.');
    expect(beersHeadline(2, 0, 0)).toBe('Two beers. None on tap.');
    expect(beersHeadline(0, 0, 0)).toBe('No beers yet.');
  });
});

describe('the People sentence', () => {
  it('names this month’s leader by volume', async () => {
    const { peopleHeadline } = await import('../../../src/web/routes/admin/PeoplePage');
    const leader = { drinkerId: 1, displayName: 'Jordan', avatarColor: null, pourCount: 29, volumeMl: 12113, avgQuality: null, qualityCount: 0 };
    expect(peopleHeadline(7, leader, 'us')).toMatch(/^Seven pourers\. Jordan leads this month with .+\.$/);
    expect(peopleHeadline(2, null, 'us')).toBe('Two pourers. Nobody has poured yet this month.');
    expect(peopleHeadline(0, null, 'us')).toBe('No pourers yet.');
  });
});
