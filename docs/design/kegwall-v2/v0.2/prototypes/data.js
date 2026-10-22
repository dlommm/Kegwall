// Synthetic taproom shared by every V2 prototype. Same beers/levels as the baseline capture.
// Pints = remaining mL / 473 (16 oz), rounded down — what Kegwall can actually compute.
window.TAPS = [
  { n: 1, name: 'Citra Haze', brewery: 'Garage Brewing', style: 'Hazy IPA', abv: 6.8, ibu: 45, srm: '#F3C43A', pct: 83, art: null, tapped: 'Saturday' },
  { n: 2, name: 'Vienna Nights', brewery: 'Garage Brewing', style: 'Vienna Lager', abv: 5.0, ibu: 22, srm: '#C4701F', pct: 50, art: null, tapped: 'Oct 9' },
  { n: 3, name: 'Belgian Sun', brewery: 'Abbey Road Ales', style: 'Belgian Tripel', abv: 9.1, ibu: 28, srm: '#E9B530', pct: 94, art: null, tapped: 'Sunday' },
  { n: 4, name: 'Midnight Oats', brewery: 'Garage Brewing', style: 'Oatmeal Stout', abv: 5.6, ibu: 32, srm: '#2B1209', pct: 4, art: null, tapped: 'Sep 30' },
  { n: 5, name: 'The Extraordinarily Long-Named Double Dry-Hopped Imperial West Coast IPA', brewery: 'Bottle Logic Brewing & Fermentation Laboratory', style: 'Double IPA', abv: 8.4, ibu: 85, srm: '#E0A02A', pct: 61, art: null, tapped: 'Oct 14' },
  { n: 6, name: 'Kriek Reserve', brewery: 'Wild Cellar', style: 'Fruited Sour', abv: 6.0, ibu: 10, srm: '#8E2621', pct: 30, art: null, tapped: 'Tuesday', isNew: true },
  { n: 7, name: 'Helles Yeah', brewery: 'Garage Brewing', style: 'Munich Helles', abv: 4.8, ibu: 18, srm: '#F6DC62', pct: 72, art: null, tapped: 'Oct 11' },
  { n: 8, name: 'Campfire Porter', brewery: 'Smokestack', style: 'Smoked Porter', abv: 6.2, ibu: 35, srm: '#4A1D0C', pct: 18, art: null, tapped: 'Oct 2' },
  { n: 9, name: 'Weiss Guy', brewery: 'Garage Brewing', style: 'Hefeweizen', abv: 5.2, ibu: 12, srm: '#F0C64A', pct: 100, art: null, tapped: 'today' },
  { n: 10, name: 'Orchard Dry', brewery: 'Hillside Cider', style: 'Cider', abv: 6.5, ibu: null, srm: '#E8C46A', pct: 40, art: null, tapped: 'Oct 12' },
  { n: 11, name: 'Old Thunder', brewery: 'Garage Brewing', style: 'English Barleywine', abv: 11.5, ibu: 60, srm: '#8E4416', pct: 9, art: null, tapped: 'Sep 21' },
  { n: 12, name: 'Gourd Times', brewery: 'Garage Brewing', style: 'Pumpkin Ale', abv: 5.5, ibu: 20, srm: '#B5651D', pct: 0, art: null, kicked: true, tapped: 'Sep 12' },
];
const KEG_ML = 19000, PINT_ML = 473;
for (const t of window.TAPS) {
  t.pints = Math.floor((KEG_ML * t.pct / 100) / PINT_ML);
  t.fullPints = Math.floor(KEG_ML / PINT_ML);
  t.low = !t.kicked && t.pct < 10;
  t.initials = t.name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('');
}
window.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
window.WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
// Color helpers: a beer's SRM color drives fields and markers, so ink must be chosen per beer.
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const c = hexToRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
window.inkOn = (h) => (lum(h) > 0.32 ? '#14110D' : '#F7F4EE');
window.shade = (h, f) => '#' + hexToRgb(h).map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('');
// The tap marker: Kegwall's own "label" for every beer — its color, its initials, its tap number.
window.marker = (t, size, opts = {}) => `<span class="marker" style="width:${size}px;height:${size}px;background:${t.kicked ? '#2A2723' : t.srm};color:${t.kicked ? '#8C857A' : inkOn(t.srm)};font-size:${Math.round(size * 0.42)}px${opts.style ? ';' + opts.style : ''}">${t.initials}</span>`;
// Derived per-tap figures Kegwall already has: public price (Settings › Pricing, shown when the
// owner turns prices on), oz poured tonight and the hourly pour count (pours table), and the kick
// forecast (kegForecast: pints left ÷ recent pace).
const TONIGHT = { 1: [0, 1, 1, 2, 3], 2: [0, 0, 1, 1, 2], 3: [0, 0, 0, 1, 1], 4: [1, 0, 1, 0, 0], 5: [0, 1, 1, 1, 2], 6: [0, 0, 1, 2, 2], 7: [0, 0, 1, 1, 1], 8: [0, 0, 0, 1, 0], 9: [0, 0, 0, 0, 1], 10: [0, 1, 0, 0, 1], 11: [0, 0, 1, 0, 0] };
for (const t of window.TAPS) {
  t.price = t.abv >= 9 ? 9 : t.abv >= 7 ? 8 : t.abv >= 6 ? 7.5 : 7;
  t.hours = TONIGHT[t.n] ?? [0, 0, 0, 0, 0];
  t.tonightOz = Math.round(t.hours.reduce((a, b) => a + b, 0) * 14.2);
  t.kickDays = t.kicked ? 0 : t.low ? 1 : Math.max(2, Math.round(t.pints / 3.5));
}
window.money = (v) => '$' + (v % 1 ? v.toFixed(2) : v);
