/* Connecteur du Power-Up : bouton Gantt sur le tableau, bouton + badges Étude / Pose sur les cartes. */
var BASE = new URL('./', window.location.href).href;
var ICON = BASE + 'icon.svg';
var KEY = 'planning';

function fmt(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
function range(r) { return r[0] === r[1] ? fmt(r[0]) : fmt(r[0]) + ' → ' + fmt(r[1]); }

function openEditor(t) {
  return t.modal({ url: './planning.html', title: 'Planning étude / pose', height: 560 });
}

function badges(t, detail) {
  return t.get('card', 'shared', KEY).then(function (p) {
    var out = [];
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
  'card-badges': function (t) { return badges(t, false); },
  'card-detail-badges': function (t) { return badges(t, true); }
});
