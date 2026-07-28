import { describe, it, expect } from 'vitest';
import { formatActivityText } from '../../src/web/lib/activityText';
import type { ActivityEvent } from '../../src/server/db/activity';

function pourEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    ts: '2026-07-28T11:00:00.000Z', kind: 'pour', beerName: 'Citra IPA',
    tapNumber: 3, volumeMl: 473, ...overrides,
  };
}

function kegTappedEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    ts: '2026-07-28T10:00:00.000Z', kind: 'keg_tapped', beerName: 'Citra IPA',
    tapNumber: 3, volumeMl: null, ...overrides,
  };
}

describe('formatActivityText', () => {
  it('renders a pour in US units', () => {
    expect(formatActivityText(pourEvent(), 'us')).toBe('Poured 16.0 oz of Citra IPA on tap 3');
  });

  it('renders a pour in metric units', () => {
    expect(formatActivityText(pourEvent(), 'metric')).toBe('Poured 473 mL of Citra IPA on tap 3');
  });

  it('renders a keg-tapped event with the literal plan wording', () => {
    expect(formatActivityText(kegTappedEvent(), 'us')).toBe('Tapped Citra IPA on tap 3');
  });

  it('omits the "on tap N" clause when tapNumber is null', () => {
    expect(formatActivityText(pourEvent({ tapNumber: null }), 'us')).toBe('Poured 16.0 oz of Citra IPA');
    expect(formatActivityText(kegTappedEvent({ tapNumber: null }), 'us')).toBe('Tapped Citra IPA');
  });

  it('uses sentence case and plain verbs, never SRM/liquid jargon', () => {
    const text = formatActivityText(pourEvent(), 'us');
    expect(text[0]).toBe(text[0]!.toUpperCase());
    expect(text.toLowerCase()).not.toContain('srm');
  });
});
