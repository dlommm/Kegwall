import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_ITEMS, visibleNavItems } from '../../../src/web/routes/admin/adminNav';

describe('admin nav role matrix', () => {
  it('defines the Pour Wall overhaul sidebar order (design 5a) plus admin-only Suppliers/Displays & Presence/Users/Settings', () => {
    expect(ADMIN_NAV_ITEMS.map((i) => i.label)).toEqual([
      'Tonight', 'Beers', 'Taps & kegs', 'Kegs', 'Suppliers', 'Monitors', 'Walls', 'Displays', 'Displays & Presence', 'Automations', 'Games', 'Pours', 'People', 'Analytics', 'Logs', 'Settings',
    ]);
  });

  it('marks Kegs, Suppliers, Displays & Presence, and Settings as admin-only (they surface owner cost or system config)', () => {
    const adminOnlyLabels = ADMIN_NAV_ITEMS.filter((i) => i.adminOnly).map((i) => i.label);
    expect(adminOnlyLabels).toEqual(['Kegs', 'Suppliers', 'Displays & Presence', 'Settings']);
  });

  it('shows every item to an admin', () => {
    expect(visibleNavItems('admin').map((i) => i.label)).toEqual([
      'Tonight', 'Beers', 'Taps & kegs', 'Kegs', 'Suppliers', 'Monitors', 'Walls', 'Displays', 'Displays & Presence', 'Automations', 'Games', 'Pours', 'People', 'Analytics', 'Logs', 'Settings',
    ]);
  });

  it('hides Displays & Presence, Users, and Settings from an editor', () => {
    const labels = visibleNavItems('editor').map((i) => i.label);
    expect(labels).toEqual(['Tonight', 'Beers', 'Taps & kegs', 'Monitors', 'Walls', 'Displays', 'Automations', 'Games', 'Pours', 'People', 'Analytics', 'Logs']);
  });

  it('hides Displays & Presence, Users, and Settings from a viewer, but shows everything else (read-only pages land in later tasks)', () => {
    const labels = visibleNavItems('viewer').map((i) => i.label);
    expect(labels).toEqual(['Tonight', 'Beers', 'Taps & kegs', 'Monitors', 'Walls', 'Displays', 'Automations', 'Games', 'Pours', 'People', 'Analytics', 'Logs']);
  });

  it('defensively hides admin-only items when role is null', () => {
    const labels = visibleNavItems(null).map((i) => i.label);
    expect(labels).not.toContain('Displays & Presence');
    expect(labels).not.toContain('Users');
    expect(labels).not.toContain('Settings');
  });
});
