import { describe, it, expect } from 'vitest';
import { parseBthomeServiceData } from '../../src/server/ingest/bthome.js';

const svc = (...bytes: number[]) => Buffer.from(bytes);

describe('parseBthomeServiceData', () => {
  it('parses motion true and false', () => {
    expect(parseBthomeServiceData(svc(0x40, 0x21, 0x01))).toEqual({ encrypted: false, motion: true });
    expect(parseBthomeServiceData(svc(0x40, 0x21, 0x00))).toEqual({ encrypted: false, motion: false });
  });
  it('skips encrypted adverts', () => {
    expect(parseBthomeServiceData(svc(0x41, 0xde, 0xad))).toEqual({ encrypted: true, motion: null });
  });
  it('walks past packet-id and battery objects to reach motion', () => {
    expect(parseBthomeServiceData(svc(0x40, 0x00, 0x0b, 0x01, 0x64, 0x21, 0x01)))
      .toEqual({ encrypted: false, motion: true });
  });
  it('stops at an unknown object id and reports what it has', () => {
    expect(parseBthomeServiceData(svc(0x40, 0x7f, 0x01, 0x21, 0x01)))
      .toEqual({ encrypted: false, motion: null }); // 0x7f unknown → stop before motion
  });
  it('rejects an empty buffer', () => {
    expect(parseBthomeServiceData(Buffer.alloc(0))).toBeNull();
  });
  it('no 0x21 object seen at all → motion: null (device-info byte only)', () => {
    expect(parseBthomeServiceData(svc(0x40))).toEqual({ encrypted: false, motion: null });
  });
  it('a truncated known-length object (buffer ends mid-value) stops without throwing', () => {
    expect(parseBthomeServiceData(svc(0x40, 0x05, 0x01))) // illuminance (len 3) but only 1 byte left
      .toEqual({ encrypted: false, motion: null });
  });

  // Fix round 1 (F3, Minor bundle): walk-order edges the original vectors didn't cover.
  it('motion precedes a subsequent known object (battery) — motion is captured before '
    + 'the walk continues past it', () => {
    expect(parseBthomeServiceData(svc(0x40, 0x21, 0x01, 0x01, 0x64)))
      .toEqual({ encrypted: false, motion: true });
  });

  it('a motion object id with its value byte missing (truncated pair) stops without '
    + 'reporting a motion reading', () => {
    expect(parseBthomeServiceData(svc(0x40, 0x21))).toEqual({ encrypted: false, motion: null });
  });
});
