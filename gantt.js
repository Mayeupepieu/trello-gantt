/* Diagramme de Gantt : périodes Étude (bleu) et Pose (orange) de chaque carte et de ses parties. */
var t = window.TrelloPowerUp.iframe();

var KEY = 'planning';
var DAY = 86400000;
var LEFT_W = 320;
var ZOOMS = { jour: 44, semaine: 22, mois: 8 }; // pixels par jour
var DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
var COLORS = { e: '#579dff', p: '#faa53d', trello: '#b3b9c4', c: '#b8acf6' };
var NAMES = { e: 'Étude', p: 'Pose', trello: 'Dates Trello', c: 'Congés' };
var NAMES_DEL = { e: 'Étude supprimée', p: 'Pose supprimée', c: 'Congé supprimé' };
var CONGES = '__conges'; // ligne spéciale des congés / fermetures

var state = { zoom: 'semaine', hideDone: false, showParts: true, showUndated: true, sort: 'pose', group: true, tool: 'e', hiddenLists: [], search: '', conges: [], lists: [], cards: [], plans: {}, geo: null };
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
/* Jours fériés en France métropolitaine (fixes + liés à Pâques) */
var feriesCache = {};
function feries(y) {
  if (feriesCache[y]) return feriesCache[y];
  var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  var paques = new Date(y, month - 1, day), out = {};
  [[1, 1, 'Jour de l\'an'], [5, 1, 'Fête du Travail'], [5, 8, 'Victoire 1945'], [7, 14, 'Fête nationale'], [8, 15, 'Assomption'],
   [11, 1, 'Toussaint'], [11, 11, 'Armistice 1918'], [12, 25, 'Noël']].forEach(function (f) { out[key(new Date(y, f[0] - 1, f[1]))] = f[2]; });
  out[key(addDays(paques, 1))] = 'Lundi de Pâques';
  out[key(addDays(paques, 39))] = 'Ascension';
  out[key(addDays(paques, 50))] = 'Lundi de Pentecôte';
  return (feriesCache[y] = out);
}
function ferieOf(d) { return feries(d.getFullYear())[key(d)] || ''; }
/* Congés / fermetures couvrant un jour : liste des libellés */
function congeOf(d) {
  var t0 = +day0(d), names = [];
  state.conges.forEach(function (c) { if (+iso(c.s) <= t0 && t0 <= +iso(c.e)) names.push(c.n || 'Congés'); });
  return names.join(', ');
}
function span(r) { return r ? { s: iso(r[0]), e: iso(r[1]) } : null; }

/* Lit les données Étude / Pose enregistrées sur une carte */
/* Promesse qui ne peut pas bloquer : au-delà de ms, on continue avec la valeur de repli */
function withTimeout(p, ms, fallback) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; resolve(fallback); } }, ms);
    Promise.resolve(p).then(function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      function () { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } });
  });
}
/* Données Étude / Pose déjà fournies avec la carte (pluginData) : undefined si Trello ne les a pas fournies */
function planningFromCard(card) {
  if (!Array.isArray(card.pluginData)) return undefined;
  var me = (t.getContext() || {}).plugin;
  for (var i = 0; i < card.pluginData.length; i++) {
    var pd = card.pluginData[i];
    if (me && pd.idPlugin && pd.idPlugin !== me) continue;
    try { var v = JSON.parse(pd.value); if (v && v[KEY]) return v[KEY]; } catch (e) { /* ignore */ }
  }
  return null;
}
/* Lit les données d'une carte via Trello (avec délai maximal) */
function planningOf(card) {
  return withTimeout(t.get(card.id, 'shared', KEY), 8000, null);
}
/* Exécute fn sur chaque élément, au plus `limit` à la fois */
function mapLimit(items, limit, fn, onProgress) {
  return new Promise(function (resolve) {
    var out = new Array(items.length), next = 0, done = 0;
    if (!items.length) return resolve(out);
    function launch() {
      if (next >= items.length) return;
      var i = next++;
      fn(items[i]).then(function (v) {
        out[i] = v; done++;
        if (onProgress) onProgress(done, items.length);
        if (done === items.length) resolve(out); else launch();
      });
    }
    for (var k = 0; k < Math.min(limit, items.length); k++) launch();
  });
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

/* Chargement : un seul à la fois ; si Trello en redemande pendant qu'il tourne, on relance juste après */
var loadSeq = 0, loading = false, loadAgain = false, loaded = false, watchdog = null;
function showLoading(msg) {
  if (loaded) return; // on garde l'affichage existant pendant les rechargements
  document.getElementById('chart').innerHTML = '<p class="msg">' + msg + '</p>';
}
function load() {
  if (loading) { loadAgain = true; return; }
  loading = true; loadAgain = false;
  var seq = ++loadSeq;
  showLoading('Chargement des cartes…');
  clearTimeout(watchdog);
  watchdog = setTimeout(function () { // sécurité : si rien n'a abouti en 25 s, on relance
    if (seq !== loadSeq || !loading) return;
    loading = false;
    showLoading('Le chargement prend plus de temps que prévu… nouvelle tentative <button id="retry">Réessayer maintenant</button>');
    load();
  }, 25000);

  var getCards = withTimeout(t.cards('all'), 15000, null).then(function (c) {
    return c || withTimeout(t.cards('id', 'name', 'idList', 'start', 'due', 'dueComplete', 'labels', 'closed'), 15000, null);
  });
  var getConges = withTimeout(t.get('board', 'shared', 'conges'), 6000, null);
  return Promise.all([getCards, withTimeout(t.lists('id', 'name'), 15000, null), getConges]).then(function (res) {
    if (Array.isArray(res[2])) state.conges = res[2];
    if (seq !== loadSeq) return;
    if (!res[0] || !res[1]) throw new Error('Trello n\'a pas répondu');
    var cards = res[0].filter(function (c) { return !c.closed; });
    state.lists = res[1];
    // 1) données fournies directement avec les cartes ; 2) sinon, lecture par paquets de 15
    var known = cards.map(planningFromCard);
    var missing = cards.filter(function (c, i) { return known[i] === undefined; });
    return mapLimit(missing, 15, planningOf, function (n, total) {
      if (seq === loadSeq) showLoading('Chargement des dates… ' + n + ' / ' + total);
    }).then(function (fetched) {
      if (seq !== loadSeq) return;
      var byId = {};
      missing.forEach(function (c, i) { byId[c.id] = fetched[i]; });
      state.plans = {};
      state.cards = cards.map(function (c, i) {
        var p = known[i] !== undefined ? known[i] : byId[c.id];
        state.plans[c.id] = p || {};
        var r = toRow(c, p); r.order = i; return r;
      });
      document.getElementById('cardnames').innerHTML = state.cards.map(function (r) { return '<option value="' + esc(r.name) + '">'; }).join('');
      loaded = true;
      render();
    });
  }).catch(function (err) {
    if (seq !== loadSeq) return;
    showLoading('Impossible de lire le tableau : ' + esc(err && err.message || err) + ' <button id="retry">Réessayer</button>');
  }).then(function () {
    if (seq !== loadSeq) return;
    clearTimeout(watchdog);
    loading = false;
    if (loadAgain) load();
  });
}
document.addEventListener('click', function (e) { if (e.target.id === 'retry') { loading = false; load(); } });

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
  state.conges.forEach(function (c) { var cs = iso(c.s), ce = iso(c.e); if (ce >= addDays(today, -60)) { if (cs < min) min = cs; if (ce > max) max = ce; } });
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
    var fe = ferieOf(d), co = congeOf(d);
    if (fe) bg += '<div class="ferie" style="left:' + (i * px) + 'px;width:' + px + 'px" title="' + esc(fe) + '"></div>';
    else if (co) bg += '<div class="conge" style="left:' + (i * px) + 'px;width:' + px + 'px"></div>';
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
      var fe = ferieOf(d), co = congeOf(d);
      bottom += '<div class="hcell bottom' + (isToday ? ' today' : '') + (d.getDay() === 1 ? ' mon' : '') + (fe ? ' ferie' : co ? ' conge' : '') +
        '" style="left:' + (i * px) + 'px;width:' + px + 'px"' + (fe || co ? ' title="' + esc(fe ? 'Férié : ' + fe : 'Congés : ' + co) + '"' : '') + '>' + txt + '</div>';
    }
  });

  // Ligne des congés / fermetures (commune à tout le tableau)
  var cbars = state.conges.map(function (c, i) {
    var r = { s: iso(c.s), e: iso(c.e) }, w = Math.max(wOf(r.s, r.e), 6), dur = Math.round(wOf(r.s, r.e) / px);
    var tip = (c.n || 'Congés') + '\n' + (c.s === c.e ? 'le ' + fmt(r.s) : fmt(r.s) + ' → ' + fmt(r.e) + ' (' + dur + ' j ouvré' + (dur > 1 ? 's' : '') + ')') +
      '\nGlisser pour déplacer · bords pour étirer · clic droit pour modifier · double-clic pour supprimer';
    return '<div class="bar edit cbar" data-k="c" data-part="' + i + '" style="left:' + x(r.s) + 'px;width:' + w + 'px;background:' + COLORS.c + '" title="' + esc(tip) + '">' + (w > 50 ? esc(c.n || 'Congés') : '') + '</div>';
  }).join('');
  var html = '<div class="row congerow"><div class="left" title="Congés et fermetures : glissez sur la ligne pour en ajouter"><span>🏖 Congés / fermetures</span>' +
    '<button class="rowbtn show" data-addconge="1" title="Ajouter une période de congés">＋</button></div>' +
    '<div class="track draw" data-row="' + CONGES + '" data-part="" style="width:' + W + 'px">' + cbars + '</div></div>';
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
      html += '<div class="row cardrow' + (r.done ? ' done' : '') + '"><div class="left" data-card="' + r.id + '" title="' + esc(r.name) + '"><span>' + esc(r.name) + '</span>' + hint(r) +
        '<button class="rowbtn" data-addpart="' + r.id + '" title="Ajouter une partie à ce dossier">＋</button></div>' +
        '<div class="track draw" data-row="' + r.id + '" data-part="" style="width:' + W + 'px">' + extra + barsHtml(b, x, px, r.name, r.id, wOf, '') + '</div></div>';

      if (state.showParts) r.parts.slice().sort(function (a, b) { var d = partKey(a) - partKey(b); return isNaN(d) ? 0 : d; }).forEach(function (p) {
        html += '<div class="row partrow' + (r.done ? ' done' : '') + '"><div class="left" data-card="' + r.id + '" title="' + esc(p.name) + '"><span>↳ ' + esc(p.name) + '</span>' +
          '<button class="rowbtn" data-editpart="' + esc(p.pid) + '" data-row="' + r.id + '" title="Renommer / modifier les dates">✎</button>' +
          '<button class="rowbtn del" data-delpart="' + esc(p.pid) + '" data-row="' + r.id + '" title="Supprimer cette partie">✕</button></div>' +
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
  var rb = e.target.closest('.rowbtn');
  if (rb) {
    e.stopPropagation();
    if (rb.dataset.addconge) openCongePop(e.clientX, e.clientY, -1, isoOf(day0(new Date())));
    else if (rb.dataset.addpart) openPartPop(e.clientX, e.clientY, rb.dataset.addpart, null);
    else if (rb.dataset.editpart) openPartPop(e.clientX, e.clientY, rb.dataset.row, rb.dataset.editpart);
    else if (rb.dataset.delpart) deletePart(rb.dataset.row, rb.dataset.delpart);
    return;
  }
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
  if (track.dataset.row === CONGES) {
    var dd = state.geo.work[idxAt(e.clientX - track.getBoundingClientRect().left)];
    openCongePop(e.clientX, e.clientY, bar ? +bar.dataset.part : -1, isoOf(dd));
    return;
  }
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
/* ---------- Congés / fermetures (données du tableau, communes à tous) ---------- */
function saveConge(idx, range, name) {
  var before = state.conges.slice(), list = JSON.parse(JSON.stringify(before));
  if (!range) { if (idx >= 0) list.splice(idx, 1); }
  else if (idx >= 0) { list[idx].s = range[0]; list[idx].e = range[1]; if (name !== null) list[idx].n = name; }
  else list.push({ s: range[0], e: range[1], n: name || '' });
  list.sort(function (a, b) { return a.s < b.s ? -1 : a.s > b.s ? 1 : 0; });
  if (JSON.stringify(list).length > 8000) { toast('Trop de périodes de congés enregistrées (limite Trello).'); return Promise.resolve(false); }
  return writeConges(list).then(function (ok) {
    if (ok && !range) toast(NAMES_DEL.c, function () { writeConges(before); });
    return ok;
  });
}
function writeConges(list) {
  var prev = state.conges;
  state.conges = list; render();
  return (list.length ? t.set('board', 'shared', 'conges', list) : t.remove('board', 'shared', 'conges'))
    .then(function () { return true; })
    .catch(function (err) { state.conges = prev; render(); toast('Enregistrement impossible : ' + (err && err.message || err)); return false; });
}
function openCongePop(cx, cy, idx, dateIso) {
  var c = idx >= 0 ? state.conges[idx] : { s: dateIso, e: dateIso, n: '' };
  pop = { conge: true, idx: idx };
  var el = document.getElementById('pop');
  el.innerHTML =
    '<div class="pop-title">🏖 ' + (idx >= 0 ? 'Modifier la période' : 'Nouvelle période de congés') + '</div>' +
    '<label class="pop-f">Libellé <input type="text" id="popName" value="' + esc(c.n || '') + '" placeholder="ex. Fermeture été (facultatif)"></label>' +
    '<label class="pop-f">Début <input type="date" id="popS" value="' + (c.s || '') + '"></label>' +
    '<label class="pop-f">Fin <input type="date" id="popE" value="' + (c.e || '') + '"></label>' +
    '<div class="pop-btns"><button class="primary" id="popOk">' + (idx >= 0 ? 'Enregistrer' : 'Ajouter') + '</button>' +
    (idx >= 0 ? '<button class="danger" id="popDel">Supprimer</button>' : '') +
    '<button id="popCancel">Annuler</button></div>';
  el.className = 'open wide';
  var w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(cx, window.innerWidth - w - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(cy, window.innerHeight - h - 8)) + 'px';
  document.getElementById(idx >= 0 ? 'popS' : 'popName').focus();
}
function congeSave() {
  var r = rangeOf(document.getElementById('popS').value, document.getElementById('popE').value);
  if (!r) { document.getElementById('popS').classList.add('err'); return; }
  var o = pop, name = document.getElementById('popName').value.trim();
  closePop();
  saveConge(o.idx, r, name);
}

/* Ajouter / modifier une partie (nom + dates facultatives) */
function openPartPop(cx, cy, cardId, pid) {
  var row = state.cards.filter(function (r) { return r.id === cardId; })[0] || {};
  var it = pid ? (((state.plans[cardId] || {}).items || {})[pid] || {}) : {};
  var e = it.e || ['', ''], p = it.p || ['', ''];
  pop = { part: true, cardId: cardId, pid: pid };
  var el = document.getElementById('pop');
  el.innerHTML =
    '<div class="pop-title">' + esc(row.name || '') + '</div>' +
    '<div class="pop-type">' + (pid ? 'Modifier la partie' : 'Nouvelle partie') + '</div>' +
    '<label class="pop-f">Nom <input type="text" id="popName" value="' + esc(it.n || '') + '" placeholder="ex. Façade, Totem…"></label>' +
    '<div class="pop-sub"><i class="e"></i>Étude <span>(facultatif)</span></div>' +
    '<div class="pop-range"><input type="date" id="popES" value="' + e[0] + '"><span>→</span><input type="date" id="popEE" value="' + e[1] + '"></div>' +
    '<div class="pop-sub"><i class="p"></i>Pose <span>(facultatif)</span></div>' +
    '<div class="pop-range"><input type="date" id="popPS" value="' + p[0] + '"><span>→</span><input type="date" id="popPE" value="' + p[1] + '"></div>' +
    '<div class="pop-btns"><button class="primary" id="popOk">' + (pid ? 'Enregistrer' : 'Ajouter') + '</button>' +
    '<button id="popCancel">Annuler</button></div>';
  el.className = 'open wide';
  var w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(cx, window.innerWidth - w - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(cy, window.innerHeight - h - 8)) + 'px';
  document.getElementById('popName').focus();
}
function rangeOf(a, b) {
  if (!a && !b) return null;
  a = a || b; b = b || a;
  return a <= b ? [a, b] : [b, a];
}
function partSave() {
  var name = document.getElementById('popName').value.trim();
  if (!name) { document.getElementById('popName').focus(); document.getElementById('popName').classList.add('err'); return; }
  var o = pop, before = state.plans[o.cardId] || {};
  var plan = JSON.parse(JSON.stringify(before));
  plan.items = plan.items || {};
  var id = o.pid || 'm' + Date.now().toString(36);
  var item = { n: name };
  var e = rangeOf(document.getElementById('popES').value, document.getElementById('popEE').value);
  var p = rangeOf(document.getElementById('popPS').value, document.getElementById('popPE').value);
  if (e) item.e = e;
  if (p) item.p = p;
  plan.items[id] = item;
  if (JSON.stringify(plan).length > MAX - 50) { toast('Trop de données pour cette carte (limite Trello).'); return; }
  closePop();
  state.showParts = true; document.getElementById('showParts').checked = true;
  writePlan(o.cardId, plan).then(function (ok) { if (ok) toast(o.pid ? 'Partie modifiée' : 'Partie « ' + name + ' » ajoutée'); });
}
function deletePart(cardId, pid) {
  var before = state.plans[cardId] || {};
  var plan = JSON.parse(JSON.stringify(before));
  var name = ((plan.items || {})[pid] || {}).n || 'Partie';
  if (plan.items) delete plan.items[pid];
  if (plan.items && !Object.keys(plan.items).length) delete plan.items;
  writePlan(cardId, plan).then(function (ok) {
    if (ok) toast('Partie « ' + name + ' » supprimée', function () { writePlan(cardId, before); });
  });
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
  if (e.target.id === 'popOk') { if (pop && pop.conge) congeSave(); else if (pop && pop.part) partSave(); else popSave(); }
  else if (e.target.id === 'popCancel') closePop();
  else if (e.target.id === 'popDel') { var o = pop; closePop(); if (o.conge) saveConge(o.idx, null, null); else savePeriod(o.cardId, o.partId, o.k, null); }
});
document.getElementById('pop').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); if (pop && pop.conge) congeSave(); else if (pop && pop.part) partSave(); else popSave(); }
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
  if (cardId === CONGES) return saveConge(partId === '' ? -1 : +partId, range, null);
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
    d.k = d.cardId === CONGES ? 'c' : state.tool; d.mode = 'draw'; d.s = d.e = d.a = idxAt(px);
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
  if (cardId === CONGES) { var c = state.conges[+partId]; return c ? [c.s, c.e] : null; }
  var p = state.plans[cardId] || {};
  if (partId) p = (p.items || {})[partId] || {};
  return p[k];
}

// Se redessine automatiquement quand le tableau change
// (les préférences ne doivent jamais bloquer l'ouverture : 3 s maximum)
withTimeout(t.get('member', 'private', 'ganttPrefs'), 3000, null).then(function (p) {
  applyPrefs(p);
  t.render(function () { load(); });
});
