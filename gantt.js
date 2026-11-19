/* Diagramme de Gantt : périodes Étude (bleu) et Pose (orange) de chaque carte et de ses parties. */
var t = window.TrelloPowerUp.iframe();

var KEY = 'planning';
var DAY = 86400000;
var LEFT_W = 320;
var ZOOMS = { jour: 44, semaine: 22, mois: 8 }; // pixels par jour
var DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
var COLORS = { e: '#579dff', p: '#faa53d', trello: '#b3b9c4' };
var NAMES = { e: 'Étude', p: 'Pose', trello: 'Dates Trello' };

var state = { zoom: 'semaine', hideDone: false, showParts: true, sort: 'pose', group: true, lists: [], cards: [] };
var PREFS = ['zoom', 'hideDone', 'showParts', 'sort', 'group'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function day0(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function iso(s) { var p = s.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function daysBetween(a, b) { return Math.round((day0(b) - day0(a)) / DAY); }
function fmt(d) { return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); }
function key(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
function monday(d) { var x = day0(d), w = (x.getDay() + 6) % 7; return addDays(x, -w); }
function isoWeek(d) {
  var x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var wd = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - wd);
  var y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - y0) / DAY + 1) / 7);
}
function short(d) { return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2); }
function span(r) { return r ? { s: iso(r[0]), e: iso(r[1]) } : null; }

/* Lit les données Étude / Pose enregistrées sur une carte */
function planningOf(card) {
  if (Array.isArray(card.pluginData) && card.pluginData.length) {
    for (var i = 0; i < card.pluginData.length; i++) {
      try { var v = JSON.parse(card.pluginData[i].value); if (v && v[KEY]) return Promise.resolve(v[KEY]); } catch (e) { /* ignore */ }
    }
  }
  return t.get(card.id, 'shared', KEY).catch(function () { return null; });
}

/* Transforme une carte en ligne(s) de Gantt */
function toRow(c, p) {
  p = p || {};
  var row = { id: c.id, name: c.name, idList: c.idList, done: !!c.dueComplete, bars: [], parts: [] };
  if (p.e) row.bars.push({ k: 'e', r: span(p.e) });
  if (p.p) row.bars.push({ k: 'p', r: span(p.p) });
  if (!row.bars.length && (c.start || c.due)) {
    var s = day0(c.start || c.due), e = day0(c.due || c.start);
    if (s > e) { var x = s; s = e; e = x; }
    row.bars.push({ k: 'trello', r: { s: s, e: e }, milestone: !(c.start && c.due) });
  }
  Object.keys(p.items || {}).forEach(function (k) {
    var it = p.items[k], bars = [];
    if (it.e) bars.push({ k: 'e', r: span(it.e) });
    if (it.p) bars.push({ k: 'p', r: span(it.p) });
    if (bars.length) row.parts.push({ id: c.id, name: it.n || 'Partie', bars: bars });
  });
  return row;
}
function first(bars) { return Math.min.apply(null, bars.map(function (b) { return b.r.s; })); }
/* Première date d'un type (e = étude, p = pose) sur la carte ou ses parties ; Infinity si aucune */
function firstOf(row, k) {
  var b = allBars(row, true).filter(function (z) { return z.k === k; });
  return b.length ? first(b) : Infinity;
}
function sortKey(row) {
  if (state.sort === 'pose') return firstOf(row, 'p');
  if (state.sort === 'etude') return firstOf(row, 'e');
  if (state.sort === 'tableau') return row.order;
  return first(allBars(row, state.showParts));
}
function byKey(a, b) {
  var ka = sortKey(a), kb = sortKey(b);
  if (ka === kb) return first(allBars(a, true)) - first(allBars(b, true)) || a.order - b.order;
  return ka === Infinity ? 1 : kb === Infinity ? -1 : ka - kb; // sans date de pose/étude : en fin de liste
}
function partKey(p) {
  var k = state.sort === 'pose' ? 'p' : state.sort === 'etude' ? 'e' : null;
  var b = k ? p.bars.filter(function (z) { return z.k === k; }) : p.bars;
  return b.length ? first(b) : Infinity;
}
function allBars(row, withParts) {
  var b = row.bars.slice();
  if (withParts) row.parts.forEach(function (p) { b = b.concat(p.bars); });
  return b;
}

function load() {
  var getCards = t.cards('all').catch(function () {
    return t.cards('id', 'name', 'idList', 'start', 'due', 'dueComplete', 'labels');
  });
  return Promise.all([getCards, t.lists('id', 'name')]).then(function (res) {
    var cards = res[0].filter(function (c) { return !c.closed; });
    state.lists = res[1];
    return Promise.all(cards.map(planningOf)).then(function (plans) {
      state.cards = cards.map(function (c, i) { var r = toRow(c, plans[i]); r.order = i; return r; });
      render();
    });
  }).catch(function (err) {
    document.getElementById('chart').innerHTML = '<p class="msg">Impossible de lire le tableau : ' + esc(err && err.message || err) + '</p>';
  });
}

/* Dessine les barres d'une ligne ; si Étude et Pose se chevauchent, elles partagent la hauteur */
function barsHtml(bars, x, px, label, cardId, wOf) {
  var overlap = bars.length === 2 && bars[0].r.s <= bars[1].r.e && bars[1].r.s <= bars[0].r.e;
  return bars.map(function (b, i) {
    var dur = Math.round(wOf(b.r.s, b.r.e) / px);
    var tip = label + '\n' + NAMES[b.k] + ' : ' + (+b.r.s === +b.r.e ? 'le ' + fmt(b.r.s) : fmt(b.r.s) + ' → ' + fmt(b.r.e) + ' (' + dur + ' j ouvré' + (dur > 1 ? 's' : '') + ')');
    if (b.milestone)
      return '<div class="milestone" data-card="' + cardId + '" style="left:' + (x(b.r.s) + px / 2 - 8) + 'px;background:' + COLORS[b.k] + '" title="' + esc(tip) + '"></div>';
    var w = Math.max(wOf(b.r.s, b.r.e), 6);
    var cls = 'bar' + (overlap ? (i === 0 ? ' upper' : ' lower') : '');
    var txt = !overlap && w > 50 ? NAMES[b.k] : '';
    return '<div class="' + cls + '" data-card="' + cardId + '" style="left:' + x(b.r.s) + 'px;width:' + w + 'px;background:' + COLORS[b.k] + '" title="' + esc(tip) + '">' + txt + '</div>';
  }).join('');
}

function render() {
  var chart = document.getElementById('chart');
  var px = ZOOMS[state.zoom];
  var rows = state.cards.filter(function (r) {
    return !(state.hideDone && r.done) && allBars(r, state.showParts).length;
  });
  var hidden = state.cards.filter(function (r) { return !allBars(r, true).length; }).length;

  document.querySelectorAll('[data-zoom]').forEach(function (b) {
    b.classList.toggle('active', b.dataset.zoom === state.zoom);
  });
  document.getElementById('info').textContent =
    rows.length + ' carte(s) planifiée(s)' + (hidden ? ' · ' + hidden + ' sans date' : '');

  if (!rows.length) {
    chart.innerHTML = '<p class="msg">Aucune carte planifiée. Ouvrez une carte et cliquez sur « Planning étude / pose » pour saisir ses dates.</p>';
    return;
  }

  // Bornes de la frise
  var today = day0(new Date()), min = today, max = today;
  rows.forEach(function (r) {
    allBars(r, state.showParts).forEach(function (b) { if (b.r.s < min) min = b.r.s; if (b.r.e > max) max = b.r.e; });
  });
  // Frise en jours ouvrés uniquement (lundi → vendredi), qui commence un lundi
  min = monday(addDays(min, -3));
  max = addDays(max, state.zoom === 'mois' ? 35 : 14);
  var work = [], pos = {}; // pos[clé jour] = nb de jours ouvrés avant ce jour
  for (var c = new Date(min), n = 0; c <= addDays(max, 1); c = addDays(c, 1)) {
    pos[key(c)] = n;
    if (c.getDay() !== 0 && c.getDay() !== 6) { if (c <= max) work.push(new Date(c)); n++; }
  }
  var W = work.length * px;
  var x = function (d) { var v = pos[key(d)]; return (v == null ? (d < min ? 0 : work.length) : v) * px; };
  var wOf = function (s, e) { return x(addDays(e, 1)) - x(s); };

  // Fond : un trait fin par jour, un trait marqué par semaine, une semaine sur deux grisée, ligne du jour
  var bg = '';
  work.forEach(function (d, i) {
    var isMon = d.getDay() === 1;
    if (isMon && isoWeek(d) % 2 === 0) bg += '<div class="weekband" style="left:' + (i * px) + 'px;width:' + (5 * px) + 'px"></div>';
    if (isMon) bg += '<div class="tick week" style="left:' + (i * px) + 'px"></div>';
    else if (state.zoom !== 'mois') bg += '<div class="tick" style="left:' + (i * px) + 'px"></div>';
  });
  var tw = today.getDay();
  if (tw !== 0 && tw !== 6) bg += '<div class="todayline" style="left:' + (x(today) + px / 2) + 'px" title="Aujourd\'hui"></div>';

  // En-tête : mois / semaines / jours
  var top = '', mid = '', bottom = '';
  var cur = new Date(min.getFullYear(), min.getMonth(), 1);
  while (cur <= max) {
    var next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    var l = x(cur < min ? min : cur), r = x(next > max ? addDays(max, 1) : next);
    if (r > l) top += '<div class="hcell top" style="left:' + l + 'px;width:' + (r - l) + 'px">' + MONTHS[cur.getMonth()] + ' ' + cur.getFullYear() + '</div>';
    cur = next;
  }
  work.forEach(function (d, i) {
    if (d.getDay() === 1) {
      var lbl = state.zoom === 'mois' ? 'S' + isoWeek(d) : 'Semaine ' + isoWeek(d);
      if (state.zoom === 'semaine') lbl = 'S' + isoWeek(d) + ' · ' + d.getDate() + '/' + (d.getMonth() + 1);
      mid += '<div class="hcell mid' + (isoWeek(d) % 2 === 0 ? ' alt' : '') + '" style="left:' + (i * px) + 'px;width:' + (5 * px) + 'px">' + lbl + '</div>';
    }
    if (state.zoom !== 'mois') {
      var isToday = +d === +today;
      var txt = state.zoom === 'jour' ? DAYS[d.getDay()] + ' ' + d.getDate() : d.getDate();
      bottom += '<div class="hcell bottom' + (isToday ? ' today' : '') + (d.getDay() === 1 ? ' mon' : '') + '" style="left:' + (i * px) + 'px;width:' + px + 'px">' + txt + '</div>';
    }
  });

  // Lignes : (liste) > carte > parties, triées selon le choix
  var html = '';
  var groups = state.group
    ? state.lists.map(function (list) { return { name: list.name, rows: rows.filter(function (r) { return r.idList === list.id; }) }; })
    : [{ name: null, rows: rows }];
  var listName = {};
  state.lists.forEach(function (l) { listName[l.id] = l.name; });
  // Petite indication à droite du nom : date de pose / d'étude (si tri), liste d'origine (si non regroupé)
  function hint(r) {
    var h = '';
    if (state.sort === 'pose' || state.sort === 'etude') {
      var k = sortKey(r);
      h += '<em class="hint ' + (state.sort === 'pose' ? 'p' : 'e') + '">' + (k === Infinity ? '—' : short(new Date(k))) + '</em>';
    }
    if (!state.group) h += '<em class="tag" title="' + esc(listName[r.idList] || '') + '">' + esc(listName[r.idList] || '') + '</em>';
    return h;
  }
  groups.forEach(function (g) {
    var lr = g.rows.slice().sort(byKey);
    if (!lr.length) return;
    if (g.name != null)
      html += '<div class="row listrow"><div class="left" title="' + esc(g.name) + '"><span>' + esc(g.name) +
        '</span><em>' + lr.length + '</em></div><div class="track" style="width:' + W + 'px"></div></div>';

    lr.forEach(function (r) {
      var b = r.bars;
      // Carte sans dates propres mais avec des parties : trait de synthèse
      var extra = '';
      if (!b.length && r.parts.length) {
        var pb = allBars(r, true);
        var s = pb.reduce(function (m, z) { return z.r.s < m ? z.r.s : m; }, pb[0].r.s);
        var e = pb.reduce(function (m, z) { return z.r.e > m ? z.r.e : m; }, pb[0].r.e);
        extra = '<div class="summary" style="left:' + x(s) + 'px;width:' + Math.max(wOf(s, e), 6) + 'px" title="Ensemble des parties"></div>';
      }
      html += '<div class="row cardrow' + (r.done ? ' done' : '') + '"><div class="left" data-card="' + r.id + '" title="' + esc(r.name) + '"><span>' + esc(r.name) + '</span>' + hint(r) + '</div>' +
        '<div class="track" style="width:' + W + 'px">' + extra + barsHtml(b, x, px, r.name, r.id, wOf) + '</div></div>';

      if (state.showParts) r.parts.slice().sort(function (a, b) { var d = partKey(a) - partKey(b); return isNaN(d) ? 0 : d; }).forEach(function (p) {
        html += '<div class="row partrow' + (r.done ? ' done' : '') + '"><div class="left" data-card="' + r.id + '" title="' + esc(p.name) + '"><span>↳ ' + esc(p.name) + '</span></div>' +
          '<div class="track" style="width:' + W + 'px">' + barsHtml(p.bars, x, px, r.name + ' — ' + p.name, r.id, wOf) + '</div></div>';
      });
    });
  });

  var scroll = chart.scrollLeft, keep = chart.querySelector('.grid');
  chart.innerHTML =
    '<div class="grid" style="width:' + (LEFT_W + W) + 'px">' +
      '<div class="overlay" style="left:' + LEFT_W + 'px;width:' + W + 'px">' + bg + '</div>' +
      '<div class="row head"><div class="left">Liste / dossier</div><div class="track" style="width:' + W + 'px">' + top + mid + bottom + '</div></div>' +
      html +
    '</div>';
  chart.dataset.todayX = LEFT_W + x(today);
  if (keep && !state.rezoomed) chart.scrollLeft = scroll; else scrollToToday();
  state.rezoomed = false;
}

function scrollToToday() {
  var chart = document.getElementById('chart');
  chart.scrollLeft = Math.max(0, Number(chart.dataset.todayX || 0) - LEFT_W - 120);
}

document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-card]');
  if (el) t.showCard(el.dataset.card);
  var z = e.target.closest('[data-zoom]');
  if (z) { state.zoom = z.dataset.zoom; state.rezoomed = true; savePrefs(); render(); }
});
document.getElementById('today').addEventListener('click', scrollToToday);
document.getElementById('hideDone').addEventListener('change', function (e) { state.hideDone = e.target.checked; savePrefs(); render(); });
document.getElementById('showParts').addEventListener('change', function (e) { state.showParts = e.target.checked; savePrefs(); render(); });
document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; savePrefs(); render(); });
document.getElementById('group').addEventListener('change', function (e) { state.group = e.target.checked; savePrefs(); render(); });

/* Préférences d'affichage mémorisées pour chaque utilisateur */
function savePrefs() {
  var p = {};
  PREFS.forEach(function (k) { p[k] = state[k]; });
  t.set('member', 'private', 'ganttPrefs', p).catch(function () {});
}
function applyPrefs(p) {
  if (p) PREFS.forEach(function (k) { if (p[k] !== undefined) state[k] = p[k]; });
  document.getElementById('sort').value = state.sort;
  document.getElementById('group').checked = state.group;
  document.getElementById('showParts').checked = state.showParts;
  document.getElementById('hideDone').checked = state.hideDone;
}

// Se redessine automatiquement quand le tableau change
t.get('member', 'private', 'ganttPrefs').catch(function () { return null; }).then(function (p) {
  applyPrefs(p);
  t.render(load);
});
