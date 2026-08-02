import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Settings } from '../../../server/db/settings.js';
import { getSettings } from '../../lib/adminApi';
import { HaSetupWizard } from '../../components/HaSetupWizard';

/**
 * `/admin/home-assistant`: the standalone Home Assistant setup wizard, reachable from
 * Settings → Integrations. Fetches current settings so the wizard can pre-fill and merge
 * the mqtt object, and returns to Settings on save. The same wizard is also embedded as an
 * optional first-run step in WelcomePage.
 */
export function HomeAssistantPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    getSettings().then((r) => { if (r.ok) setSettings(r.data); });
  }, []);

  if (!settings) {
    return (
      <main className="admin-page" data-testid="ha-page-loading">
        <p className="admin-page-quiet">Loading…</p>
      </main>
    );
  }

  return (
    <main className="admin-page" data-testid="ha-page">
      <h1 className="admin-page__title font-display">Home Assistant</h1>
      <HaSetupWizard
        settings={settings}
        onSaved={() => navigate('/admin/settings')}
        onCancel={() => navigate('/admin/settings')}
      />
    </main>
  );
}
