// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseXml, findAll } = require('../renderer/lib/xml.js');
const { parseAdvancedOutput } = require('../renderer/lib/ao.js');
const geom = require('../renderer/lib/geom.js');
const patterns = require('../renderer/lib/patterns.js');
const chase = require('../renderer/lib/chasefile.js');

const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_ao.xml'), 'utf8');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('xml: attributes, entities, comments, self-closing tags', () => {
  const doc = parseXml('<?xml version="1.0"?><!-- hi --><a x="1 &amp; 2" y=\'&lt;3\'><b/><b k="v>w"></b></a>');
  const a = doc.children[0];
  assert.equal(a.tag, 'a');
  assert.equal(a.attrs.x, '1 & 2');
  assert.equal(a.attrs.y, '<3');
  assert.equal(findAll(doc, 'b').length, 2);
  assert.equal(a.children[1].attrs.k, 'v>w');
});

test('advanced output: slices, names, screens, size', () => {
  const ao = parseAdvancedOutput(sample);
  assert.equal(ao.compWidth, 1920);
  assert.equal(ao.compHeight, 1080);
  assert.deepEqual(ao.slices.map((s) => s.name), ['Left wing', 'Center', 'Right wing (rotated)', 'Triangle']);
  assert.deepEqual(ao.skipped, ['Broken']);
  assert.equal(ao.slices[0].screen, 'LED wall');
  assert.equal(ao.slices[3].screen, 'Floor');
  assert.equal(ao.slices[1].enabled, false);
  assert.equal(ao.slices[0].kind, 'rect');
  assert.equal(ao.slices[3].kind, 'polygon');
  assert.equal(ao.slices[3].points.length, 3); // contour wins over the bounding rect
  assert.equal(ao.slices[0].key, 'u11');
});

test('advanced output: guesses size when missing and dedupes keys', () => {
  const xml = '<ScreenSetup><Screen><layers>' +
    '<Slice uniqueId="5"><InputRect><v x="0" y="0"/><v x="100" y="0"/><v x="100" y="50"/><v x="0" y="50"/></InputRect></Slice>' +
    '<Slice uniqueId="5"><InputRect><v x="100" y="0"/><v x="200" y="0"/><v x="200" y="50"/><v x="100" y="50"/></InputRect></Slice>' +
    '</layers></Screen></ScreenSetup>';
  const ao = parseAdvancedOutput(xml);
  assert.equal(ao.compWidth, 200);
  assert.equal(ao.compHeight, 50);
  assert.ok(ao.guessedSize);
  assert.notEqual(ao.slices[0].key, ao.slices[1].key);
});

test('geometry: plain rect', () => {
  const g = geom.buildSliceGeometry({ kind: 'rect', points: [[0, 0], [480, 0], [480, 1080], [0, 1080]] }, 1920, 1080);
  assert.equal(g.verts.length, 2 * 3 * 4);
  near(g.aspect, 480 / 1080);
  near(g.center[0], 0.125);
  near(g.center[1], 0.5);
  // every vertex's local coords match its position within the rect
  for (let i = 0; i < g.verts.length; i += 4) {
    near(g.verts[i + 2], g.verts[i] / 0.25);
    near(g.verts[i + 3], g.verts[i + 1]);
  }
});

test('geometry: rotated rect keeps its own frame', () => {
  const pts = [[1800, 100], [1800, 500], [1600, 500], [1600, 100]];
  const g = geom.buildSliceGeometry({ kind: 'rect', points: pts }, 1920, 1080);
  near(g.aspect, 2); // 400 along its own x axis, 200 along y
  const locals = {};
  for (let i = 0; i < g.verts.length; i += 4) locals[`${Math.round(g.verts[i] * 1920)},${Math.round(g.verts[i + 1] * 1080)}`] = [g.verts[i + 2], g.verts[i + 3]];
  assert.deepEqual(locals['1800,100'].map(Math.round), [0, 0]);
  assert.deepEqual(locals['1800,500'].map(Math.round), [1, 0]);
  assert.deepEqual(locals['1600,500'].map(Math.round), [1, 1]);
  assert.deepEqual(locals['1600,100'].map(Math.round), [0, 1]);
});

test('geometry: concave polygon triangulates to its own area', () => {
  // an L shape, both windings
  const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  for (const pts of [L, L.slice().reverse()]) {
    const tris = geom.triangulate(pts);
    assert.equal(tris.length, 4);
    const area = tris.reduce((s, t) => s + Math.abs(geom.signedArea(t.map((i) => pts[i]))), 0);
    near(area, 3);
  }
  assert.equal(geom.buildSliceGeometry({ kind: 'polygon', points: [[0, 0], [1, 1], [2, 2]] }, 10, 10), null);
});

test('geometry: hit testing', () => {
  const tri = [[0, 0], [1, 0], [0, 1]];
  assert.ok(geom.pointInPolygon([0.2, 0.2], tri));
  assert.ok(!geom.pointInPolygon([0.8, 0.8], tri));
});

test('patterns', () => {
  const s = [
    { key: 'a', center: [0.1, 0.5] },
    { key: 'b', center: [0.5, 0.2] },
    { key: 'c', center: [0.9, 0.5] },
    { key: 'd', center: [0.505, 0.8] }
  ];
  assert.deepEqual(patterns.generate('ltr', s, { merge: true }), [['a'], ['b', 'd'], ['c']]);
  assert.deepEqual(patterns.generate('ltr', s, { merge: false }), [['a'], ['b'], ['d'], ['c']]);
  assert.deepEqual(patterns.generate('cout', s, { merge: true }), [['b', 'd'], ['a', 'c']]);
  assert.deepEqual(patterns.generate('ttb', s, { merge: true }), [['b'], ['a', 'c'], ['d']]);
  assert.deepEqual(patterns.generate('all', s), [['a', 'b', 'c', 'd']]);
  assert.deepEqual(patterns.generate('cw', s).flat(), ['b', 'c', 'd', 'a']);
  const r1 = patterns.generate('random', s, { seed: 3 }).flat();
  assert.deepEqual(r1, patterns.generate('random', s, { seed: 3 }).flat());
  assert.deepEqual(r1.slice().sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(patterns.generate('oddeven', s), [['a', 'd'], ['b', 'c']]);
  assert.deepEqual(patterns.generate('ltr', [], {}), []);
  assert.equal(patterns.PATTERNS.length, 11);
});

test('chase file: round trip and index mapping', () => {
  const ao = parseAdvancedOutput(sample);
  const slices = ao.slices.map((s) => ({ ...s, geom: geom.buildSliceGeometry(s, ao.compWidth, ao.compHeight) }));
  const seqs = [{ id: 3, name: 'Sweep', steps: [['u11'], ['u13', 'u12', 'gone'], []] }];
  const file = chase.buildFile({ width: 1920, height: 1080 }, slices, seqs, { sourcePath: '/x.xml' });
  assert.deepEqual(file.sequences[0].steps, [[0], [1, 2], []]); // unknown key dropped, sorted indices
  assert.equal(file.editor.sourcePath, '/x.xml');
  assert.deepEqual(file.editor.sequences[0].steps[1], ['u13', 'u12', 'gone']); // editor keeps keys
  const back = chase.readFile(JSON.stringify(file));
  assert.equal(back.slices.length, 4);
  assert.equal(back.slices[2].name, 'Right wing (rotated)');
  assert.equal(back.sequences[0].name, 'Sweep');
  near(back.slices[0].geom.center[0], 0.125, 1e-4);

  // a file without an editor block (written by hand) maps indices back to keys
  delete file.editor;
  const plain = chase.readFile(file);
  assert.deepEqual(plain.sequences[0].steps[1], ['u12', 'u13']);
});

test('preview maths match the plugin', () => {
  near(chase.envelope(0.5, 0.2, 0.8), 0.5);
  near(chase.envelope(0.99, 1, 1), 1);
  const steps = [['a'], ['b'], ['c'], ['d']];
  assert.deepEqual(chase.chaserOpacities(steps, 0, 1, 1, 1), { a: 1 });
  const o = chase.chaserOpacities(steps, 0.25, 2, 0, 1);
  near(o.b, 1);
  near(o.a, 0.5);
  near(chase.chaserOpacities(steps, 0, 2, 0, 1).d, 0.5); // echo wraps around
});
