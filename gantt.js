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
var NAMES_DEL = { e: 'Étude supprimée', p: 'Pose supprimée' };

var state = { zoom: 'semaine', hideDone: false, showParts: true, showUndated: true, sort: 'pose', group: true, tool: 'e', hiddenLists: [], search: '', lists: [], cards: [], plans: {}, geo: null };
var PREFS = ['zoom', 'hideDone', 'showParts', 'showUndated', 'sort', 'group', 'tool', 'hiddenLists'];
var MAX = 4096; // limite Trello de stockage par carte

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
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function matches(r) {
  if (!state.search) return true;
  var q = norm(state.search);
  return norm(r.name).indexOf(q) >= 0 || r.parts.some(function (p) { return norm(p.name).indexOf(q) >= 0; });
}
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
  var row = { id: c.id, name: c.name, idList: c.idList, done: !!c.dueComplete, bars: [], parts: [], card: c };
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
    row.parts.push({ id: c.id, pid: k, name: it.n || 'Partie', bars: bars });
  });
  return row;
}
function first(bars) { return bars.length ? Math.min.apply(null, bars.map(function (b) { return b.r.s; })) : Infinity; }
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
      state.plans = {};
      state.cards = cards.map(function (c, i) { state.plans[c.id] = plans[i] || {}; var r = toRow(c, plans[i]); r.order = i; return r; });
      document.getElementById('cardnames').innerHTML = state.cards.map(function (r) { return '<option value="' + esc(r.name) + '">'; }).join('');
      render();
    });
  }).catch(function (err) {
    document.getElementById('chart').innerHTML = '<p class="msg">Impossible de lire le tableau : ' + esc(err && err.message || err) + '</p>';
  });
}

/* Dessine les barres d'une ligne ; si Étude et Pose se chevauchent, elles partagent la hauteur */
function barsHtml(bars, x, px, label, cardId, wOf, partId) {
  var overlap = bars.length === 2 && bars[0].r.s <= bars[1].r.e && bars[1].r.s <= bars[0].r.e;
  return bars.map(function (b, i) {
    var dur = Math.round(wOf(b.r.s, b.r.e) / px);
    var tip = label + '\n' + NAMES[b.k] + ' : ' + (+b.r.s === +b.r.e ? 'le ' + fmt(b.r.s) : fmt(b.r.s) + ' → ' + fmt(b.r.e) + ' (' + dur + ' j ouvré' + (dur > 1 ? 's' : '') + ')');
    if (b.milestone)
      return '<div class="milestone" style="left:' + (x(b.r.s) + px / 2 - 8) + 'px;background:' + COLORS[b.k] + '" title="' + esc(tip) + '"></div>';
    var w = Math.max(wOf(b.r.s, b.r.e), 6);
    var cls = 'bar' + (overlap ? (i === 0 ? ' upper' : ' lower') : '');
    var txt = !overlap && w > 50 ? NAMES[b.k] : '';
    if (b.k !== 'trello') { cls += ' edit'; tip += '\nGlisser pour déplacer · bords pour étirer · double-clic pour supprimer'; }
    return '<div class="' + cls + '" data-k="' + b.k + '" data-part="' + (partId || '') + '" style="left:' + x(b.r.s) + 'px;width:' + w + 'px;background:' + COLORS[b.k] + '" title="' + esc(tip) + '">' + txt + '</div>';
  }).join('');
}

function render() {
  var chart = document.getElementById('chart');
  var px = ZOOMS[state.zoom];
  var rows = state.cards.filter(function (r) {
    return !(state.hideDone && r.done) && state.hiddenLists.indexOf(r.idList) < 0 && matches(r) && (state.showUndated || allBars(r, state.showParts).length);
  });
  var undated = state.cards.filter(function (r) { return !allBars(r, true).length; }).length;
  var planned = state.cards.length - undated;

  document.querySelectorAll('[data-zoom]').forEach(function (b) {
    b.classList.toggle('active', b.dataset.zoom === state.zoom);
  });
  document.getElementById('info').textContent =
    planned + ' carte(s) planifiée(s) · ' + undated + ' sans date' + (state.showUndated ? '' : ' (masquées)');
  renderListMenu();

  var emptyMsg = '';
  if (!rows.length) emptyMsg = state.search
    ? 'Aucun dossier ne correspond à « ' + esc(state.search) + ' ».'
    : 'Aucune carte à afficher. Vérifiez les listes affichées (bouton « Listes ») ou cochez « Afficher les cartes sans date ».';

  // Bornes de la frise
  var today = day0(new Date()), min = today, max = today;
  rows.forEach(function (r) {
    allBars(r, state.showParts).forEach(function (b) { if (b.r.s < min) min = b.r.s; if (b.r.e > max) max = b.r.e; });
  });
  // Frise en jours ouvrés uniquement (lundi → vendredi), qui commence un lundi
  min = monday(addDays(min, -3));
  max = addDays(max, state.zoom === 'mois' ? 35 : 14);
  var room = addDays(today, state.zoom === 'mois' ? 270 : state.zoom === 'semaine' ? 100 : 45); // place pour dessiner
  if (max < room) max = room;
  var work = [], pos = {}; // pos[clé jour] = nb de jours ouvrés avant ce jour
  for (var c = new Date(min), n = 0; c <= addDays(max, 1); c = addDays(c, 1)) {
    pos[key(c)] = n;
    if (c.getDay() !== 0 && c.getDay() !== 6) { if (c <= max) work.push(new Date(c)); n++; }
  }
  var W = work.length * px;
  var x = function (d) { var v = pos[key(d)]; return (v == null ? (d < min ? 0 : work.length) : v) * px; };
  var wOf = function (s, e) { return x(addDays(e, 1)) - x(s); };
  state.geo = { work: work, px: px, x: x };

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
      if (!b.length && allBars(r, true).length) {
        var pb = allBars(r, true);
        var s = pb.reduce(function (m, z) { return z.r.s < m ? z.r.s : m; }, pb[0].r.s);
        var e = pb.reduce(function (m, z) { return z.r.e > m ? z.r.e : m; }, pb[0].r.e);
        extra = '<div class="summary" style="left:' + x(s) + 'px;width:' + Math.max(wOf(s, e), 6) + 'px" title="Ensemble des parties"></div>';
      }
      html += '<div class="row cardrow' + (r.done ? ' done' : '') + '"><div class="left" data-card="' + r.id + '" title="' + esc(r.name) + '"><span>' + esc(r.name) + '</span>' + hint(r) + '</div>' +
        '<div class="track draw" data-row="' + r.id + '" data-part="" style="width:' + W + 'px">' + extra + barsHtml(b, x, px, r.name, r.id, wOf, '') + '</div></div>';

      if (state.showParts) r.parts.slice().sort(function (a, b) { var d = partKey(a) - partKey(b); return isNaN(d) ? 0 : d; }).forEach(function (p) {
        html += '<div class="row partrow' + (r.done ? ' done' : '') + '"><div class="left" data-card="' + r.id + '" title="' + esc(p.name) + '"><span>↳ ' + esc(p.name) + '</span></div>' +
          '<div class="track draw" data-row="' + r.id + '" data-part="' + esc(p.pid) + '" style="width:' + W + 'px">' + barsHtml(p.bars, x, px, r.name + ' — ' + p.name, r.id, wOf, p.pid) + '</div></div>';
      });
    });
  });

  var scroll = chart.scrollLeft, scrollTop = chart.scrollTop, keep = chart.querySelector('.grid');
  chart.innerHTML =
    '<div class="grid" style="width:' + (LEFT_W + W) + 'px">' +
      '<div class="overlay" style="left:' + LEFT_W + 'px;width:' + W + 'px">' + bg + '</div>' +
      '<div class="row head"><div class="left"><div class="search"><input id="search" type="text" list="cardnames" autocomplete="off" placeholder="Rechercher un dossier…" value="' + esc(state.search) + '">' +
        (state.search ? '<button id="clearSearch" title="Effacer la recherche">✕</button>' : '') + '</div></div><div class="track" style="width:' + W + 'px">' + top + mid + bottom + '</div></div>' +
      html + (emptyMsg ? '<p class="msg">' + emptyMsg + '</p>' : '') +
    '</div>';

  chart.dataset.todayX = LEFT_W + x(today);
  if (keep && !state.rezoomed) { chart.scrollLeft = scroll; chart.scrollTop = scrollTop; } else scrollToToday();
  state.rezoomed = false;
}

function scrollToToday() {
  var chart = document.getElementById('chart');
  chart.scrollLeft = Math.max(0, Number(chart.dataset.todayX || 0) - LEFT_W - 120);
}

document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-card]');
  if (el) t.showCard(el.dataset.card);
  var tb = e.target.closest('button[data-tool]');
  if (tb) { setTool(tb.dataset.tool); savePrefs(); }
  var z = e.target.closest('[data-zoom]');
  if (z) { state.zoom = z.dataset.zoom; state.rezoomed = true; savePrefs(); render(); }
});
document.getElementById('today').addEventListener('click', scrollToToday);
document.getElementById('hideDone').addEventListener('change', function (e) { state.hideDone = e.target.checked; savePrefs(); render(); });
document.getElementById('showParts').addEventListener('change', function (e) { state.showParts = e.target.checked; savePrefs(); render(); });
document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; savePrefs(); render(); });
document.getElementById('group').addEventListener('change', function (e) { state.group = e.target.checked; savePrefs(); render(); });
document.getElementById('showUndated').addEventListener('change', function (e) { state.showUndated = e.target.checked; savePrefs(); render(); });

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
  document.getElementById('showUndated').checked = state.showUndated;
  setTool(state.tool);
}

/* ---------- Recherche ---------- */
document.addEventListener('input', function (e) {
  if (e.target.id !== 'search') return;
  state.search = e.target.value;
  var pos = e.target.selectionStart;
  render();
  var firstBar = document.querySelector('#chart .bar, #chart .milestone, #chart .summary');
  if (state.search && firstBar) document.getElementById('chart').scrollLeft = Math.max(0, firstBar.offsetLeft - 60);
  var si = document.getElementById('search'); // le champ est recréé : on lui rend la main
  si.focus();
  try { si.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
});
document.addEventListener('click', function (e) {
  if (e.target.id === 'clearSearch') { state.search = ''; render(); }
});

/* ---------- Clic droit : saisie manuelle des dates ---------- */
var pop = null;
document.addEventListener('contextmenu', function (e) {
  var track = e.target.closest('.track.draw');
  if (!track || !state.geo) return;
  e.preventDefault();
  var bar = e.target.closest('.bar.edit');
  var o = { cardId: track.dataset.row, partId: track.dataset.part, isNew: !bar, focus: 's' };
  if (bar) {
    o.k = bar.dataset.k; o.r = getRange(o.cardId, o.partId, o.k);
    var br = bar.getBoundingClientRect();
    o.focus = e.clientX - br.left > br.width / 2 ? 'e' : 's';
  } else {
    var d = state.geo.work[idxAt(e.clientX - track.getBoundingClientRect().left)];
    o.k = state.tool === 'p' ? 'p' : 'e'; o.r = [isoOf(d), isoOf(d)];
  }
  openPop(e.clientX, e.clientY, o);
});
function openPop(cx, cy, o) {
  pop = o;
  var row = state.cards.filter(function (r) { return r.id === o.cardId; })[0] || {};
  var part = o.partId ? (row.parts || []).filter(function (p) { return p.pid === o.partId; })[0] : null;
  var el = document.getElementById('pop');
  el.innerHTML =
    '<div class="pop-title">' + esc(row.name || '') + (part ? ' <span>↳ ' + esc(part.name) + '</span>' : '') + '</div>' +
    (o.isNew
      ? '<div class="pop-type"><label><input type="radio" name="ptype" value="e"' + (o.k === 'e' ? ' checked' : '') + '> <i class="e"></i>Étude</label>' +
        '<label><input type="radio" name="ptype" value="p"' + (o.k === 'p' ? ' checked' : '') + '> <i class="p"></i>Pose</label></div>'
      : '<div class="pop-type"><i class="' + o.k + '"></i>' + NAMES[o.k] + '</div>') +
    '<label class="pop-f">Début <input type="date" id="popS" value="' + o.r[0] + '"></label>' +
    '<label class="pop-f">Fin <input type="date" id="popE" value="' + o.r[1] + '"></label>' +
    '<div class="pop-btns"><button class="primary" id="popOk">Enregistrer</button>' +
    (o.isNew ? '' : '<button class="danger" id="popDel">Supprimer</button>') +
    '<button id="popCancel">Annuler</button></div>';
  el.className = 'open';
  var w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(cx, window.innerWidth - w - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(cy, window.innerHeight - h - 8)) + 'px';
  var f = document.getElementById(o.focus === 'e' ? 'popE' : 'popS');
  f.focus();
}
function closePop() { pop = null; document.getElementById('pop').className = ''; }
function popSave() {
  var s = document.getElementById('popS').value, en = document.getElementById('popE').value;
  if (!s && !en) { closePop(); return; }
  s = s || en; en = en || s;
  if (s > en) { var tmp = s; s = en; en = tmp; }
  var k = pop.k;
  if (pop.isNew) { var c = document.querySelector('input[name=ptype]:checked'); if (c) k = c.value; }
  var o = pop; closePop();
  savePeriod(o.cardId, o.partId, k, [s, en]);
}
document.getElementById('pop').addEventListener('click', function (e) {
  e.stopPropagation();
  if (e.target.id === 'popOk') popSave();
  else if (e.target.id === 'popCancel') closePop();
  else if (e.target.id === 'popDel') { var o = pop; closePop(); savePeriod(o.cardId, o.partId, o.k, null); }
});
document.getElementById('pop').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); popSave(); }
  if (e.key === 'Escape') { e.preventDefault(); closePop(); }
});
document.addEventListener('pointerdown', function (e) { if (pop && !e.target.closest('#pop')) closePop(); }, true);

/* ---------- Choix des listes affichées ---------- */
function renderListMenu() {
  var shown = state.lists.filter(function (l) { return state.hiddenLists.indexOf(l.id) < 0; }).length;
  document.getElementById('listsBtn').textContent = 'Listes (' + shown + '/' + state.lists.length + ') ▾';
  var counts = {};
  state.cards.forEach(function (r) { counts[r.idList] = (counts[r.idList] || 0) + 1; });
  document.getElementById('listsMenu').innerHTML =
    '<div class="lm-actions"><button data-lists="all">Tout afficher</button><button data-lists="none">Tout masquer</button></div>' +
    state.lists.map(function (l) {
      return '<label><input type="checkbox" data-list="' + l.id + '"' + (state.hiddenLists.indexOf(l.id) < 0 ? ' checked' : '') + '> ' +
        esc(l.name) + ' <em>' + (counts[l.id] || 0) + '</em></label>';
    }).join('');
}
document.getElementById('listsBtn').addEventListener('click', function (e) {
  e.stopPropagation();
  document.getElementById('listsMenu').classList.toggle('open');
});
document.getElementById('listsMenu').addEventListener('click', function (e) {
  e.stopPropagation();
  var a = e.target.closest('[data-lists]');
  if (a) {
    state.hiddenLists = a.dataset.lists === 'all' ? [] : state.lists.map(function (l) { return l.id; });
    savePrefs(); render();
  }
});
document.getElementById('listsMenu').addEventListener('change', function (e) {
  var id = e.target.dataset.list;
  if (!id) return;
  state.hiddenLists = state.hiddenLists.filter(function (x) { return x !== id; });
  if (!e.target.checked) state.hiddenLists.push(id);
  savePrefs(); render();
});
document.addEventListener('click', function () { document.getElementById('listsMenu').classList.remove('open'); });

/* ---------- Dessin direct sur le planning ---------- */
function setTool(k) {
  state.tool = k;
  document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.toggle('active', b.dataset.tool === k); });
  document.body.classList.toggle('erase', k === 'x');
}
function isoOf(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function idxAt(px) { var g = state.geo; return Math.max(0, Math.min(g.work.length - 1, Math.floor(px / g.px))); }
function idxOf(d) { var g = state.geo; return Math.max(0, Math.min(g.work.length - 1, Math.round(g.x(d) / g.px))); }

var toastTimer;
function toast(msg, undo) {
  var el = document.getElementById('toast');
  el.innerHTML = esc(msg) + (undo ? ' <button id="undo">Annuler</button>' : '');
  el.className = 'show';
  if (undo) document.getElementById('undo').onclick = function () { el.className = ''; undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = ''; }, undo ? 7000 : 4000);
}

/* Enregistre une période (range = [début, fin] ISO, ou null pour supprimer) sur la carte ou une de ses parties */
function savePeriod(cardId, partId, k, range) {
  var before = state.plans[cardId] || {};
  var plan = JSON.parse(JSON.stringify(before));
  var target = plan;
  if (partId) { plan.items = plan.items || {}; target = plan.items[partId] = plan.items[partId] || { n: 'Partie' }; }
  if (range) target[k] = range; else delete target[k];
  if (!plan.items || !Object.keys(plan.items).length) delete plan.items;
  if (JSON.stringify(plan).length > MAX - 50) { toast('Trop de données pour cette carte (limite Trello).'); return Promise.resolve(false); }
  return writePlan(cardId, plan).then(function (ok) {
    if (ok && !range) toast(NAMES_DEL[k], function () { writePlan(cardId, before); });
    return ok;
  });
}
function writePlan(cardId, plan) {
  var prev = state.plans[cardId];
  applyPlan(cardId, plan);
  var empty = !plan.e && !plan.p && !(plan.items && Object.keys(plan.items).length);
  return (empty ? t.remove(cardId, 'shared', KEY) : t.set(cardId, 'shared', KEY, plan))
    .then(function () { return true; })
    .catch(function (err) {
      applyPlan(cardId, prev);
      toast('Enregistrement impossible : ' + (err && err.message || err));
      return false;
    });
}
function applyPlan(cardId, plan) {
  state.plans[cardId] = plan || {};
  state.cards = state.cards.map(function (r) {
    if (r.id !== cardId) return r;
    var n = toRow(r.card, plan); n.order = r.order; return n;
  });
  render();
}

/* Glisser : dessiner une nouvelle période, déplacer une barre, ou étirer un de ses bords */
var drag = null;
document.addEventListener('pointerdown', function (e) {
  if (e.button !== 0 || !state.geo) return;
  var track = e.target.closest('.track.draw');
  if (!track) return;
  var rect = track.getBoundingClientRect(), px = e.clientX - rect.left;
  var bar = e.target.closest('.bar.edit');
  if (state.tool === 'x') { // gomme : un clic sur une barre la supprime
    if (bar) savePeriod(track.dataset.row, track.dataset.part, bar.dataset.k, null);
    e.preventDefault();
    return;
  }
  var d = { track: track, cardId: track.dataset.row, partId: track.dataset.part, x0: e.clientX, moved: false };
  if (bar) {
    var r = getRange(d.cardId, d.partId, bar.dataset.k);
    if (!r) return;
    d.k = bar.dataset.k; d.s = idxOf(iso(r[0])); d.e = idxOf(iso(r[1]));
    var br = bar.getBoundingClientRect();
    d.mode = e.clientX - br.left < 7 ? 'left' : br.right - e.clientX < 7 ? 'right' : 'move';
    d.ghostFrom = bar;
  } else {
    d.k = state.tool; d.mode = 'draw'; d.s = d.e = d.a = idxAt(px);
  }
  drag = d;
  e.preventDefault();
});
document.addEventListener('pointermove', function (e) {
  if (!drag) return;
  var dx = e.clientX - drag.x0;
  if (!drag.moved && Math.abs(dx) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'bar ghost';
    drag.ghost.style.background = COLORS[drag.k];
    drag.track.appendChild(drag.ghost);
    if (drag.ghostFrom) drag.ghostFrom.style.opacity = '.25';
  }
  var g = state.geo, step = Math.round(dx / g.px), s = drag.s, en = drag.e;
  if (drag.mode === 'draw') {
    var cur = idxAt(e.clientX - drag.track.getBoundingClientRect().left);
    s = Math.min(drag.a, cur); en = Math.max(drag.a, cur);
  } else if (drag.mode === 'move') {
    step = Math.max(-s, Math.min(g.work.length - 1 - en, step)); s += step; en += step;
  } else if (drag.mode === 'left') { s = Math.min(en, Math.max(0, s + step)); }
  else { en = Math.max(s, Math.min(g.work.length - 1, en + step)); }
  drag.ns = s; drag.ne = en;
  drag.ghost.style.left = (s * g.px) + 'px';
  drag.ghost.style.width = ((en - s + 1) * g.px) + 'px';
  drag.ghost.textContent = NAMES[drag.k] + ' · ' + short(g.work[s]) + (en > s ? ' → ' + short(g.work[en]) : '') + ' (' + (en - s + 1) + ' j)';
});
document.addEventListener('pointerup', function () {
  var d = drag; drag = null;
  if (!d || !d.moved) return;
  var g = state.geo;
  savePeriod(d.cardId, d.partId, d.k, [isoOf(g.work[d.ns]), isoOf(g.work[d.ne])]);
});
document.addEventListener('dblclick', function (e) {
  var bar = e.target.closest('.bar.edit');
  if (!bar) return;
  var track = bar.closest('.track.draw');
  savePeriod(track.dataset.row, track.dataset.part, bar.dataset.k, null);
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && drag) { if (drag.ghost) drag.ghost.remove(); if (drag.ghostFrom) drag.ghostFrom.style.opacity = ''; drag = null; }
});
function getRange(cardId, partId, k) {
  var p = state.plans[cardId] || {};
  if (partId) p = (p.items || {})[partId] || {};
  return p[k];
}

// Se redessine automatiquement quand le tableau change
t.get('member', 'private', 'ganttPrefs').catch(function () { return null; }).then(function (p) {
  applyPrefs(p);
  t.render(load);
});
