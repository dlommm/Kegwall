import { describe, it, expect } from 'vitest';
import { TabletArmRegistry, ARM_TTL_MS } from '../../src/server/core/tabletArm.js';

describe('TabletArmRegistry', () => {
  it('arms a pourer and reports them current until consumed', () => {
    const reg = new TabletArmRegistry();
    expect(reg.current(0)).toBeNull();
    reg.arm(7, 0);
    expect(reg.current(1000)?.drinkerId).toBe(7);
    expect(reg.consume(2000)).toBe(7);
    expect(reg.current(2000)).toBeNull();
    // One pour per arming: a second consume gets nothing.
    expect(reg.consume(2000)).toBeNull();
  });

  it('expires an arming after the TTL', () => {
    const reg = new TabletArmRegistry();
    reg.arm(7, 0);
    expect(reg.current(ARM_TTL_MS - 1)?.drinkerId).toBe(7);
    expect(reg.current(ARM_TTL_MS)).toBeNull();
    expect(reg.consume(ARM_TTL_MS + 1)).toBeNull();
  });

  it('re-arming replaces the slot; disarm clears it', () => {
    const reg = new TabletArmRegistry();
    reg.arm(7, 0);
    reg.arm(9, 100);
    expect(reg.current(200)?.drinkerId).toBe(9);
    reg.disarm();
    expect(reg.current(300)).toBeNull();
  });
});
