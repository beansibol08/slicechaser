// Minimal XML reader for Resolume's Advanced Output files.
// Produces { tag, attrs, children } nodes. Text content is ignored (Resolume stores data in attributes).
(function (root) {
  'use strict';

  function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e === 'amp') return '&';
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      if (e[1] === 'x') return String.fromCodePoint(parseInt(e.slice(2), 16));
      return String.fromCodePoint(parseInt(e.slice(1), 10));
    });
  }

  function parseXml(text) {
    var doc = { tag: '#document', attrs: {}, children: [] };
    var stack = [doc];
    var i = 0;
    var n = text.length;
    var attrRe = /([^\s=\/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

    while (i < n) {
      var lt = text.indexOf('<', i);
      if (lt < 0) break;
      if (text.startsWith('<!--', lt)) {
        var endC = text.indexOf('-->', lt + 4);
        i = endC < 0 ? n : endC + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', lt)) {
        var endD = text.indexOf(']]>', lt);
        i = endD < 0 ? n : endD + 3;
        continue;
      }
      if (text[lt + 1] === '?' || text[lt + 1] === '!') {
        var endP = text.indexOf('>', lt);
        i = endP < 0 ? n : endP + 1;
        continue;
      }
      // find the end of the tag, respecting quoted attribute values
      var j = lt + 1;
      var quote = null;
      while (j < n) {
        var c = text[j];
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      var body = text.slice(lt + 1, j);
      i = j + 1;

      if (body[0] === '/') {
        var closing = body.slice(1).trim();
        // pop to the matching element (tolerates sloppy nesting)
        for (var k = stack.length - 1; k > 0; k--) {
          if (stack[k].tag === closing) { stack.length = k; break; }
        }
        continue;
      }
      var selfClosing = body[body.length - 1] === '/';
      if (selfClosing) body = body.slice(0, -1);
      var m = /^([^\s]+)/.exec(body);
      if (!m) continue;
      var node = { tag: m[1], attrs: {}, children: [] };
      attrRe.lastIndex = 0;
      var a;
      var rest = body.slice(m[1].length);
      while ((a = attrRe.exec(rest))) {
        node.attrs[a[1]] = decode(a[3] !== undefined ? a[3] : a[4]);
      }
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    }
    return doc;
  }

  function walk(node, fn, parents) {
    parents = parents || [];
    if (fn(node, parents) === false) return;
    var next = parents.concat([node]);
    for (var i = 0; i < node.children.length; i++) walk(node.children[i], fn, next);
  }

  function findAll(node, tag) {
    var out = [];
    walk(node, function (n) { if (n.tag === tag) out.push(n); });
    return out;
  }

  function findFirst(node, tag) {
    var found = null;
    walk(node, function (n) {
      if (found) return false;
      if (n.tag === tag) { found = n; return false; }
    });
    return found;
  }

  var api = { parseXml: parseXml, walk: walk, findAll: findAll, findFirst: findFirst };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCXml = api;
})(this);
