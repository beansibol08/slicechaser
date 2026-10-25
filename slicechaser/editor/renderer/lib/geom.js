// Slice geometry: triangulation and the per-slice frame the plugin uses for Fill/Stretch.
(function (root) {
  'use strict';

  function signedArea(pts) {
    var a = 0;
    for (var i = 0, n = pts.length; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  function pointInTriangle(p, a, b, c) {
    var d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    var d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    var d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    var neg = d1 < 0 || d2 < 0 || d3 < 0;
    var pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  function cleanPolygon(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], prev = out[out.length - 1];
      if (prev && Math.abs(prev[0] - p[0]) < 1e-9 && Math.abs(prev[1] - p[1]) < 1e-9) continue;
      out.push(p);
    }
    if (out.length > 1) {
      var f = out[0], l = out[out.length - 1];
      if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop();
    }
    return out;
  }

  // Ear clipping. Returns triangles as index triples into pts. Works for any simple polygon.
  function triangulate(pts) {
    var n = pts.length;
    if (n < 3) return [];
    var idx = [];
    for (var i = 0; i < n; i++) idx.push(i);
    if (signedArea(pts) < 0) idx.reverse(); // make counter-clockwise (in math orientation)
    var tris = [];
    var guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      var clipped = false;
      for (var k = 0; k < idx.length; k++) {
        var i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
        var a = pts[i0], b = pts[i1], c = pts[i2];
        var cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cross <= 1e-12) continue; // reflex or degenerate corner
        var inside = false;
        for (var m = 0; m < idx.length && !inside; m++) {
          var im = idx[m];
          if (im === i0 || im === i1 || im === i2) continue;
          inside = pointInTriangle(pts[im], a, b, c);
        }
        if (inside) continue;
        tris.push([i0, i1, i2]);
        idx.splice(k, 1);
        clipped = true;
        break;
      }
      if (!clipped) break; // self-intersecting input: fall back to a fan for what's left
    }
    if (idx.length > 3) {
      for (var f = 1; f < idx.length - 1; f++) tris.push([idx[0], idx[f], idx[f + 1]]);
    } else if (idx.length === 3) {
      tris.push([idx[0], idx[1], idx[2]]);
    }
    return tris;
  }

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // slice: { points: [[x,y] in composition pixels, y down], kind: 'rect'|'polygon' }
  // Returns null for degenerate slices.
  function buildSliceGeometry(slice, compW, compH) {
    var pts = cleanPolygon(slice.points);
    if (pts.length < 3 || Math.abs(signedArea(pts)) < 0.5) return null;

    var local;
    var aspect;
    if (slice.kind === 'rect' && pts.length === 4) {
      // Resolume writes rects clockwise from top-left. Use the rect's own axes so a
      // rotated slice gets upright content in Fill/Stretch.
      var o = pts[0], ux = [pts[1][0] - o[0], pts[1][1] - o[1]], vy = [pts[3][0] - o[0], pts[3][1] - o[1]];
      var det = ux[0] * vy[1] - ux[1] * vy[0];
      if (Math.abs(det) < 1e-9) return null;
      local = pts.map(function (p) {
        var dx = p[0] - o[0], dy = p[1] - o[1];
        return [(dx * vy[1] - dy * vy[0]) / det, (ux[0] * dy - ux[1] * dx) / det];
      });
      aspect = dist(pts[0], pts[1]) / Math.max(dist(pts[0], pts[3]), 1e-9);
    } else {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      pts.forEach(function (p) {
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      });
      var w = Math.max(maxX - minX, 1e-9), h = Math.max(maxY - minY, 1e-9);
      local = pts.map(function (p) { return [(p[0] - minX) / w, (p[1] - minY) / h]; });
      aspect = w / h;
    }

    var tris = triangulate(pts);
    var verts = [];
    tris.forEach(function (t) {
      t.forEach(function (i) {
        verts.push(pts[i][0] / compW, pts[i][1] / compH, local[i][0], local[i][1]);
      });
    });
    var outline = pts.map(function (p) { return [p[0] / compW, p[1] / compH]; });
    var cx = 0, cy = 0, a2 = 0;
    // area centroid
    for (var i = 0, n = pts.length; i < n; i++) {
      var p = outline[i], q = outline[(i + 1) % n];
      var cr = p[0] * q[1] - q[0] * p[1];
      a2 += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr;
    }
    var center = Math.abs(a2) > 1e-12 ? [cx / (3 * a2), cy / (3 * a2)]
      : [outline.reduce(function (s, p) { return s + p[0]; }, 0) / n, outline.reduce(function (s, p) { return s + p[1]; }, 0) / n];
    return { verts: verts, outline: outline, aspect: aspect, center: center, area: Math.abs(a2) / 2 };
  }

  function pointInPolygon(p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  var api = {
    signedArea: signedArea,
    triangulate: triangulate,
    buildSliceGeometry: buildSliceGeometry,
    pointInPolygon: pointInPolygon,
    cleanPolygon: cleanPolygon
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCGeom = api;
})(this);
