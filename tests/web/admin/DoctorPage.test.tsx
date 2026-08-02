import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { DoctorPage } from '../../../src/web/routes/admin/DoctorPage';
import {
  doctorCloud, doctorEnv, doctorGovee, doctorListen, getSources,
} from '../../../src/web/lib/adminApi';
import { renderAdminPage } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', () => ({
  doctorCloud: vi.fn().mockResolvedValue({ ok: true, data: { ok: true, detail: '' } }),
  doctorEnv: vi.fn().mockResolvedValue({ ok: true, data: { inDocker: false, hint: '' } }),
  doctorGovee: vi.fn().mockResolvedValue({ ok: true, data: { ok: true, detail: '' } }),
  doctorListen: vi.fn().mockResolvedValue({ ok: true, data: { total: 0, perMonitor: [], seconds: 10, rawSamples: [] } }),
  doctorUdpHistory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  doctorUdpRaw: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getSources: vi.fn(),
}));

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getSources as Mock).mockResolvedValue({ ok: true, data: [] });
});

describe('DoctorPage (redesign 4c)', () => {
  it('shows an all-healthy verdict when every registered source is up', async () => {
    (getSources as Mock).mockResolvedValue({
      ok: true,
      data: [
        { name: 'kegtron_cloud', registered: true, healthy: true, detail: '', lastEventAt: null },
        { name: 'gen1_ble', registered: false, healthy: false, detail: '', lastEventAt: null },
      ],
    });
    renderAdminPage(<DoctorPage />);
    const verdict = await screen.findByTestId('doctor-verdict');
    expect(verdict).toHaveTextContent('All 1 ingest paths healthy');
    expect(verdict.className).toContain('ok');
  });

  it('names the down source in the verdict', async () => {
    (getSources as Mock).mockResolvedValue({
      ok: true,
      data: [
        { name: 'kegtron_cloud', registered: true, healthy: true, detail: '', lastEventAt: null },
        { name: 'kegtron_udp', registered: true, healthy: false, detail: 'no packets', lastEventAt: null },
      ],
    });
    renderAdminPage(<DoctorPage />);
    const verdict = await screen.findByTestId('doctor-verdict');
    expect(verdict).toHaveTextContent('1 of 2 paths healthy — kegtron_udp is down');
    expect(verdict.className).toContain('warn');
  });

  it('Run all checks fires every check', async () => {
    renderAdminPage(<DoctorPage />);
    await flush();
    fireEvent.click(screen.getByTestId('doctor-run-all'));
    await flush();
    expect(doctorCloud).toHaveBeenCalled();
    expect(doctorListen).toHaveBeenCalled();
    expect(doctorGovee).toHaveBeenCalled();
  });
});
