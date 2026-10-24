import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TempChart, formatTimeLabel, formatTempTick } from '../../../src/web/routes/admin/TempChart';
import type { TelemetryPoint } from '../../../src/server/db/telemetry';

function makeData(): TelemetryPoint[] {
  return [
    { ts: '2026-07-27T18:00:00.000Z', temp: 4.0, humidity: 50 },
    { ts: '2026-07-27T19:00:00.000Z', temp: 4.5, humidity: 51 },
  ];
}

function makeSensor(monitorId: number, label: string, data = makeData()) {
  return { monitorId, label, data };
}

describe('TempChart', () => {
  it('renders a temperature line + a humidity line from fixture data', () => {
    const { container } = render(
      <TempChart units="metric" sensors={[makeSensor(1, 'dev-1')]} />,
    );
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
  });

  it("gives the humidity series its own (second) Y axis — different scale/unit than temperature", () => {
    const { container } = render(
      <TempChart units="metric" sensors={[makeSensor(1, 'dev-1')]} />,
    );
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(2);
  });

  it('renders temperature and humidity as two separate charts', () => {
    render(<TempChart units="metric" sensors={[makeSensor(1, 'dev-1')]} />);
    // Two distinct chart blocks, each with its own subtitle — no shared dual-axis plot.
    expect(screen.getByTestId('temp-chart-temperature')).toBeInTheDocument();
    expect(screen.getByTestId('temp-chart-humidity')).toBeInTheDocument();
    expect(screen.getByText('Temperature')).toBeInTheDocument();
    expect(screen.getByText('Humidity')).toBeInTheDocument();
  });

  it('shows a "no monitor" empty state when there are no temperature sensors at all', () => {
    render(<TempChart units="metric" sensors={[]} />);
    expect(screen.getByTestId('temp-chart-empty')).toHaveTextContent(/trend appears/i);
  });

  it('shows a "no readings" empty state for a sensor with no telemetry yet', () => {
    render(<TempChart units="metric" sensors={[makeSensor(1, 'dev-1', [])]} />);
    expect(screen.getByTestId('temp-chart-no-data')).toBeInTheDocument();
  });

  it('charts every sensor at once, each in its own named section', () => {
    render(
      <TempChart
        units="metric"
        sensors={[makeSensor(1, 'Keezer'), makeSensor(2, 'Cellar')]}
      />,
    );
    expect(screen.getAllByTestId('temp-chart')).toHaveLength(2);
    expect(screen.getAllByTestId('temp-chart-temperature')).toHaveLength(2);
    const names = screen.getAllByTestId('temp-chart-sensor-name').map((el) => el.textContent);
    expect(names).toEqual(['Keezer', 'Cellar']);
  });

  it('labels the temperature Y axis in real degrees, in the viewer’s units', () => {
    // A bare "4" tells the reader nothing; the axis prints the unit it's actually in.
    expect(formatTempTick(4, 'metric')).toBe('4°C');
    expect(formatTempTick(4, 'us')).toBe('39°F');
  });

  it('formats a UTC ISO timestamp as a 12-hour clock label', () => {
    expect(formatTimeLabel('2026-07-27T00:05:00.000Z')).toBe('12:05 AM');
    expect(formatTimeLabel('2026-07-27T13:30:00.000Z')).toBe('1:30 PM');
    expect(formatTimeLabel('2026-07-27T12:00:00.000Z')).toBe('12:00 PM');
  });
});

describe('tempSummary (Kegwall 2.1)', () => {
  it('says whether the kegerator held the serving range', async () => {
    const { tempSummary } = await import('../../../src/web/routes/admin/TempChart');
    const at = (temp: number) => ({ ts: '2026-07-27T18:00:00.000Z', temp, humidity: 50 });
    expect(tempSummary([at(2.0), at(3.0)], 'metric')).toMatch(/^Held .* in the serving range\.$/);
    expect(tempSummary([at(2.0), at(7.0)], 'metric')).toMatch(/outside the serving range/);
    expect(tempSummary([], 'metric')).toBeNull();
  });
});
