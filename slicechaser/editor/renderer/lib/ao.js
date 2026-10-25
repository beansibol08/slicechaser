// Reads Resolume Arena/Avenue Advanced Output files (AdvancedOutput.xml or a preset).
// Slices are <Slice> (input rectangle, 4 points clockwise from top-left, composition pixels)
// or polygon slices; for those we prefer their contour points and fall back to the input rect.
(function (root) {
  'use strict';
  var X = typeof module !== 'undefined' && module.exports ? require('./xml.js') : root.SCXml;

  var SLICE_TAGS = { Slice: 'rect', Polygon: 'polygon', PolygonSlice: 'polygon' };
  var POINT_SOURCES = ['InputContour', 'InputPolygon', 'InputShape', 'Contour', 'InputRect'];

  function paramValue(node, groupName, paramName) {
    for (var i = 0; i < node.children.length; i++) {
      var g = node.children[i];
      if (g.tag !== 'Params' || (groupName && g.attrs.name !== groupName)) continue;
      for (var j = 0; j < g.children.length; j++) {
        var p = g.children[j];
        if (p.tag === 'Param' && p.attrs.name === paramName) return p.attrs.value !== undefined ? p.attrs.value : p.attrs.default;
      }
    }
    return undefined;
  }

  function pointsOf(node) {
    var out = [];
    X.walk(node, function (n) {
      if (n.tag === 'v' && n.attrs.x !== undefined && n.attrs.y !== undefined) {
        var x = parseFloat(n.attrs.x), y = parseFloat(n.attrs.y);
        if (isFinite(x) && isFinite(y)) out.push([x, y]);
      }
    });
    return out;
  }

  function parseAdvancedOutput(text) {
    var doc = X.parseXml(text);
    var result = { compWidth: 0, compHeight: 0, slices: [], skipped: [] };

    var size = X.findFirst(doc, 'CurrentCompositionTextureSize');
    if (size) {
      result.compWidth = parseInt(size.attrs.width, 10) || 0;
      result.compHeight = parseInt(size.attrs.height, 10) || 0;
    }

    var screenIndex = -1;
    X.walk(doc, function (node, parents) {
      if (node.tag === 'Screen') { screenIndex++; return; }
      // DMX/lumiverse screens hold fixtures, not video slices
      if (/^Dmx|Lumiverse/i.test(node.tag)) return false;
      var kind = SLICE_TAGS[node.tag];
      if (!kind) return;
      if (parents.some(function (p) { return SLICE_TAGS[p.tag]; })) return false;

      var screen = parents.slice().reverse().find(function (p) { return p.tag === 'Screen'; });
      var screenName = screen ? paramValue(screen, null, 'Name') || 'Screen' : 'Screen';
      var name = paramValue(node, 'Common', 'Name') || paramValue(node, null, 'Name') || node.tag;
      var enabled = paramValue(node, 'Common', 'Enabled');

      var pts = [];
      var usedRect = false;
      for (var s = 0; s < POINT_SOURCES.length && pts.length < 3; s++) {
        var src = node.children.find(function (c) { return c.tag === POINT_SOURCES[s]; });
        if (src) { pts = pointsOf(src); usedRect = POINT_SOURCES[s] === 'InputRect'; }
      }
      var key = node.attrs.uniqueId ? 'u' + node.attrs.uniqueId : 's' + Math.max(screenIndex, 0) + ':' + result.slices.length + ':' + name;
      if (pts.length < 3) {
        result.skipped.push(name);
        return false;
      }
      result.slices.push({
        key: key,
        name: name,
        screen: screenName,
        enabled: enabled === undefined ? true : enabled !== '0',
        kind: kind === 'rect' && usedRect && pts.length === 4 ? 'rect' : 'polygon',
        points: pts
      });
      return false;
    });

    if (!result.compWidth || !result.compHeight) {
      var maxX = 0, maxY = 0;
      result.slices.forEach(function (sl) {
        sl.points.forEach(function (p) { maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
      });
      result.compWidth = Math.round(maxX) || 1920;
      result.compHeight = Math.round(maxY) || 1080;
      result.guessedSize = true;
    }

    // Duplicate uniqueIds (copy-pasted presets) would merge slices; make keys unique.
    var seen = {};
    result.slices.forEach(function (sl) {
      var k = sl.key, n = 2;
      while (seen[k]) k = sl.key + '#' + n++;
      sl.key = k;
      seen[k] = true;
    });
    return result;
  }

  var api = { parseAdvancedOutput: parseAdvancedOutput };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCAo = api;
})(this);
