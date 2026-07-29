import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_ITEMS, visibleNavItems } from '../../../src/web/routes/admin/adminNav';

describe('admin nav role matrix', () => {
  it('defines the Pour Wall overhaul sidebar order (design 5a) plus admin-only Users', () => {
    expect(ADMIN_NAV_ITEMS.map((i) => i.label)).toEqual([
      'Dashboard', 'Beers', 'Taps & kegs', 'Monitors', 'Walls', 'Displays', 'Automations', 'Pourers', 'Analytics', 'Logs', 'Users', 'Settings',
    ]);
  });

  it('marks only Users and Settings as admin-only', () => {
    const adminOnlyLabels = ADMIN_NAV_ITEMS.filter((i) => i.adminOnly).map((i) => i.label);
    expect(adminOnlyLabels).toEqual(['Users', 'Settings']);
  });

  it('shows every item to an admin', () => {
    expect(visibleNavItems('admin').map((i) => i.label)).toEqual([
      'Dashboard', 'Beers', 'Taps & kegs', 'Monitors', 'Walls', 'Displays', 'Automations', 'Pourers', 'Analytics', 'Logs', 'Users', 'Settings',
    ]);
  });

  it('hides Users and Settings from an editor', () => {
    const labels = visibleNavItems('editor').map((i) => i.label);
    expect(labels).toEqual(['Dashboard', 'Beers', 'Taps & kegs', 'Monitors', 'Walls', 'Displays', 'Automations', 'Pourers', 'Analytics', 'Logs']);
  });

  it('hides Users and Settings from a viewer, but shows everything else (read-only pages land in later tasks)', () => {
    const labels = visibleNavItems('viewer').map((i) => i.label);
    expect(labels).toEqual(['Dashboard', 'Beers', 'Taps & kegs', 'Monitors', 'Walls', 'Displays', 'Automations', 'Pourers', 'Analytics', 'Logs']);
  });

  it('defensively hides admin-only items when role is null', () => {
    const labels = visibleNavItems(null).map((i) => i.label);
    expect(labels).not.toContain('Users');
    expect(labels).not.toContain('Settings');
  });
});
