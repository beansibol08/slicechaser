// The chases.json file shared with the Resolume plugins.
// Top-level slices/sequences are what the plugins read (sequence steps hold slice indices).
// The "editor" block keeps the editor's own state, with steps stored as stable slice keys
// so sequences survive slices being added, removed or reordered in Advanced Output.
(function (root) {
  'use strict';

  function r5(v) { return Math.round(v * 1e5) / 1e5; }

  // slices: [{ key, name, screen, geom: {verts, outline, aspect, center} }]
  // sequences: [{ id, name, steps: [[key]] }]
  function buildFile(comp, slices, sequences, editorExtras) {
    var indexOf = {};
    slices.forEach(function (s, i) { indexOf[s.key] = i; });
    return {
      version: 1,
      generator: 'SliceChaser editor',
      composition: { width: comp.width, height: comp.height },
      slices: slices.map(function (s) {
        return {
          key: s.key,
          name: s.name,
          screen: s.screen,
          aspect: r5(s.geom.aspect),
          verts: s.geom.verts.map(r5),
          outline: s.geom.outline.map(function (p) { return [r5(p[0]), r5(p[1])]; })
        };
      }),
      sequences: sequences.map(function (q) {
        return {
          id: q.id,
          name: q.name,
          steps: q.steps.map(function (st) {
            return st.map(function (k) { return indexOf[k]; })
              .filter(function (i) { return i !== undefined; })
              .sort(function (a, b) { return a - b; });
          })
        };
      }),
      editor: Object.assign({
        sequences: sequences.map(function (q) {
          return { id: q.id, name: q.name, steps: q.steps.map(function (st) { return st.slice(); }) };
        })
      }, editorExtras || {})
    };
  }

  // Rebuilds editor state from a saved file. Slices come back from the file itself, which
  // lets the editor keep working even when the Advanced Output file has gone missing.
  function readFile(json) {
    var f = typeof json === 'string' ? JSON.parse(json) : json;
    if (!f || typeof f !== 'object') throw new Error('Not a SliceChaser file');
    var slices = (f.slices || []).map(function (s, i) {
      var outline = s.outline || [];
      var cx = 0, cy = 0, area = 0;
      outline.forEach(function (p, j) {
        var q = outline[(j + 1) % outline.length];
        cx += p[0]; cy += p[1];
        area += p[0] * q[1] - q[0] * p[1];
      });
      var n = Math.max(outline.length, 1);
      return {
        key: s.key || 'i' + i,
        name: s.name || 'Slice ' + (i + 1),
        screen: s.screen || 'Screen',
        geom: { verts: s.verts || [], outline: outline, aspect: s.aspect || 1, center: [cx / n, cy / n], area: Math.abs(area) / 2 }
      };
    });
    var sequences;
    if (f.editor && Array.isArray(f.editor.sequences)) {
      sequences = f.editor.sequences.map(function (q) {
        return { id: q.id, name: q.name, steps: (q.steps || []).map(function (st) { return st.slice(); }) };
      });
    } else {
      // written by something else: translate indices to keys
      sequences = (f.sequences || []).map(function (q) {
        return {
          id: q.id, name: q.name,
          steps: (q.steps || []).map(function (st) {
            return st.map(function (i) { return slices[i] && slices[i].key; }).filter(Boolean);
          })
        };
      });
    }
    return {
      comp: { width: (f.composition && f.composition.width) || 1920, height: (f.composition && f.composition.height) || 1080 },
      slices: slices,
      sequences: sequences,
      editor: f.editor || {}
    };
  }

  // Same curve as the plugin (ChaseData.cpp) so the preview matches Resolume.
  function envelope(t, sustain, release) {
    if (!(t >= 0) || t >= 1) return 0;
    if (release <= sustain) return t < sustain ? 1 : 0;
    if (t < sustain) return 1;
    if (t >= release) return 0;
    return 1 - (t - sustain) / (release - sustain);
  }

  // Returns a map key -> opacity for a Step position 0..1.
  function chaserOpacities(steps, step01, echoes, sustain, release) {
    var out = {};
    var n = steps.length;
    if (!n) return out;
    echoes = Math.max(1, Math.min(echoes, n));
    var x = Math.min(Math.max(step01, 0), 1) * n;
    if (x >= n) x = n - 1e-6;
    var step = Math.floor(x), frac = x - step;
    for (var k = 0; k < echoes; k++) {
      var idx = (((step - k) % n) + n) % n;
      var o = envelope((k + frac) / echoes, sustain, release);
      if (o <= 0) continue;
      steps[idx].forEach(function (key) { out[key] = Math.max(out[key] || 0, o); });
    }
    return out;
  }

  var api = { buildFile: buildFile, readFile: readFile, envelope: envelope, chaserOpacities: chaserOpacities };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCChase = api;
})(this);
