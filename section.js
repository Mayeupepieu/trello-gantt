/* Section « Planning étude / pose » au dos de chaque carte : résumé + bouton d'ouverture de la saisie. */
var t = window.TrelloPowerUp.iframe();
var KEY = 'planning';

function applyTheme() {
  var th = null;
  try { var c = t.getContext() || {}; th = c.theme || c.initialTheme; } catch (e) { /* ignore */ }
  if (!th) th = document.documentElement.getAttribute('data-color-mode');
  if (!th || th === 'auto' || th === 'system') th = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', th === 'dark');
}
/* Sécurité : on n'accepte que des données au format attendu (dates AAAA-MM-JJ, textes courts) */
function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function okRange(r) { return Array.isArray(r) && r.length === 2 && isIso(r[0]) && isIso(r[1]) ? [r[0], r[1]] : null; }
function cleanPlan(p) {
  if (!p || typeof p !== 'object') return null;
  var out = {}, e = okRange(p.e), q = okRange(p.p);
  if (e) out.e = e;
  if (q) out.p = q;
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
function fmt(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0].slice(2); }
function range(r) { return r[0] === r[1] ? fmt(r[0]) : fmt(r[0]) + ' → ' + fmt(r[1]); }

document.getElementById('open').addEventListener('click', function () {
  t.modal({ url: './planning.html', title: 'Planning étude / pose', height: 560 });
});

t.render(function () {
  applyTheme();
  return t.get('card', 'shared', KEY).then(function (p) {
    p = cleanPlan(p) || {};
    var html = '';
    if (p.e) html += '<span class="chip e">Étude ' + range(p.e) + '</span>';
    if (p.p) html += '<span class="chip p">Pose ' + range(p.p) + '</span>';
    var n = Object.keys(p.items || {}).filter(function (k) { return p.items[k].e || p.items[k].p; }).length;
    if (n) html += '<span class="chip n">+ ' + n + ' partie(s) planifiée(s)</span>';
    document.getElementById('summary').innerHTML = html || '<span class="muted">Aucune date d\'étude ni de pose pour ce dossier.</span>';
    document.getElementById('open').textContent = html ? 'Modifier les dates' : 'Saisir les dates';
    return t.sizeTo('#content');
  });
});
