// --- Doctor: connectivity probes (Phase 6) + UDP diagnostics ------------------
import { request, type ApiResult } from '../adminHttp';

/** POST /api/doctor/mqtt — live-tests the MQTT broker connection for the HA setup wizard. A
 * blank/masked password falls back to the stored secret server-side, so an existing config
 * can be re-tested without re-typing it. */
export function testMqttConnection(body: {
  url: string; username?: string; password?: string;
}): Promise<ApiResult<{ ok: boolean; detail: string }>> {
  return request('/api/doctor/mqtt', { method: 'POST', body: JSON.stringify(body) });
}

export function doctorCloud(): Promise<ApiResult<{ ok: boolean; detail: string; deviceCount?: number; latencyMs?: number }>> {
  return request('/api/doctor/cloud', { method: 'POST', body: JSON.stringify({}) });
}

export function doctorListen(seconds = 10): Promise<ApiResult<{ seconds: number; total: number; perMonitor: { monitor: string; events: number }[]; rawSamples: { raw: string; ts: string }[] }>> {
  return request('/api/doctor/listen', { method: 'POST', body: JSON.stringify({ seconds }) });
}

export function doctorEnv(): Promise<ApiResult<{ inDocker: boolean; hint: string }>> {
  return request('/api/doctor/env');
}

export function doctorGovee(): Promise<ApiResult<{ ok: boolean; detail: string; sensorCount?: number }>> {
  return request('/api/doctor/govee', { method: 'POST', body: JSON.stringify({}) });
}

/** Per-device UDP receipt timeline (GET /api/doctor/udp-history). */
export interface UdpDeviceHistory {
  serial: string;
  totalPackets: number;
  firstSeen: string;
  lastSeen: string;
  coveragePct: number;
  gaps: { from: string; to: string; minutes: number }[];
}

export function doctorUdpHistory(hours = 24): Promise<ApiResult<{ hours: number; devices: UdpDeviceHistory[] }>> {
  return request(`/api/doctor/udp-history?hours=${hours}`);
}

export function doctorUdpRaw(): Promise<ApiResult<{ packets: { raw: string; ts: string; serial?: string }[] }>> {
  return request('/api/doctor/udp-raw');
}
