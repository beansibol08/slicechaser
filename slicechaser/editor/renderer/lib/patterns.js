// Sequence generators ("factory"). Each takes slices with .key and .center ([x,y], 0..1, y down)
// and returns steps as arrays of slice keys.
(function (root) {
  'use strict';

  // Group values that sit within `tol` of each other, in ascending order.
  function bucket(items, valueOf, tol, merge) {
    var sorted = items.slice().sort(function (a, b) { return valueOf(a) - valueOf(b); });
    var steps = [];
    var lastV = null;
    sorted.forEach(function (it) {
      var v = valueOf(it);
      if (merge && lastV !== null && Math.abs(v - lastV) <= tol) steps[steps.length - 1].push(it.key);
      else { steps.push([it.key]); lastV = v; }
    });
    return steps;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var TOL = 0.015;
  var PATTERNS = [
    { id: 'ltr', name: 'Left to right', make: function (s, o) { return bucket(s, function (x) { return x.center[0]; }, TOL, o.merge); } },
    { id: 'rtl', name: 'Right to left', make: function (s, o) { return bucket(s, function (x) { return -x.center[0]; }, TOL, o.merge); } },
    { id: 'ttb', name: 'Top to bottom', make: function (s, o) { return bucket(s, function (x) { return x.center[1]; }, TOL, o.merge); } },
    { id: 'btt', name: 'Bottom to top', make: function (s, o) { return bucket(s, function (x) { return -x.center[1]; }, TOL, o.merge); } },
    { id: 'cout', name: 'Center out', make: function (s, o) { return bucket(s, function (x) { return Math.abs(x.center[0] - 0.5); }, TOL, o.merge); } },
    { id: 'oin', name: 'Outside in', make: function (s, o) { return bucket(s, function (x) { return -Math.abs(x.center[0] - 0.5); }, TOL, o.merge); } },
    {
      id: 'cw', name: 'Clockwise sweep',
      make: function (s) {
        return bucket(s, function (x) {
          var a = Math.atan2(x.center[1] - 0.5, x.center[0] - 0.5) + Math.PI / 2; // start at 12 o'clock
          return a < 0 ? a + Math.PI * 2 : a;
        }, 0, false);
      }
    },
    {
      id: 'random', name: 'Random', make: function (s, o) {
        var rnd = mulberry32(o.seed || 1);
        var keys = s.map(function (x) { return x.key; });
        for (var i = keys.length - 1; i > 0; i--) {
          var j = Math.floor(rnd() * (i + 1));
          var t = keys[i]; keys[i] = keys[j]; keys[j] = t;
        }
        return keys.map(function (k) { return [k]; });
      }
    },
    { id: 'list', name: 'List order', make: function (s) { return s.map(function (x) { return [x.key]; }); } },
    {
      id: 'oddeven', name: 'Odd / even', make: function (s) {
        var order = s.slice().sort(function (a, b) { return a.center[0] - b.center[0] || a.center[1] - b.center[1]; });
        var odd = [], even = [];
        order.forEach(function (x, i) { (i % 2 ? odd : even).push(x.key); });
        return [even, odd].filter(function (st) { return st.length; });
      }
    },
    { id: 'all', name: 'All at once', make: function (s) { return s.length ? [s.map(function (x) { return x.key; })] : []; } }
  ];

  function generate(id, slices, options) {
    var p = PATTERNS.find(function (x) { return x.id === id; });
    if (!p || !slices.length) return [];
    return p.make(slices, options || {});
  }

  var api = { PATTERNS: PATTERNS, generate: generate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCPatterns = api;
})(this);
