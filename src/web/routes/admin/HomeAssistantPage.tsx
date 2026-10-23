import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Settings } from '../../../server/db/settings.js';
import { getSettings } from '../../lib/adminApi';
import { HaSetupWizard } from '../../components/HaSetupWizard';
import { PageTemplate } from './PageTemplate';

/**
 * `/admin/home-assistant`: the standalone Home Assistant setup wizard, reachable from
 * Settings → Integrations. Fetches current settings so the wizard can pre-fill and merge
 * the mqtt object, and returns to Settings on save. The same wizard is also embedded as an
 * optional first-run step in WelcomePage.
 */
export function HomeAssistantPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    getSettings().then((r) => { if (r.ok) setSettings(r.data); else setError(r.message); });
  }, []);

  if (!settings) {
    return (
      <div data-testid="ha-page-loading">
        <p className="adm-sub" role={error ? 'alert' : 'status'}>{error ?? 'Loading…'}</p>
      </div>
    );
  }

  return (
    <PageTemplate
      testId="ha-page"
      crumb="Settings · Home Assistant"
      title="Connect Home Assistant."
      sub="Kegwall publishes every tap and monitor to Home Assistant over MQTT, so they appear there without any YAML."
    >
      <HaSetupWizard
        settings={settings}
        onSaved={() => navigate('/admin/settings')}
        onCancel={() => navigate('/admin/settings')}
      />
    </PageTemplate>
  );
}
