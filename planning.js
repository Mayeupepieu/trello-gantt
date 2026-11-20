/* Fenêtre de saisie des périodes Étude / Pose d'une carte et de ses parties. */
var t = window.TrelloPowerUp.iframe();
var KEY = 'planning';
var MAX = 4096; // limite Trello de stockage par carte

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

/* Thème clair / sombre : suit celui de Trello */
function applyTheme() {
  var th = null;
  try { var c = t.getContext() || {}; th = c.theme || c.initialTheme; } catch (e) { /* ignore */ }
  if (!th) th = document.documentElement.getAttribute('data-color-mode');
  if (!th || th === 'auto' || th === 'system') th = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', th === 'dark');
}
applyTheme();
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

var state = { card: null, checklists: [], data: { e: null, p: null, items: {} } };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* Cellule de dates : début → fin, et nombre de jours ouvrés (le 3e champ est calculé à partir des 2 autres) */
function dateCell(k, r, label) {
  return '<div class="dr"><input type="date" data-f="' + k + '0" value="' + r[0] + '" title="Début"><span class="sep">→</span>' +
    '<input type="date" data-f="' + k + '1" value="' + r[1] + '" title="Fin"></div>' +
    '<div class="dd"><input type="number" data-f="' + k + 'n" min="1" max="999" placeholder="—" title="Nombre de jours ouvrés"> <span>j ouvrés</span>' +
    '<button class="clr" data-clr="' + k + '" title="Effacer les dates ' + label + '">✕ effacer</button></div>';
}
/* Une ligne : nom + Étude (début/fin/durée) + Pose (début/fin/durée) */
function rowHtml(id, name, rec, opts) {
  rec = rec || {};
  var e = rec.e || ['', ''], p = rec.p || ['', ''];
  var nameCell = opts.editableName
    ? '<input type="text" data-name="' + id + '" value="' + esc(name) + '" placeholder="Nom de la partie">'
    : esc(name);
  return '<tr class="' + (opts.main ? 'main' : '') + '" data-id="' + id + '">' +
    '<td class="name' + (opts.done ? ' done' : '') + '">' + nameCell + '</td>' +
    '<td class="etude">' + dateCell('e', e, 'd\'étude') + '</td>' +
    '<td class="pose">' + dateCell('p', p, 'de pose') + '</td>' +
    '<td>' + (opts.deletable ? '<button class="del" data-del="' + id + '" title="Supprimer">✕</button>' : '') + '</td></tr>';
}
var HEAD = '<tr><th></th><th class="etude">Étude (début → fin · durée)</th><th class="pose">Pose (début → fin · durée)</th><th></th></tr>';

function render() {
  var d = state.data, html = '';
  html += '<h3>Dossier complet</h3><table>' + HEAD + rowHtml('__card', state.card.name, d, { main: true }) + '</table>';

  // Parties issues des checklists Trello
  var known = {};
  state.checklists.forEach(function (cl) {
    if (!cl.checkItems || !cl.checkItems.length) return;
    html += '<h3>Checklist : ' + esc(cl.name) + '</h3><table>' + HEAD;
    cl.checkItems.slice().sort(function (a, b) { return a.pos - b.pos; }).forEach(function (it) {
      known[it.id] = true;
      html += rowHtml(it.id, it.name, d.items[it.id], { done: it.state === 'complete' });
    });
    html += '</table>';
  });

  // Parties ajoutées à la main (ou anciennes parties dont l'élément de checklist n'existe plus)
  var manual = Object.keys(d.items).filter(function (k) { return !known[k]; });
  html += '<h3>Autres parties</h3>';
  if (manual.length) {
    html += '<table>' + HEAD;
    manual.forEach(function (k) {
      html += rowHtml(k, d.items[k].n, d.items[k], { editableName: true, deletable: true });
    });
    html += '</table>';
  } else if (!state.checklists.length) {
    html += '<p class="muted">Ajoutez des parties ici, ou créez une checklist sur la carte : chaque élément pourra recevoir ses propres dates.</p>';
  }
  html += '<button class="link" id="add">+ Ajouter une partie</button>';

  document.getElementById('app').innerHTML = html +
    '<div id="footer"><button class="primary" id="save">Enregistrer</button><button id="cancel">Annuler</button>' +
    '<span class="hint">Remplissez 2 champs sur 3 : le 3e est calculé (jours ouvrés, hors week-ends et fériés).</span><span id="status"></span></div>';
  document.querySelectorAll('tr[data-id]').forEach(function (tr) {
    ['e', 'p'].forEach(function (k) {
      var q = function (f) { return tr.querySelector('[data-f="' + k + f + '"]'); };
      window.GD.wire(q('0'), q('1'), q('n'));
    });
  });
}

/* Relit le formulaire dans state.data */
function collect() {
  var names = {};
  state.checklists.forEach(function (cl) { (cl.checkItems || []).forEach(function (it) { names[it.id] = it.name; }); });
  document.querySelectorAll('tr[data-id]').forEach(function (tr) {
    var id = tr.dataset.id;
    var v = function (f) { return tr.querySelector('[data-f="' + f + '"]').value; };
    var e = norm(v('e0'), v('e1')), p = norm(v('p0'), v('p1'));
    if (id === '__card') { state.data.e = e; state.data.p = p; return; }
    var nameInput = tr.querySelector('[data-name]');
    var rec = { n: nameInput ? nameInput.value.trim() || 'Partie' : names[id] || (state.data.items[id] || {}).n || '' };
    if (e) rec.e = e;
    if (p) rec.p = p;
    state.data.items[id] = rec;
  });
}
/* Une seule date saisie = période d'un jour ; dates inversées = remises dans l'ordre */
function norm(a, b) {
  if (!a && !b) return null;
  a = a || b; b = b || a;
  return a <= b ? [a, b] : [b, a];
}

function save() {
  collect();
  var d = state.data, out = { items: {} };
  if (d.e) out.e = d.e;
  if (d.p) out.p = d.p;
  if (d.c) out.c = d.c; // libellé de couleur (choisi dans le Gantt) conservé
  Object.keys(d.items).forEach(function (k) {
    var it = d.items[k];
    // on garde les parties datées, et les parties manuelles même sans date
    if (it.e || it.p || k.indexOf('m') === 0) out.items[k] = it;
  });
  var size = JSON.stringify(out).length;
  var st = document.getElementById('status');
  if (size > MAX - 50) {
    st.className = 'err';
    st.textContent = 'Trop de parties pour une seule carte (limite Trello). Raccourcissez des noms ou retirez des parties.';
    return;
  }
  st.className = ''; st.textContent = 'Enregistrement…';
  var empty = !out.e && !out.p && !out.c && !Object.keys(out.items).length;
  (empty ? t.remove('card', 'shared', KEY) : t.set('card', 'shared', KEY, out))
    .then(function () { return t.closeModal(); })
    .catch(function (err) { st.className = 'err'; st.textContent = 'Erreur : ' + (err && err.message || err); });
}

document.addEventListener('click', function (ev) {
  var el = ev.target;
  if (el.dataset && el.dataset.clr) {
    var tr = el.closest('tr');
    tr.querySelector('[data-f="' + el.dataset.clr + '0"]').value = '';
    tr.querySelector('[data-f="' + el.dataset.clr + '1"]').value = '';
    tr.querySelector('[data-f="' + el.dataset.clr + 'n"]').value = '';
  }
  else if (el.id === 'save') save();
  else if (el.id === 'cancel') t.closeModal();
  else if (el.id === 'add') {
    collect();
    state.data.items['m' + Date.now().toString(36)] = { n: '' };
    render();
    var inputs = document.querySelectorAll('[data-name]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  } else if (el.dataset && el.dataset.del) {
    collect();
    delete state.data.items[el.dataset.del];
    render();
  }
});

Promise.all([
  t.card('id', 'name'),
  t.card('checklists').then(function (c) { return c.checklists || []; }).catch(function () { return []; }),
  t.get('card', 'shared', KEY)
]).then(function (res) {
  state.card = res[0];
  state.checklists = res[1];
  var saved = cleanPlan(res[2]) || {};
  state.data = { e: saved.e || null, p: saved.p || null, c: saved.c || null, items: saved.items || {} };
  render();
}).catch(function (err) {
  document.getElementById('app').innerHTML = '<p class="muted">Erreur de chargement : ' + esc(err && err.message || err) + '</p>';
});
