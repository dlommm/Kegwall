import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TempChart, formatTimeLabel } from '../../../src/web/routes/admin/TempChart';
import type { TelemetryPoint } from '../../../src/server/db/telemetry';

function makeDevice(monitorId: number, label: string): { monitorId: number; label: string } {
  return { monitorId, label };
}

function makeData(): TelemetryPoint[] {
  return [
    { ts: '2026-07-27T18:00:00.000Z', temp: 4.0, humidity: 50 },
    { ts: '2026-07-27T19:00:00.000Z', temp: 4.5, humidity: 51 },
  ];
}

describe('TempChart', () => {
  it('renders a temperature line + a humidity line from fixture data', () => {
    const { container } = render(
      <TempChart
        data={makeData()} units="metric" devices={[makeDevice(1, 'dev-1')]}
        selectedMonitorId={1} onSelectMonitor={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
  });

  it("gives the humidity series its own (second) Y axis — different scale/unit than temperature", () => {
    const { container } = render(
      <TempChart
        data={makeData()} units="metric" devices={[makeDevice(1, 'dev-1')]}
        selectedMonitorId={1} onSelectMonitor={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(2);
  });

  it('labels temperature and humidity in a legend', () => {
    render(
      <TempChart
        data={makeData()} units="metric" devices={[makeDevice(1, 'dev-1')]}
        selectedMonitorId={1} onSelectMonitor={vi.fn()}
      />,
    );
    // "Temperature" also appears as the chart's own header title, so the legend adds a
    // SECOND occurrence rather than being the only one.
    expect(screen.getAllByText('Temperature').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Humidity')).toBeInTheDocument();
  });

  it('shows a "no monitor" empty state when there are no Pro monitors at all', () => {
    render(
      <TempChart data={[]} units="metric" devices={[]} selectedMonitorId={null} onSelectMonitor={vi.fn()} />,
    );
    expect(screen.getByTestId('temp-chart-empty')).toHaveTextContent(/trend appears/i);
  });

  it('shows a "no readings" empty state for a monitor with no telemetry yet', () => {
    render(
      <TempChart
        data={[]} units="metric" devices={[makeDevice(1, 'dev-1')]}
        selectedMonitorId={1} onSelectMonitor={vi.fn()}
      />,
    );
    expect(screen.getByTestId('temp-chart-no-data')).toBeInTheDocument();
  });

  it('hides the device picker when there is only one Pro device', () => {
    render(
      <TempChart
        data={makeData()} units="metric" devices={[makeDevice(1, 'dev-1')]}
        selectedMonitorId={1} onSelectMonitor={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('temp-chart-monitor-select')).not.toBeInTheDocument();
  });

  it('shows a device picker and calls onSelectMonitor when there are multiple Pro devices', () => {
    const onSelectMonitor = vi.fn();
    render(
      <TempChart
        data={makeData()} units="metric"
        devices={[makeDevice(1, 'dev-1'), makeDevice(2, 'dev-2')]}
        selectedMonitorId={1} onSelectMonitor={onSelectMonitor}
      />,
    );
    const select = screen.getByTestId('temp-chart-monitor-select');
    fireEvent.change(select, { target: { value: '2' } });
    expect(onSelectMonitor).toHaveBeenCalledWith(2);
  });

  it('formats a UTC ISO timestamp as a 12-hour clock label', () => {
    expect(formatTimeLabel('2026-07-27T00:05:00.000Z')).toBe('12:05 AM');
    expect(formatTimeLabel('2026-07-27T13:30:00.000Z')).toBe('1:30 PM');
    expect(formatTimeLabel('2026-07-27T12:00:00.000Z')).toBe('12:00 PM');
  });
});
