// Direction A wall. MODE 'idle': the newest keg holds the spotlight as a field of its own color.
// MODE 'pour': the spotlight becomes the pouring tap and the field fills from the bottom by the
// measured volume over the serving size — the half of the screen is the glass. No overlay.
const pour = window.MODE === 'pour';
const feat = pour ? TAPS[0] : TAPS.find((t) => t.isNew);
const onTap = TAPS.filter((t) => !t.kicked);
const kicked = TAPS.filter((t) => t.kicked);
const ink = inkOn(feat.srm);
document.documentElement.style.setProperty('--field', shade(feat.srm, pour ? 0.16 : 0.24));
const row = (t) => {
  const isPour = pour && t === feat;
  return `<li class="${t.low ? 'low' : ''} ${!pour && t === feat ? 'feat' : ''} ${isPour ? 'pouring' : ''}">
    <span class="tap num">${t.n}</span>
    ${marker(t, 62)}
    <span style="min-width:0"><div class="nm name">${esc(t.name)}</div><div class="st">${isPour ? 'Pouring now for Alex Rivera' : `${esc(t.style)} · ${t.abv}%`}</div></span>
    <span class="left num"><b>${t.pints}</b><span>${t.pints === 1 ? 'pint' : 'pints'} left</span></span>
  </li>`;
};
const oz = 8.0, serving = 16;
const hero = pour
  ? `<section class="hero pour" style="background:#0D0C0B">
       <div class="liquid" style="height:${(oz / serving) * 74}%;background:${feat.srm}"></div>
       <div class="ticks">${[16, 12, 8, 4].map((v) => `<span style="bottom:${(v / serving) * 74}%">${v} oz</span>`).join('')}</div>
       <div class="top-copy"><span class="tapno">Tap ${feat.n}</span><h1 class="name" style="font-size:150px">${esc(feat.name)}</h1></div>
       <div class="copy" style="color:${ink}">
         <div class="live num"><b>${oz.toFixed(1)}</b><span style="color:${ink};opacity:.7">oz</span></div>
         <p><b>Pouring for Alex Rivera.</b> Measured by the Kegtron as it flows: 236 mL so far.</p>
       </div>
     </section>`
  : `<section class="hero" style="background:${feat.srm};color:${ink}">
       <span class="bignum num" style="color:${shade(feat.srm, 0.8)}">${feat.n}</span>
       <div class="copy">
         <h1 class="name">${esc(feat.name)}</h1>
         <p><b>Just tapped on tap ${feat.n}.</b> ${esc(feat.brewery)}'s ${feat.style.toLowerCase()}, ${feat.abv}% and about ${feat.pints} pints left in the keg.</p>
       </div>
     </section>`;
document.getElementById('stage').innerHTML = `${hero}
  <section class="list">
    <div class="top"><span class="brand">Garage Brewing Co.</span><span class="meta num">8:42 PM · kegerator 38°F</span></div>
    <ol>${onTap.map(row).join('')}</ol>
    <div class="foot">
      <p>${kicked.map((k) => esc(k.name)).join(', ')} kicked Monday. Harvest Märzen goes on next.</p>
      <span class="qr">Menu and<br>claim your pour<i>QR</i></span>
    </div>
  </section>`;
