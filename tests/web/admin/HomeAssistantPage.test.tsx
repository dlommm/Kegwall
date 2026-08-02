import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HomeAssistantPage } from '../../../src/web/routes/admin/HomeAssistantPage';
import { getSettings } from '../../../src/web/lib/adminApi';

vi.mock('../../../src/web/lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/web/lib/adminApi')>()),
  getSettings: vi.fn(),
}));

beforeEach(() => { vi.clearAllMocks(); });

describe('HomeAssistantPage', () => {
  it('fetches settings then renders the HA setup wizard', async () => {
    (getSettings as any).mockResolvedValue({ ok: true, data: { mqtt: null } });
    render(<MemoryRouter><HomeAssistantPage /></MemoryRouter>);
    expect(screen.getByTestId('ha-page-loading')).toBeInTheDocument(); // before settings resolve
    expect(await screen.findByTestId('ha-wizard')).toBeInTheDocument();
  });
});
