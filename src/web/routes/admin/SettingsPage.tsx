import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../../../server/db/settings.js';
import { getSettings } from '../../lib/adminApi';
import { BackupPanel } from './BackupPanel';
import { triggersRestart } from './settings/shared';
import { SiteGroup } from './settings/SiteGroup';
import { PricingGroup } from './settings/PricingGroup';
import { KegtronGroup } from './settings/KegtronGroup';
import { SourcesGroup } from './settings/SourcesGroup';
import { SystemGroup } from './settings/SystemGroup';
import { IntegrationsGroup } from './settings/IntegrationsGroup';
import { ChannelsGroup } from './settings/ChannelsGroup';
import { PageTemplate } from './PageTemplate';
import {
  ErrorState, Skeleton, Tabs, Toast, tabId,
} from './ui';

type PageStatus = 'loading' | 'loaded' | 'error';

type GroupId = 'site' | 'kegtron' | 'mqtt' | 'catalogBeer' | 'govee' | 'faceSignIn' | 'channels' | 'updates' | 'pricing';

/**
 * `/admin/settings` (Task 8, admin-only route — same "no role branching needed" situation
 * as UsersPage; `AdminLayout` already bounces any non-admin). Four independent groups
 * (Site, Kegtron, Sources, Integrations) each PATCH only their own changed keys, plus a
 * Backup group (`BackupPanel`) for download/restore.
 *
 * Sources and Integrations both edit sub-fields of the same `mqtt` settings key (see
 * SourcesGroup's doc comment) — after EITHER saves, the OTHER must re-derive its local
 * draft from the fresh canonical `mqtt`, or its next save would silently resend a stale
 * copy of the sibling's fields and revert them. That's what `mqttVersion` (remounting
 * both, via their `key` props) is for. Site and Kegtron own fully independent keys, so
 * they each get their OWN version counter that bumps ONLY on their own save — an admin
 * mid-edit on the Site form doesn't lose that draft just because they saved Sources first.
 *
 * `catalogBeerVersion` follows that same "own independent key, own counter" precedent for
 * Integrations' `CatalogBeerBlock` — it must NOT share `mqttVersion` (that would remount,
 * and so discard any unsaved draft in, the SIBLING SourcesGroup on every catalog.beer
 * save, even though catalog.beer shares nothing with `mqtt`).
 *
 * `faceSignInVersion` (Task 9) is the same precedent once more for `FaceSignInBlock` —
 * `faceSignIn` shares nothing with `mqtt` or `catalogBeer` either.
 *
 * `goveeVersion` is the same precedent for `GoveeBlock` (`govee` + `autoImportBeers`,
 * both fully independent keys) — its save used to be miswired to bump
 * `catalogBeerVersion`, remounting the sibling CatalogBeerBlock instead of itself.
 *
 * There's no `presenceVersion` counter — `PresenceBlock` (Displays & Presence hub Task 5)
 * is a static pointer card now, nothing here for it to re-derive a draft from.
 */
type SettingsTabId = 'general' | 'sources' | 'integrations' | 'system';

/** How long the transient saved/restarted notice stays visible before auto-clearing. */
const NOTICE_CLEAR_MS = 4_000;

const SETTINGS_TABS: { id: SettingsTabId; label: string; hint: string }[] = [
  { id: 'general', label: 'Taproom', hint: 'Name, logo, units, serving size, pricing' },
  { id: 'sources', label: 'Kegtron and sources', hint: 'Cloud, UDP, Bluetooth, MQTT' },
  { id: 'integrations', label: 'Integrations and alerts', hint: 'Home Assistant, catalog.beer, Govee, notifications' },
  { id: 'system', label: 'System', hint: 'Updates, kiosk, backups' },
];

/** Initial tab from ?tab=<id> — plain URLSearchParams (not useSearchParams) on
 * purpose: this page has no other router needs, and the param is written back via
 * history.replaceState so tab switches never create history entries to back-button
 * through. */
function initialTab(): SettingsTabId {
  const requested = new URLSearchParams(window.location.search).get('tab');
  return SETTINGS_TABS.some((t) => t.id === requested) ? requested as SettingsTabId : 'general';
}

export function SettingsPage() {
  const [status, setStatus] = useState<PageStatus>('loading');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<SettingsTabId>(initialTab);

  function selectTab(next: SettingsTabId) {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', next);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }
  const [siteVersion, setSiteVersion] = useState(0);
  const [kegtronVersion, setKegtronVersion] = useState(0);
  const [mqttVersion, setMqttVersion] = useState(0);
  const [catalogBeerVersion, setCatalogBeerVersion] = useState(0);
  const [goveeVersion, setGoveeVersion] = useState(0);
  const [faceSignInVersion, setFaceSignInVersion] = useState(0);
  const [updatesVersion, setUpdatesVersion] = useState(0);
  const [pricingVersion, setPricingVersion] = useState(0);
  // Wrapped in an object — a FRESH one per save — so back-to-back saves of the same
  // kind still restart the auto-clear effect below (a plain string wouldn't change
  // identity, and the first save's timer would clear the second save's notice early).
  const [notice, setNotice] = useState<{ kind: 'saved' | 'restarted' } | null>(null);

  const load = useCallback(() => {
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
    getSettings().then((result) => {
      if (result.ok) {
        setSettings(result.data);
        setStatus('loaded');
        setSiteVersion((v) => v + 1);
        setKegtronVersion((v) => v + 1);
        setMqttVersion((v) => v + 1);
        setCatalogBeerVersion((v) => v + 1);
        setGoveeVersion((v) => v + 1);
        setFaceSignInVersion((v) => v + 1);
        setUpdatesVersion((v) => v + 1);
        setPricingVersion((v) => v + 1);
      } else {
        setStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The saved/restarted notice is transient feedback, not page state — without this it
  // read "Saved." forever. Auto-clear it (the same transient-confirmation idiom as
  // WallsPage's copy-link feedback), with the timer cancelled on unmount or when a
  // newer notice replaces it.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  function handleGroupSaved(group: GroupId, updated: Settings, patch: Partial<Settings>) {
    setSettings(updated);
    if (group === 'site') setSiteVersion((v) => v + 1);
    else if (group === 'updates') setUpdatesVersion((v) => v + 1);
    else if (group === 'kegtron') setKegtronVersion((v) => v + 1);
    else if (group === 'mqtt') setMqttVersion((v) => v + 1);
    else if (group === 'catalogBeer') setCatalogBeerVersion((v) => v + 1);
    else if (group === 'govee') setGoveeVersion((v) => v + 1);
    else if (group === 'faceSignIn') setFaceSignInVersion((v) => v + 1);
    else if (group === 'pricing') setPricingVersion((v) => v + 1);
    // 'channels': no version bump/remount — see ChannelsGroup's doc comment for why each
    // of its 5 blocks manages its own post-save local-state reset instead.
    setNotice({ kind: triggersRestart(patch) ? 'restarted' : 'saved' });
  }

  if (status === 'loading') {
    return <div data-testid="settings-loading"><Skeleton height={240} /></div>;
  }
  if (status === 'error' || !settings) {
    return (
      <div data-testid="settings-error">
        <ErrorState title="Couldn’t load settings.">Reload to try again.</ErrorState>
      </div>
    );
  }

  return (
    <PageTemplate
      testId="admin-settings-page"
      title="Settings"
      sub="Changes save per section. Saving a source restarts it so the change takes effect."
      actions={(
        <a className="adm-btn adm-btn--secondary" href="/admin/doctor" data-testid="settings-doctor-link">
          Open the connection doctor
        </a>
      )}
    >
      {notice?.kind === 'restarted' && (
        <Toast tone="warn" testId="settings-restart-notice">Sources restarted to apply changes.</Toast>
      )}
      {notice?.kind === 'saved' && <Toast testId="settings-saved-notice">Saved.</Toast>}

      <div className="settings-v2">
        <Tabs<SettingsTabId>
          label="Settings sections"
          idBase="settings"
          orientation="vertical"
          testId="settings-tabs"
          value={tab}
          onChange={selectTab}
          items={SETTINGS_TABS.map(({ id, label, hint }) => ({
            value: id, label: <b>{label}</b>, hint, testId: `settings-tab-${id}`,
          }))}
        />
        <div className="settings-v2__panels">
      <div className="settings-groups" role="tabpanel" aria-labelledby={tabId('settings', 'general')} hidden={tab !== 'general'} data-testid="settings-panel-general">
        <SiteGroup
          key={`site-${siteVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('site', updated, patch)}
        />
        <PricingGroup
          key={`pricing-${pricingVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('pricing', updated, patch)}
        />
      </div>
      <div className="settings-groups" role="tabpanel" aria-labelledby={tabId('settings', 'sources')} hidden={tab !== 'sources'} data-testid="settings-panel-sources">
        <KegtronGroup
          key={`kegtron-${kegtronVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('kegtron', updated, patch)}
        />
        <SourcesGroup
          key={`sources-${mqttVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('mqtt', updated, patch)}
        />
      </div>
      <div className="settings-groups" role="tabpanel" aria-labelledby={tabId('settings', 'integrations')} hidden={tab !== 'integrations'} data-testid="settings-panel-integrations">
        <IntegrationsGroup
          settings={settings}
          mqttVersion={mqttVersion}
          catalogBeerVersion={catalogBeerVersion}
          goveeVersion={goveeVersion}
          faceSignInVersion={faceSignInVersion}
          onSaved={(updated, patch) => handleGroupSaved('mqtt', updated, patch)}
          onCatalogBeerSaved={(updated, patch) => handleGroupSaved('catalogBeer', updated, patch)}
          onGoveeSaved={(updated, patch) => handleGroupSaved('govee', updated, patch)}
          onFaceSignInSaved={(updated, patch) => handleGroupSaved('faceSignIn', updated, patch)}
        />
        <ChannelsGroup
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('channels', updated, patch)}
        />
      </div>
      <div className="settings-groups" role="tabpanel" aria-labelledby={tabId('settings', 'system')} hidden={tab !== 'system'} data-testid="settings-panel-system">
        <SystemGroup
          key={`system-${updatesVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('updates', updated, patch)}
        />
        <BackupPanel />
      </div>
        </div>
      </div>
    </PageTemplate>
  );
}
