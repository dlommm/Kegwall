// V2 look library v0.4 — each look redrawn from its name; IDs unchanged so saved walls keep working.
// Rule for every look: what's left is shown as a picture (fill, gauge, plate, tally) and in pints.
const id = (location.hash || '#classic').slice(1);
const on = TAPS.filter((t) => !t.kicked);
const eight = TAPS.slice(0, 8);
const BRAND = 'Garage Brewing Co.', CLOCK = '8:42 PM', TEMP = '38°F';
const ink = inkOn;
const liq = (t) => (lum(t.srm) < 0.03 ? shade(t.srm, 2.4) : t.srm);       // very dark beers need lift to read as a level
const pintsWord = (n) => (n === 1 ? 'pint' : 'pints');
const left = (t) => (t.kicked ? 'Kicked' : t.low ? `Last ${t.pints === 1 ? 'pint' : t.pints + ' pints'}` : `${t.pints} pints left`);
const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const LOOKS = {
  // The archetypal tap list: every card is its keg, filled in the beer's deep tone to the level.
  classic: () => `
    <header><h1 class="bs">${BRAND}</h1><span class="num">${CLOCK} · ${TEMP} · page 1 of 2</span></header>
    <div class="grid">${eight.map((t) => `<div class="card ${t.low ? 'low' : ''}" style="--beer:${liq(t)}">
      <div class="fill" style="height:${t.pct}%;background:${shade(liq(t), 0.42)}"></div>
      <div class="top">${marker(t, 72)}<span class="tn bs num">Tap ${t.n}</span></div>
      <h2 class="bs">${esc(t.name)}</h2><span class="st">${esc(t.style)} · ${t.abv}%</span>
      <div class="pl num"><b>${t.pints}</b><span>${pintsWord(t.pints)} left</span></div></div>`).join('')}</div>`,

  // The cellar ledger: when each keg went on, what poured tonight, what's left, when it kicks.
  ledger: () => `
    <header><h1 class="bs">The cellar ledger</h1><p class="num">${BRAND} · ${CLOCK} · 21 pours tonight</p></header>
    <div class="th"><span>Tap</span><span>Beer</span><span>Tapped</span><span>Tonight</span><span>Left in the keg</span><span style="text-align:right">Kicks in</span></div>
    <div class="rows">${TAPS.slice(0, 11).map((t) => `<div class="r ${t.low ? 'low' : ''}">
      <span class="n num">${t.n}</span>
      <span style="min-width:0;display:flex;gap:16px;align-items:center">${marker(t, 44)}<span style="min-width:0"><h2 class="bs ell">${esc(t.name)}</h2><div class="st ell">${esc(t.style)} · ${t.abv}%</div></span></span>
      <span class="v num">${esc(t.tapped)}</span><span class="v num">${t.tonightOz ? t.tonightOz + ' oz' : '—'}</span>
      <span class="lv"><span class="b"><i style="width:${t.pct}%;background:${liq(t)}"></i></span><b class="num">${t.pints}</b></span>
      <span class="k num">${t.low ? 'about a day' : '≈ ' + t.kickDays + ' days'}</span></div>`).join('')}</div>`,

  // A museum wall: each beer hung as a framed plate painted to its level, with a wall label.
  gallery: () => `
    <header><h1>Now showing at ${BRAND.replace(' Co.', '')}</h1><span class="num">${CLOCK} · eight works, all pouring</span></header>
    <div class="wall">${eight.map((t) => `<div class="work">
      <div class="frame"><div class="canvas"><i style="height:${t.pct}%;background:${liq(t)}"></i></div></div>
      <div class="label ${t.low ? 'low' : ''}"><h2>${esc(t.name)}</h2><p>${esc(t.brewery)}<br>${esc(t.style)}, ${t.abv}%</p><b class="num">${left(t)}</b></div></div>`).join('')}</div>`,

  columns: () => `
    <header><h1 class="bs">${BRAND}</h1><span class="num">${CLOCK} · ${TEMP}</span></header>
    <div class="row">${eight.map((t) => `<div class="col"><div class="lab"><span class="tn bs num">Tap ${t.n}</span>
      <h2 class="bs">${esc(t.name)}</h2><span style="font-size:19px;color:#A9B3BC">${esc(t.style)}</span><span class="abv bs num">${t.abv}%</span></div>
      <div class="keg"><i style="height:${t.pct}%;background:${liq(t)}"></i><span class="num" style="color:${t.pct > 88 ? ink(t.srm) : t.low ? '#F4B740' : '#EEF2F5'}">${t.pints}<small>${pintsWord(t.pints)} left</small></span></div></div>`).join('')}</div>`,

  // The bar's real chalk menu: prices, and the pints left as chalk tally gates.
  chalkboard: () => {
    const gate = (k, c) => { // up to five chalk strokes: four uprights and the strike-through
      let s = ''; for (let i = 0; i < Math.min(k, 4); i++) s += `<path d="M${6 + i * 9} ${4 + (i % 2)} L${5 + i * 9} 40" />`;
      if (k >= 5) s += '<path d="M1 30 L38 10" />';
      return `<svg width="42" height="44" viewBox="0 0 42 44" aria-hidden="true" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round">${s}</svg>`;
    };
    const tally = (t, c) => { let g = '', n = Math.min(t.pints, 30); while (n > 0) { g += gate(Math.min(5, n), c); n -= 5; } return g + (t.pints > 30 ? `<span>+${t.pints - 30}</span>` : ''); };
    return `<header><h1>On tap tonight</h1><p>${BRAND}<br><span class="num">pints ${money(7)} – ${money(9)}</span></p></header>
    <div class="menu">${eight.map((t) => { const c = lum(t.srm) < 0.04 ? '#C9A57A' : t.srm; return `<div class="it" style="--c:${c}">
      <div><h2><em>${t.n}</em>${esc(short(t.name, 22))}</h2><p>${esc(t.style)} · ${t.abv}% · ${t.low ? 'last call!' : t.pints + ' pints left'}</p><div class="tal">${tally(t, c)}</div></div>
      <div class="pr num">${money(t.price)}</div></div>`; }).join('')}</div>`;
  },

  // A magazine feature: the cover story on the newest keg, the rest as the contents page.
  editorial: () => {
    const f = TAPS.find((t) => t.isNew);
    return `<section class="feature" style="--f:${f.srm};--fi:${ink(f.srm)}">
      <div class="kick"><span>${BRAND} · tonight's feature</span><span class="num">Tap ${f.n}</span></div>
      <div><h1>${esc(f.name)}</h1><p>${esc(f.brewery)} aged this sour on cherries and oak. It went on Tuesday and is pouring fast.</p></div>
      <div class="facts num"><span><b>${f.abv}%</b>alcohol</span><span><b>${f.ibu}</b>IBU</span><span><b>${f.pints}</b>pints left</span></div></section>
    <section class="contents"><h2>Also on tap</h2><ol>${on.filter((t) => t !== f).map((t) => `<li><span class="n num">${t.n}</span>
      <div style="min-width:0"><h3 class="ell">${esc(t.name)}</h3><div class="lv num"><i><b style="width:${t.pct}%;background:${liq(t)}"></b></i>${left(t)}</div></div><span class="a num">${t.abv}%</span></li>`).join('')}</ol></section>`;
  },

  // A wall of bar signs: each tap's neon ring is drawn as far round as the keg is full.
  neon: () => `
    <header><h1>${BRAND}</h1><p class="num">open late · ${CLOCK}</p></header>
    <div class="grid">${eight.map((t) => { const c = lum(t.srm) < 0.05 ? '#FF8A3D' : t.srm, C = 2 * Math.PI * 80;
      return `<div class="sign" style="--c:${c}"><div class="ring"><svg viewBox="0 0 190 190" aria-hidden="true"><circle cx="95" cy="95" r="80" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="7"/>
        <circle cx="95" cy="95" r="80" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C * t.pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 95 95)"/></svg>
        <span class="num">${t.pints}<small>${pintsWord(t.pints)} left</small></span></div>
        <h2 class="ell">${esc(t.name)}</h2><p>Tap ${t.n} · ${esc(t.style)} · ${t.abv}%</p></div>`; }).join('')}</div>`,

  // A live `top` for the taps: level bars, tonight's pours as sparklines, and the pour log tail.
  terminal: () => {
    const bar = (t) => { const f = Math.round(t.pct / 5); return '█'.repeat(f) + '░'.repeat(20 - f); };
    const spark = (h) => h.map((v) => ' ▁▃▅▇'[Math.min(v, 4)]).join('');
    const rows = TAPS.map((t) => {
      const nm = short(t.name, 28).padEnd(29);
      if (t.kicked) return `<span class="d">${String(t.n).padStart(3)}  ${nm}  kicked mon          ────────────────────   0   next: harvest märzen</span>`;
      return `${String(t.n).padStart(3)}  <span class="h">${esc(nm)}</span>  <span class="d">${t.style.toLowerCase().padEnd(18).slice(0, 18)}</span>  <span class="${t.low ? 'w' : ''}">${bar(t)}  ${String(t.pints).padStart(2)}</span>   ${spark(t.hours)}  ${String(t.tonightOz).padStart(3)} oz`;
    });
    return `<pre><span class="h">kegwall top</span> <span class="d">— ${CLOCK.toLowerCase()} · kegerator ${TEMP} · 11 on tap · 21 pours · udp ok · cloud down</span>

<span class="inv">TAP  BEER                           STYLE               LEFT IN KEG          PINTS  4–8 PM  TONIGHT</span>
${rows.join('\n')}

<span class="d">pour log</span>
<span class="d">20:41:07</span>  tap 1   citra haze        13.9 oz   alex rivera
<span class="d">20:38:52</span>  tap 2   vienna nights     12.0 oz   <span class="w">unclaimed</span>
<span class="d">20:31:15</span>  tap 6   kriek reserve     11.4 oz   jordan  ▌</pre>`;
  },

  // A festival line-up poster: the newest keg headlines, the rest step down. The bar under the
  // headliner is every keg's level side by side.
  poster: () => {
    const head = TAPS.find((t) => t.isNew), rest = on.filter((t) => t !== head);
    const line = (list, size) => `<div class="line" style="font-size:${size}px">${list.map((t) => `<span>${esc(short(t.name, 26))}<em class="num">${t.pints} left</em></span>`).join('<span style="opacity:.35">·</span>')}</div>`;
    return `<div class="pre">${BRAND} presents · tonight · ${CLOCK}</div>
      <div class="line" style="font-size:230px;color:${head.srm};margin-top:10px"><span>${esc(head.name)}</span></div>
      <div class="pre num" style="font-size:34px">${esc(head.brewery)} · ${head.style} · ${head.abv}% · ${head.pints} pints left</div>
      <div class="bar" aria-label="Every keg's level">${on.map((t) => `<i style="background:linear-gradient(to top, ${liq(t)} ${t.pct}%, #DCD2BE ${t.pct}%)"></i>`).join('')}</div>
      ${line(rest.slice(0, 2), 128)}${line(rest.slice(2, 5), 96)}${line(rest.slice(5), 74)}
      <div class="foot num"><span>Also: Gourd Times, kicked Monday</span><span>Scan the QR for the menu and to claim your pour</span></div>`;
  },

  // Kegs as flights, sorted by when each keg kicks. Boarding = last call, Pouring = gate open.
  departures: () => {
    const flap = (s, n) => `<span class="flap">${s.toUpperCase().slice(0, n).padEnd(n).split('').map((c) => `<i>${c === ' ' ? '&nbsp;' : esc(c)}</i>`).join('')}</span>`;
    const sorted = [...TAPS].sort((a, b) => (a.kicked ? 99 : a.kickDays) - (b.kicked ? 99 : b.kickDays) || a.pints - b.pints);
    const status = (t) => t.kicked ? '<span class="st gone">DEPARTED MON</span>' : t.n === 2 ? '<span class="st po">POURING NOW</span>' : t.low ? '<span class="st br">BOARDING · LAST CALL</span>' : '<span class="st ok">ON TAP</span>';
    return `<header><h1>DEPARTURES</h1><span class="num">${CLOCK}</span></header>
    <div class="th"><span>TAP</span><span>BEER</span><span>PINTS LEFT</span><span>DEPARTS IN</span><span>STATUS</span></div>
    ${sorted.slice(0, 11).map((t) => `<div class="tr"><span>${flap(String(t.n).padStart(2, '0'), 2)}</span><span>${flap(t.name, 20)}</span>
      <span>${flap(t.kicked ? '--' : String(t.pints).padStart(2, '0'), 2)}</span><span class="sm num">${t.kicked ? '—' : t.low ? '~1 DAY' : '~' + t.kickDays + ' DAYS'}</span>${status(t)}</div>`).join('')}`;
  },

  // One beer at a time. The orb holds what's left; the list beside it shows everyone's level.
  zen: () => {
    const f = TAPS.find((t) => t.isNew);
    return `<main><div class="orb" role="img" aria-label="${f.pct}% left"><i style="height:${f.pct}%;background:${f.srm}"></i></div>
      <div><span class="k num">Tap ${f.n} · one of eleven tonight</span><h1>${esc(f.name)}</h1>
      <p>${esc(f.brewery)}'s fruited sour, tart with cherry and oak. ${f.abv}%. <b>About ${f.pints} pints left.</b></p></div></main>
    <aside>${on.map((t) => `<div class="${t === f ? 'on' : ''}"><span class="ell">${esc(t.name)}</span><span class="num" style="text-align:right">${t.pints}</span><i><b style="width:${t.pct}%;background:${liq(t)}"></b></i></div>`).join('')}</aside>`;
  },
};
const stage = document.getElementById('stage');
stage.classList.add('look-' + id);
stage.innerHTML = LOOKS[id]();
