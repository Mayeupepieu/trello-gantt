/* Calculs de dates partagés : jours ouvrés (hors week-ends et jours fériés français)
   et saisie à trois champs « début / fin / nombre de jours ouvrés ». */
(function () {
  function pad(n) { return ('0' + n).slice(-2); }
  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function add(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function key(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  var cache = {};
  function feries(y) {
    if (cache[y]) return cache[y];
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    var paques = new Date(y, month - 1, day), out = {};
    [[1, 1], [5, 1], [5, 8], [7, 14], [8, 15], [11, 1], [11, 11], [12, 25]].forEach(function (x) { out[key(new Date(y, x[0] - 1, x[1]))] = 1; });
    [1, 39, 50].forEach(function (n) { out[key(add(paques, n))] = 1; });
    return (cache[y] = out);
  }
  function isWork(d) { var w = d.getDay(); return w !== 0 && w !== 6 && !feries(d.getFullYear())[key(d)]; }

  /* Nombre de jours ouvrés entre deux dates (incluses) */
  function count(s, e) {
    if (!isIso(s) || !isIso(e)) return 0;
    var a = parse(s), b = parse(e), n = 0;
    if (a > b) { var t = a; a = b; b = t; }
    for (var d = a; d <= b; d = add(d, 1)) if (isWork(d)) n++;
    return n;
  }
  /* Date de fin : début + n jours ouvrés (le début compte s'il est ouvré) */
  function endFrom(s, n) {
    var d = parse(s), guard = 0;
    while (!isWork(d) && guard++ < 30) d = add(d, 1);
    for (var left = n - 1; left > 0 && guard++ < 5000;) { d = add(d, 1); if (isWork(d)) left--; }
    return isoOf(d);
  }
  /* Date de début : fin - n jours ouvrés (la fin compte si elle est ouvrée) */
  function startFrom(e, n) {
    var d = parse(e), guard = 0;
    while (!isWork(d) && guard++ < 30) d = add(d, -1);
    for (var left = n - 1; left > 0 && guard++ < 5000;) { d = add(d, -1); if (isWork(d)) left--; }
    return isoOf(d);
  }

  /* Relie trois champs : on en remplit deux, le troisième est calculé.
     - début + durée → fin ;  début + fin → durée ;  fin + durée → début.
     Si les trois sont remplis : changer le début garde la durée (la période se décale),
     changer la fin recalcule la durée, changer la durée recalcule la fin. */
  function wire(sEl, eEl, nEl) {
    function days() { var n = parseInt(nEl.value, 10); return n > 0 && n < 1000 ? n : 0; }
    function upd(src) {
      var s = sEl.value, e = eEl.value, n = days();
      if (src === 's') {
        if (s && n) eEl.value = endFrom(s, n);
        else if (s && e) nEl.value = count(s, e) || '';
      } else if (src === 'e') {
        if (s && e) nEl.value = count(s, e) || '';
        else if (e && n) sEl.value = startFrom(e, n);
      } else {
        if (!n) return;
        if (s) eEl.value = endFrom(s, n);
        else if (e) sEl.value = startFrom(e, n);
      }
    }
    sEl.addEventListener('input', function () { upd('s'); });
    eEl.addEventListener('input', function () { upd('e'); });
    nEl.addEventListener('input', function () { upd('n'); });
    if (sEl.value && eEl.value) nEl.value = count(sEl.value, eEl.value) || '';
  }

  window.GD = { isoOf: isoOf, count: count, endFrom: endFrom, startFrom: startFrom, wire: wire, isWork: isWork };
})();
