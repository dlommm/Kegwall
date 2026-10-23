import type { Wall } from '../../../lib/adminApi';
import type { PowerStage } from '../../../lib/displayPower';
import { formatRelativeTime } from '../../../lib/useRelativeTime';
import type { MotionSource } from '../../../../server/db/settings.js';
import {
  agentsLabel, haSnippetYaml, POWER_STAGE_LABEL, SOURCE_TYPE_LABEL,
  type DpFields, type SourceRow,
} from './presenceModel';
import { Button, EmptyState, Table } from '../ui';

/**
 * The Presence page's four sections (Kegwall V2 M9, split out of PresencePage.tsx): zones and
 * their power, each wall's sleep timers, the motion sources, and the webhook token. Every
 * zone names its wall and its address, so two walls with the same name stay apart (issue 13).
 */

function Section({ title, sub, action, testId, children }: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="adm-section presence-v2__section" data-testid={testId}>
      <div className="adm-section__head">
        <div>
          <h2 className="adm-h2">{title}</h2>
          {sub && <p className="adm-sub">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const STAGE_CLASS: Record<PowerStage, string> = {
  active: 'presence-v2__stage is-on', screensaver: 'presence-v2__stage is-rest', off: 'presence-v2__stage',
};

export function ZonesPanel({
  walls, wallsLoaded, zoneStates, agentsBySlug, error, onSetState,
}: {
  walls: Wall[];
  wallsLoaded: boolean;
  zoneStates: Record<string, PowerStage>;
  agentsBySlug: Record<string, number>;
  error: string | null;
  onSetState: (wall: string | undefined, state: PowerStage) => void;
}) {
  return (
    <Section
      title="Zones"
      sub="One zone per wall. Wake or rest its screens by hand; motion still wakes them."
      testId="presence-panel-zones"
      action={<Button data-testid="zone-wake-all" onClick={() => onSetState(undefined, 'active')}>Wake every screen</Button>}
    >
      {error && <p className="adm-danger-text" role="alert" data-testid="zone-error">{error}</p>}
      {wallsLoaded && walls.length === 0 ? (
        <div data-testid="zones-empty"><EmptyState title="No walls set up yet." /></div>
      ) : (
        <Table data-testid="zones-table">
          <thead>
            <tr>
              <th scope="col">Wall</th>
              <th scope="col">Screens are</th>
              <th scope="col">Presence agent</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {walls.map((wall) => {
              const state = zoneStates[wall.slug] ?? 'active';
              return (
                <tr key={wall.slug} data-testid={`zone-row-${wall.slug}`}>
                  <td>
                    <b>{wall.name}</b>
                    <div className="adm-sub adm-num-cell">{`/wall/${wall.slug}`}</div>
                  </td>
                  <td data-testid={`zone-state-${wall.slug}`}>
                    <span className={STAGE_CLASS[state]} aria-hidden="true" />
                    {POWER_STAGE_LABEL[state]}
                  </td>
                  <td className="adm-sub" data-testid={`zone-agents-${wall.slug}`}>{agentsLabel(agentsBySlug[wall.slug] ?? 0)}</td>
                  <td className="adm-actions">
                    <Button variant="quiet" data-testid={`zone-wake-${wall.slug}`} onClick={() => onSetState(wall.slug, 'active')}>Wake</Button>
                    <Button variant="quiet" data-testid={`zone-sleep-${wall.slug}`} onClick={() => onSetState(wall.slug, 'off')}>Sleep</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

export function DisplayPowerPanel({
  walls, wallsLoaded, fieldsFor, errors, onChange, onSave,
}: {
  walls: Wall[];
  wallsLoaded: boolean;
  fieldsFor: (wall: Wall) => DpFields;
  errors: Record<number, string[] | null>;
  onChange: <K extends keyof DpFields>(wall: Wall, key: K, value: DpFields[K]) => void;
  onSave: (wall: Wall) => void;
}) {
  const minutes = (raw: string) => (raw === '' ? null : Number(raw));
  return (
    <Section
      title="Sleep timers"
      sub="Minutes from the last motion or pour. Leave a box empty to never do that. The Wall Editor has the same settings."
      testId="presence-panel-display-power"
    >
      {wallsLoaded && walls.length === 0 ? (
        <div data-testid="display-power-empty"><EmptyState title="No walls set up yet." /></div>
      ) : (
        <Table data-testid="display-power-table">
          <thead>
            <tr>
              <th scope="col">Wall</th>
              <th scope="col">Screensaver after</th>
              <th scope="col">Screen off after</th>
              <th scope="col">Tablet camera wakes it</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {walls.map((wall) => {
              const f = fieldsFor(wall);
              const errs = errors[wall.id];
              return (
                <tr key={wall.slug} data-testid={`dp-row-${wall.slug}`}>
                  <td>
                    <b>{wall.name}</b>
                    <div className="adm-sub adm-num-cell">{`/wall/${wall.slug}`}</div>
                  </td>
                  <td>
                    <input
                      className="adm-input presence-v2__minutes"
                      type="number"
                      min={1}
                      aria-label={`Screensaver after, minutes, ${wall.name}`}
                      data-testid={`dp-saver-${wall.slug}`}
                      value={f.screensaverAfterMinutes ?? ''}
                      onChange={(e) => onChange(wall, 'screensaverAfterMinutes', minutes(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      className="adm-input presence-v2__minutes"
                      type="number"
                      min={2}
                      aria-label={`Screen off after, minutes, ${wall.name}`}
                      data-testid={`dp-off-${wall.slug}`}
                      value={f.offAfterMinutes ?? ''}
                      onChange={(e) => onChange(wall, 'offAfterMinutes', minutes(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      className="presence-v2__check"
                      type="checkbox"
                      aria-label={`Tablet camera wakes ${wall.name}`}
                      data-testid={`dp-camera-${wall.slug}`}
                      checked={f.cameraMotion}
                      onChange={(e) => onChange(wall, 'cameraMotion', e.target.checked)}
                    />
                  </td>
                  <td className="adm-actions">
                    <Button data-testid={`dp-save-${wall.slug}`} onClick={() => onSave(wall)}>Save</Button>
                    {errs && (
                      <ul className="adm-danger-text presence-v2__errors" role="alert" data-testid={`dp-errors-${wall.slug}`}>
                        {errs.map((err) => <li key={err}>{err}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

export function SourcesPanel({
  rows, walls, blinking, error, hasFreshToken, webhookUrl, onAdd, onEdit, onDelete, onToggleCamera,
}: {
  rows: SourceRow[];
  walls: Wall[];
  blinking: Record<string, boolean>;
  error: string | null;
  hasFreshToken: boolean;
  webhookUrl: (sourceId?: string) => string;
  onAdd: () => void;
  onEdit: (source: MotionSource) => void;
  onDelete: (source: MotionSource) => void;
  onToggleCamera: (wallSlug: string, enabled: boolean) => void;
}) {
  const wallName = (slug: string) => walls.find((w) => w.slug === slug)?.name ?? slug;
  return (
    <Section
      title="Motion sources"
      sub="Each row lights up when it sees someone."
      testId="presence-panel-sources"
      action={<Button data-testid="source-add" onClick={onAdd}>Add a motion source</Button>}
    >
      {error && <p className="adm-danger-text" role="alert" data-testid="sources-error">{error}</p>}
      {rows.length === 0 ? (
        <div data-testid="sources-empty">
          <EmptyState title="No motion sources yet.">Without one, screens rest on their timers and wake on a pour.</EmptyState>
        </div>
      ) : (
        <ul className="presence-v2__sources" data-testid="sources-table">
          {rows.map((row) => {
            const lastTriggeredAt = row.kind === 'source' ? row.status.lastTriggeredAt : row.lastTriggeredAt;
            const healthy = row.kind === 'source' ? row.status.healthy : true;
            const where = row.kind === 'source'
              ? (row.source.wallSlug ? wallName(row.source.wallSlug) : 'Every wall')
              : wallName(row.wallSlug);
            // A switched-off source stays listed, dimmed; Edit is the way to turn it back on.
            const enabled = row.kind === 'source' ? row.source.enabled : true;
            return (
              <li
                key={row.id}
                className="presence-v2__source"
                data-testid={`source-row-${row.id}`}
                data-blink={blinking[row.id] ? 'true' : 'false'}
                data-enabled={String(enabled)}
              >
                <div className="presence-v2__source-main">
                  <span
                    className={healthy ? 'presence-v2__health is-ok' : 'presence-v2__health'}
                    data-testid={`source-health-${row.id}`}
                    data-healthy={String(healthy)}
                    role="img"
                    aria-label={healthy ? 'Working' : 'Not responding'}
                  />
                  <div>
                    <b>{row.kind === 'source' ? row.source.name : `Tablet camera — ${where}`}</b>
                    <div className="adm-sub">
                      {`${row.kind === 'source' ? SOURCE_TYPE_LABEL[row.source.type] : 'Camera'} · ${where}${enabled ? '' : ' · off'}${healthy ? '' : ' · not responding'}`}
                    </div>
                  </div>
                  <span className="adm-sub adm-num-cell" data-testid={`source-last-${row.id}`}>
                    {lastTriggeredAt ? `Motion ${formatRelativeTime(lastTriggeredAt)}` : 'Never'}
                  </span>
                  <div className="presence-v2__source-actions">
                    {row.kind === 'source' ? (
                      <>
                        <Button variant="quiet" data-testid={`source-edit-${row.id}`} onClick={() => onEdit(row.source)}>Edit</Button>
                        <Button variant="quiet" data-testid={`source-delete-${row.id}`} onClick={() => onDelete(row.source)}>Delete</Button>
                      </>
                    ) : (
                      <label className="studio-check">
                        <input
                          type="checkbox"
                          data-testid={`source-camera-toggle-${row.wallSlug}`}
                          checked={row.enabled}
                          onChange={(e) => onToggleCamera(row.wallSlug, e.target.checked)}
                        />
                        <span>On</span>
                      </label>
                    )}
                  </div>
                </div>
                {row.kind === 'source' && row.source.type === 'webhook' && (
                  <div className="presence-v2__webhook">
                    <code data-testid={`source-webhook-url-${row.id}`}>{webhookUrl(row.id)}</code>
                    {!hasFreshToken && (
                      <p className="adm-sub" data-testid={`source-webhook-url-hint-${row.id}`}>
                        Regenerate the token to get copy-paste-ready URLs.
                      </p>
                    )}
                    <details>
                      <summary>Home Assistant snippet</summary>
                      <pre className="presence-v2__snippet" data-testid={`ha-snippet-${row.id}`}>{haSnippetYaml(webhookUrl(row.id))}</pre>
                    </details>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function WebhookPanel({
  token, hasFreshToken, hasWebhookSource, submitting, error, webhookUrl, onGenerate,
}: {
  token: string | null;
  hasFreshToken: boolean;
  hasWebhookSource: boolean;
  submitting: boolean;
  error: string | null;
  webhookUrl: (sourceId?: string) => string;
  onGenerate: () => void;
}) {
  return (
    <Section
      title="Webhook and agent"
      sub="One token guards the motion webhook and the presence agent stream."
      testId="presence-panel-webhook"
    >
      <div className="presence-v2__token" data-testid="webhook-token-field">
        <div>
          <span className="adm-sub">Webhook token</span>
          <b className="adm-num-cell" data-testid="webhook-token-masked">{token || 'Not set'}</b>
        </div>
        <Button data-testid="webhook-token-generate" disabled={submitting} onClick={onGenerate}>
          {submitting ? 'Generating…' : token ? 'Generate a new token' : 'Generate a token'}
        </Button>
      </div>
      {error && <p className="adm-danger-text" role="alert" data-testid="webhook-token-error">{error}</p>}
      {token ? (
        <>
          <p className="presence-v2__url" data-testid="webhook-base-url"><code>{webhookUrl()}</code></p>
          {/* A token existing only proves one was set, maybe in another tab: the URL is only
              paste-ready once THIS tab generated it and holds the real value. */}
          {!hasFreshToken && (
            <p className="adm-sub" data-testid="webhook-url-hint">Regenerate the token to get copy-paste-ready URLs.</p>
          )}
          {hasWebhookSource ? (
            <p className="adm-sub">
              Each webhook-type row in Motion sources above has its own Home Assistant snippet, so the
              row shows that sensor’s health and last motion.
            </p>
          ) : (
            <>
              <p className="adm-sub">
                No webhook source yet. This snippet works, but Home Assistant motion won’t show up as its own
                row. Add a webhook source for that.
              </p>
              <pre className="presence-v2__snippet" data-testid="ha-snippet">{haSnippetYaml(webhookUrl())}</pre>
            </>
          )}
        </>
      ) : (
        <p className="adm-sub">Generate a token to see the webhook URL and a Home Assistant snippet.</p>
      )}
    </Section>
  );
}
