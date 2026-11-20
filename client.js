/* Connecteur du Power-Up : bouton Gantt sur le tableau, bouton + badges Étude / Pose sur les cartes. */
var BASE = new URL('./', window.location.href).href;
var ICON = BASE + 'icon.svg';
var KEY = 'planning';

/* Sécurité : on n'accepte que des données au format attendu (dates AAAA-MM-JJ, textes courts) */
function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function okRange(r) { return Array.isArray(r) && r.length === 2 && isIso(r[0]) && isIso(r[1]) ? [r[0], r[1]] : null; }
function cleanPlan(p) {
  if (!p || typeof p !== 'object') return null;
  var out = {}, e = okRange(p.e), q = okRange(p.p);
  if (e) out.e = e;
  if (q) out.p = q;
  if (typeof p.c === 'string' && /^(red|orange|yellow|green|blue|purple|pink|gray)$/.test(p.c)) out.c = p.c;
  if (p.items && typeof p.items === 'object') {
    Object.keys(p.items).forEach(function (k) {
      var it = p.items[k];
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(k) || !it || typeof it !== 'object') return;
      var o = { n: String(it.n == null ? '' : it.n).slice(0, 120) }, ie = okRange(it.e), ip = okRange(it.p);
      if (ie) o.e = ie;
      if (ip) o.p = ip;
      (out.items = out.items || {})[k] = o;
    });
  }
  return out;
}
function fmt(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
function range(r) { return r[0] === r[1] ? fmt(r[0]) : fmt(r[0]) + ' → ' + fmt(r[1]); }

function openEditor(t) {
  return t.modal({ url: './planning.html', title: 'Planning étude / pose', height: 560 });
}

function badges(t, detail) {
  return t.get('card', 'shared', KEY).then(function (p) {
    var out = [];
    p = cleanPlan(p);
    if (!p) return out;
    var nItems = Object.keys(p.items || {}).filter(function (k) { var i = p.items[k]; return i.e || i.p; }).length;
    if (p.e) out.push({ text: (detail ? '' : 'Étude ') + range(p.e), color: 'blue', title: 'Étude' });
    if (p.p) out.push({ text: (detail ? '' : 'Pose ') + range(p.p), color: 'orange', title: 'Pose' });
    if (nItems) out.push({ text: nItems + ' partie(s) planifiée(s)', title: 'Parties' });
    if (detail) out.forEach(function (b) { b.callback = openEditor; });
    return out;
  });
}

window.TrelloPowerUp.initialize({
  'board-buttons': function () {
    return [{
      icon: { dark: ICON, light: ICON },
      text: 'Diagramme de Gantt',
      callback: function (t) {
        return t.modal({ url: './gantt.html', title: 'Diagramme de Gantt', fullscreen: true });
      }
    }];
  },
  'card-buttons': function () {
    return [{ icon: ICON, text: 'Planning étude / pose', callback: openEditor }];
  },
  'card-back-section': function (t) {
    return {
      title: 'Planning étude / pose',
      icon: ICON,
      content: { type: 'iframe', url: t.signUrl('./section.html'), height: 52 }
    };
  },
  'card-badges': function (t) { return badges(t, false); },
  'card-detail-badges': function (t) { return badges(t, true); }
});
