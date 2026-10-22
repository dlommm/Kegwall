// Shared admin shell for the V2 prototypes.
window.NAV = ['Tonight', 'Taps & kegs', 'Beers', 'People', 'Screens', 'Insights'];
window.topNav = (active, extra = '') => `<nav class="top"><a class="brand" href="#">Garage Brewing Co.</a>
  ${NAV.map((n) => `<a class="${n === active ? 'on' : ''}" href="#">${esc(n)}</a>`).join('')}
  <span class="sp"></span><span class="kbd">Search · Ctrl K</span>
  <a class="bell" href="#" aria-label="Notifications, 3 new"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg><i>3</i></a>
  <a class="${active === 'Settings' ? 'on' : ''}" href="#">Settings</a><span class="me">O</span>${extra}</nav>`;
// Every page uses the same header: where you are, a sentence, one line, at most one primary action.
window.pageHead = ({ crumb, title, sub, actions = '' }) => `<header class="ph"><div>${crumb ? `<div class="crumb">${crumb}</div>` : ''}<h1 class="say">${title}</h1>${sub ? `<p class="say">${sub}</p>` : ''}</div><div class="acts">${actions}</div></header>`;
window.subTabs = (list, active) => `<div class="subtabs" role="tablist">${list.map((x) => { const [n, c] = Array.isArray(x) ? x : [x]; return `<a role="tab" aria-selected="${n === active}" class="${n === active ? 'on' : ''}" href="#">${n}${c != null ? `<small>${c}</small>` : ''}</a>`; }).join('')}</div>`;
window.SUB = {
  'Taps & kegs': [['Taps', 12], ['Kegs', 15], ['On deck', 2], ['Line cleaning', 11], ['Suppliers', 3], ['Monitors', 4]],
  People: [['Pourers', 7], ['Accounts', 2], ['Leaderboard'], ['Face sign-in', 3]],
  Screens: [['Walls', 2], ['Displays', 3], ['Presence and power'], ['Tablet kiosk', 1], ['Games', 100]],
  Insights: [['Overview'], ['Every pour', '2 to assign'], ['Beers and styles'], ['Kegs and cost'], ['People'], ['Temperature'], ['System']],
};
// Run-state glyphs: shape and colour both carry the state.
window.STATE = {
  enabled: ['#86D49A', '<circle cx="9" cy="9" r="6" fill="currentColor"/>', 'On'],
  disabled: ['#8C857A', '<circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2"/>', 'Off'],
  pending: ['#8FB4E0', '<circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 5.5V9l2.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', 'Waiting'],
  executing: ['#F4B740', '<path d="M9 2.5a6.5 6.5 0 1 1-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>', 'Running'],
  completed: ['#86D49A', '<path d="M3.5 9.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>', 'Done'],
  failed: ['#FF7A66', '<path d="M4.5 4.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>', 'Failed'],
};
window.stateTag = (k, label) => { const [c, svg, l] = STATE[k]; return `<span class="state" style="color:${c}"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">${svg}</svg>${label ?? l}</span>`; };
