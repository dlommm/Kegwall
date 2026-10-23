import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_ITEMS, destinationFor, visibleDestinations } from '../../../src/web/routes/admin/adminNav';

describe('admin destinations (Kegwall V2)', () => {
  it('puts every existing admin page under one of the destinations', () => {
    for (const item of ADMIN_NAV_ITEMS) {
      const d = destinationFor(item.path);
      const reachable = d.path === item.path || d.tabs.some((t) => t.path === item.path);
      expect(reachable, item.path).toBe(true);
    }
  });

  it('keeps the legacy deep links in People', () => {
    expect(destinationFor('/admin/users').label).toBe('People');
    expect(destinationFor('/admin/pourers').label).toBe('People');
  });

  it('hides admin-only tabs from editors but keeps Settings reachable through its other tabs', () => {
    const editor = visibleDestinations('editor');
    const taps = editor.find((d) => d.label === 'Taps & kegs')!;
    expect(taps.tabs.map((t) => t.label)).toEqual(['Taps', 'Monitors']);
    const settings = editor.find((d) => d.label === 'Settings')!;
    expect(settings.path).toBe('/admin/automations');
  });
});
