/* ------------------------------------------------------------------
   export.js  ·  El diagrama a SVG y a PDF (y de ahi a PNG)
   Sin dependencias del DOM ni librerias: se puede probar con Node.
   Expone globalThis.FlowExport  (necesita flow.js y geometry.js)
------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const Flow = root.Flow;
  const Geo = root.FlowGeo;
  if (!Flow || !Geo) throw new Error('export.js necesita flow.js y geometry.js');

  /* Colores pensados para papel: fondo blanco y trazos oscuros. */
  const PAL = {
    page: '#ffffff',
    ink: '#22303f',
    inkSoft: '#7a8698',
    title: '#3a4a5e',
    wire: { out: '#5b6a80', 'true': '#2f8d5f', 'false': '#c24a2e' },
    fill: {
      start: '#dff0e4', end: '#fbe2df', process: '#f6f3ea',
      input: '#e6eff9', output: '#e6eff9', decision: '#fdf1da'
    }
  };

  const MARGIN = 40;
  const TITLE_SPACE = 30;
  const FONT = {
    text: 11,        // el contenido del bloque (monoespaciado)
    term: 12,        // Inicio / Fin
    kind: 7.5,       // la etiqueta PROCESO, SALIDA...
    tag: 8.5,        // Si / No
    title: 13,
    lh: 1.34,        // alto de linea
    cw: 0.6          // ancho de caracter del monoespaciado (Courier = 0.6 em)
  };
  const STROKE = 1.7;
  const ARROW = { len: 9, half: 3.6 };

  /* ---------------- reparto del texto en lineas ---------------- */
  function wrapText(text, maxChars) {
    const source = String(text == null ? '' : text);
    const out = [];
    source.split('\n').forEach(function (para) {
      const words = para.split(/[ \t]+/).filter(function (w) { return w.length > 0; });
      if (!words.length) { out.push(''); return; }
      let line = '';
      words.forEach(function (word) {
        while (word.length > maxChars) {
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, maxChars));
          word = word.slice(maxChars);
        }
        const merged = line ? line + ' ' + word : word;
        if (merged.length <= maxChars) line = merged;
        else { if (line) out.push(line); line = word; }
      });
      if (line) out.push(line);
    });
    return out.length ? out : [''];
  }

  function innerPad(type, w) {
    if (type === 'decision') return Math.round(w * 0.26);
    if (type === 'input' || type === 'output') return 24;
    return 14;
  }

  /* ---------------- punta de flecha ---------------- */
  function arrowHead(points) {
    if (points.length < 2) return null;
    const tip = points[points.length - 1];
    let prev = points[points.length - 2];
    for (let i = points.length - 2; i >= 0; i--) {
      if (Math.abs(points[i].x - tip.x) > 0.5 || Math.abs(points[i].y - tip.y) > 0.5) {
        prev = points[i];
        break;
      }
    }
    const dx = tip.x - prev.x, dy = tip.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len, uy = dy / len;
    const baseX = tip.x - ux * ARROW.len, baseY = tip.y - uy * ARROW.len;
    return [
      { x: tip.x, y: tip.y },
      { x: baseX - uy * ARROW.half, y: baseY + ux * ARROW.half },
      { x: baseX + uy * ARROW.half, y: baseY - ux * ARROW.half }
    ];
  }

  /* ---------------- escena ---------------- */
  /**
   * Convierte el diagrama en una lista de figuras planas, independiente
   * del formato de salida. Coordenadas en las del lienzo.
   */
  function buildScene(graph, options) {
    const opts = options || {};
    const items = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    function grow(x, y) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    graph.edges.forEach(function (edge) {
      const from = Flow.findNode(graph, edge.from);
      const to = Flow.findNode(graph, edge.to);
      if (!from || !to) return;
      const points = Geo.route(from, edge.port, to);
      points.forEach(function (p) { grow(p.x, p.y); });
      items.push({
        kind: 'wire',
        points: points,
        color: PAL.wire[edge.port] || PAL.wire.out,
        head: arrowHead(points)
      });
    });

    graph.nodes.forEach(function (node) {
      const info = Flow.typeInfo(node.type);
      const b = Geo.box(node);
      grow(b.x, b.y);
      grow(b.x + b.w, b.y + b.h);
      items.push({
        kind: 'shape',
        type: node.type,
        x: b.x, y: b.y, w: b.w, h: b.h,
        fill: PAL.fill[node.type] || PAL.fill.process
      });

      // texto centrado dentro del bloque
      const pad = innerPad(node.type, b.w);
      const usable = Math.max(20, b.w - pad * 2);
      let size = info.editable ? FONT.text : FONT.term;
      let maxChars = Math.max(3, Math.floor(usable / (FONT.cw * size)));
      let lines = info.editable ? wrapText(node.text, maxChars) : [info.fixedText];
      const kindH = info.editable ? FONT.kind * 1.7 : 0;

      // si no cabe a lo alto, se encoge un poco la letra
      let blockH = kindH + lines.length * size * FONT.lh;
      if (blockH > b.h - 8 && info.editable) {
        const factor = Math.max(0.72, (b.h - 8 - kindH) / (lines.length * size * FONT.lh));
        size = size * factor;
        maxChars = Math.max(3, Math.floor(usable / (FONT.cw * size)));
        lines = wrapText(node.text, maxChars);
        blockH = kindH + lines.length * size * FONT.lh;
      }

      const cx = b.x + b.w / 2;
      let top = b.y + (b.h - blockH) / 2;
      if (info.editable) {
        items.push({
          kind: 'text',
          text: info.label.toUpperCase(),
          cx: cx,
          baseline: top + FONT.kind,
          size: FONT.kind,
          color: PAL.inkSoft,
          mono: false,
          tracking: 0.55
        });
      }
      lines.forEach(function (line, i) {
        items.push({
          kind: 'text',
          text: line,
          cx: cx,
          baseline: top + kindH + i * size * FONT.lh + size * 0.8,
          size: size,
          color: PAL.ink,
          mono: info.editable,
          bold: !info.editable
        });
      });

      // etiquetas Si / No
      info.ports.forEach(function (port) {
        const label = Flow.PORT_LABEL[port];
        if (!label) return;
        const point = Geo.portPoint(node, port);
        const toLeft = point.dir === 'left';
        items.push({
          kind: 'tag',
          text: label,
          x: point.x + (toLeft ? -7 : 7),
          baseline: point.y - 6,
          anchor: toLeft ? 'end' : 'start',
          size: FONT.tag,
          color: PAL.inkSoft
        });
        grow(point.x + (toLeft ? -34 : 34), point.y - 14);
      });
    });

    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 200; maxY = 120; }

    const title = opts.title === undefined ? (graph.title || '') : opts.title;
    const marginTop = title ? MARGIN + TITLE_SPACE : MARGIN;

    return {
      items: items,
      title: title,
      minX: minX,
      minY: minY,
      margin: MARGIN,
      marginTop: marginTop,
      width: Math.round(maxX - minX + MARGIN * 2),
      height: Math.round(maxY - minY + marginTop + MARGIN),
      palette: PAL
    };
  }

  /* ---------------- contorno de cada figura ---------------- */
  /**
   * Devuelve el contorno como lista de tramos, para que cada formato
   * lo dibuje a su manera:  {t:'m'|'l'|'c'|'z', ...}
   */
  function shapeOutline(type, x, y, w, h) {
    const shape = Flow.typeInfo(type).shape;
    const k = 0.5523;
    const segs = [];
    const m = function (px, py) { segs.push({ t: 'm', x: px, y: py }); };
    const l = function (px, py) { segs.push({ t: 'l', x: px, y: py }); };
    const c = function (x1, y1, x2, y2, x3, y3) {
      segs.push({ t: 'c', x1: x1, y1: y1, x2: x2, y2: y2, x: x3, y: y3 });
    };

    if (shape === 'stadium') {
      const r = Math.min(h / 2, w / 2);
      const kr = k * r;
      m(x + r, y);
      l(x + w - r, y);
      c(x + w - r + kr, y, x + w, y + r - kr, x + w, y + r);
      c(x + w, y + r + kr, x + w - r + kr, y + h, x + w - r, y + h);
      l(x + r, y + h);
      c(x + r - kr, y + h, x, y + r + kr, x, y + r);
      c(x, y + r - kr, x + r - kr, y, x + r, y);
      segs.push({ t: 'z' });
      return segs;
    }
    if (shape === 'parallelogram') {
      const skew = Math.min(22, w * 0.13);
      m(x + skew, y);
      l(x + w, y);
      l(x + w - skew, y + h);
      l(x, y + h);
      segs.push({ t: 'z' });
      return segs;
    }
    if (shape === 'diamond') {
      m(x + w / 2, y);
      l(x + w, y + h / 2);
      l(x + w / 2, y + h);
      l(x, y + h / 2);
      segs.push({ t: 'z' });
      return segs;
    }
    const r = 7, kr = k * 7;
    m(x + r, y);
    l(x + w - r, y);
    c(x + w - r + kr, y, x + w, y + r - kr, x + w, y + r);
    l(x + w, y + h - r);
    c(x + w, y + h - r + kr, x + w - r + kr, y + h, x + w - r, y + h);
    l(x + r, y + h);
    c(x + r - kr, y + h, x, y + h - r + kr, x, y + h - r);
    l(x, y + r);
    c(x, y + r - kr, x + r - kr, y, x + r, y);
    segs.push({ t: 'z' });
    return segs;
  }

  /** Polilinea con esquinas redondeadas -> tramos (m/l/c). */
  function wireOutline(points, radius) {
    const p = [];
    points.forEach(function (pt) {
      const last = p[p.length - 1];
      if (!last || Math.abs(last.x - pt.x) > 0.5 || Math.abs(last.y - pt.y) > 0.5) p.push(pt);
    });
    const segs = [];
    if (p.length < 2) return segs;
    const r = radius === undefined ? 9 : radius;
    segs.push({ t: 'm', x: p[0].x, y: p[0].y });
    const dist = function (a, b) {
      return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
    };
    const toward = function (from, to, d) {
      const len = dist(from, to) || 1;
      return { x: from.x + (to.x - from.x) * (d / len), y: from.y + (to.y - from.y) * (d / len) };
    };
    for (let i = 1; i < p.length - 1; i++) {
      const prev = p[i - 1], cur = p[i], next = p[i + 1];
      const rr = Math.min(r, dist(prev, cur) / 2, dist(cur, next) / 2);
      if (rr < 1.5) { segs.push({ t: 'l', x: cur.x, y: cur.y }); continue; }
      const a = toward(cur, prev, rr);
      const b = toward(cur, next, rr);
      segs.push({ t: 'l', x: a.x, y: a.y });
      // la curva cuadratica (a, cur, b) como cubica exacta
      segs.push({
        t: 'c',
        x1: a.x + (cur.x - a.x) * 2 / 3, y1: a.y + (cur.y - a.y) * 2 / 3,
        x2: b.x + (cur.x - b.x) * 2 / 3, y2: b.y + (cur.y - b.y) * 2 / 3,
        x: b.x, y: b.y
      });
    }
    const last = p[p.length - 1];
    segs.push({ t: 'l', x: last.x, y: last.y });
    return segs;
  }

  /* ---------------- SVG ---------------- */
  const MONO_SVG = "'Courier New', ui-monospace, Consolas, monospace";
  const SANS_SVG = "'Helvetica Neue', Helvetica, Arial, sans-serif";

  function xml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  function n2(v) { return Math.round(v * 100) / 100; }

  function segsToSvg(segs) {
    return segs.map(function (s) {
      if (s.t === 'm') return 'M ' + n2(s.x) + ' ' + n2(s.y);
      if (s.t === 'l') return 'L ' + n2(s.x) + ' ' + n2(s.y);
      if (s.t === 'c') {
        return 'C ' + n2(s.x1) + ' ' + n2(s.y1) + ', ' + n2(s.x2) + ' ' + n2(s.y2) +
          ', ' + n2(s.x) + ' ' + n2(s.y);
      }
      return 'Z';
    }).join(' ');
  }

  function toSVG(scene) {
    const dx = scene.margin - scene.minX;
    const dy = scene.marginTop - scene.minY;
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + scene.width +
      '" height="' + scene.height + '" viewBox="0 0 ' + scene.width + ' ' + scene.height + '">');
    out.push('<rect x="0" y="0" width="' + scene.width + '" height="' + scene.height +
      '" fill="' + PAL.page + '"/>');
    if (scene.title) {
      out.push('<text x="' + scene.margin + '" y="' + n2(scene.margin + 4) +
        '" font-family="' + SANS_SVG + '" font-size="' + FONT.title +
        '" font-weight="600" fill="' + PAL.title + '">' + xml(scene.title) + '</text>');
    }
    out.push('<g transform="translate(' + n2(dx) + ',' + n2(dy) + ')">');

    scene.items.forEach(function (item) {
      if (item.kind === 'wire') {
        out.push('<path d="' + segsToSvg(wireOutline(item.points)) + '" fill="none" stroke="' +
          item.color + '" stroke-width="' + STROKE + '" stroke-linecap="round" stroke-linejoin="round"/>');
        if (item.head) {
          out.push('<path d="' + item.head.map(function (p, i) {
            return (i ? 'L ' : 'M ') + n2(p.x) + ' ' + n2(p.y);
          }).join(' ') + ' Z" fill="' + item.color + '"/>');
        }
        return;
      }
      if (item.kind === 'shape') {
        out.push('<path d="' + segsToSvg(shapeOutline(item.type, item.x, item.y, item.w, item.h)) +
          '" fill="' + item.fill + '" stroke="' + PAL.ink + '" stroke-width="' + STROKE +
          '" stroke-linejoin="round"/>');
        return;
      }
      if (item.kind === 'text') {
        if (!item.text) return;
        out.push('<text x="' + n2(item.cx) + '" y="' + n2(item.baseline) +
          '" text-anchor="middle" font-family="' + (item.mono ? MONO_SVG : SANS_SVG) +
          '" font-size="' + n2(item.size) + '"' +
          (item.bold ? ' font-weight="600"' : '') +
          (item.tracking ? ' letter-spacing="' + item.tracking + '"' : '') +
          ' fill="' + item.color + '">' + xml(item.text) + '</text>');
        return;
      }
      if (item.kind === 'tag') {
        out.push('<text x="' + n2(item.x) + '" y="' + n2(item.baseline) +
          '" text-anchor="' + (item.anchor === 'end' ? 'end' : 'start') +
          '" font-family="' + SANS_SVG + '" font-size="' + item.size +
          '" font-weight="600" fill="' + item.color + '">' + xml(item.text) + '</text>');
      }
    });

    out.push('</g></svg>');
    return out.join('\n');
  }

  /* ---------------- PDF ---------------- */
  const A4 = { w: 595.28, h: 841.89 };

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255
    ];
  }
  function f3(v) { return (Math.round(v * 1000) / 1000).toString(); }

  function pdfString(text) {
    return String(text == null ? '' : text)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/[\r\n\t]/g, ' ');
  }

  /** Courier: todos los caracteres miden 0.6 em, asi el centrado es exacto. */
  function textWidth(text, size, mono) {
    const factor = mono ? FONT.cw : 0.52;      // Helvetica ronda 0.52 em de media
    return String(text == null ? '' : text).length * size * factor;
  }

  function toPDF(scene, options) {
    const opts = options || {};
    const landscape = opts.landscape === undefined ? scene.width > scene.height : opts.landscape;
    const page = landscape ? { w: A4.h, h: A4.w } : { w: A4.w, h: A4.h };
    const pad = 24;
    const scale = Math.min(
      (page.w - pad * 2) / scene.width,
      (page.h - pad * 2) / scene.height,
      1.6
    );
    const tx = (page.w - scene.width * scale) / 2;
    const ty = (page.h - scene.height * scale) / 2;
    const dx = scene.margin - scene.minX;
    const dy = scene.marginTop - scene.minY;

    const X = function (x) { return tx + (x + dx) * scale; };
    const Y = function (y) { return page.h - (ty + (y + dy) * scale); };
    const S = function (v) { return v * scale; };

    const ops = [];
    ops.push('1 J 1 j');

    function segsToPdf(segs) {
      segs.forEach(function (s) {
        if (s.t === 'm') ops.push(f3(X(s.x)) + ' ' + f3(Y(s.y)) + ' m');
        else if (s.t === 'l') ops.push(f3(X(s.x)) + ' ' + f3(Y(s.y)) + ' l');
        else if (s.t === 'c') {
          ops.push(f3(X(s.x1)) + ' ' + f3(Y(s.y1)) + ' ' +
            f3(X(s.x2)) + ' ' + f3(Y(s.y2)) + ' ' +
            f3(X(s.x)) + ' ' + f3(Y(s.y)) + ' c');
        } else ops.push('h');
      });
    }

    function setFill(hex) {
      const c = hexToRgb(hex);
      ops.push(f3(c[0]) + ' ' + f3(c[1]) + ' ' + f3(c[2]) + ' rg');
    }
    function setStroke(hex) {
      const c = hexToRgb(hex);
      ops.push(f3(c[0]) + ' ' + f3(c[1]) + ' ' + f3(c[2]) + ' RG');
    }

    // fondo
    setFill(PAL.page);
    ops.push('0 0 ' + f3(page.w) + ' ' + f3(page.h) + ' re f');

    if (scene.title) {
      setFill(PAL.title);
      ops.push('BT /F3 ' + f3(S(FONT.title)) + ' Tf ' +
        f3(tx + S(scene.margin)) + ' ' + f3(page.h - ty - S(scene.margin + 4)) + ' Td (' +
        pdfString(scene.title) + ') Tj ET');
    }

    scene.items.forEach(function (item) {
      if (item.kind === 'wire') {
        setStroke(item.color);
        ops.push(f3(S(STROKE)) + ' w');
        segsToPdf(wireOutline(item.points));
        ops.push('S');
        if (item.head) {
          setFill(item.color);
          item.head.forEach(function (p, i) {
            ops.push(f3(X(p.x)) + ' ' + f3(Y(p.y)) + (i ? ' l' : ' m'));
          });
          ops.push('h f');
        }
        return;
      }
      if (item.kind === 'shape') {
        setFill(item.fill);
        setStroke(PAL.ink);
        ops.push(f3(S(STROKE)) + ' w');
        segsToPdf(shapeOutline(item.type, item.x, item.y, item.w, item.h));
        ops.push('B');
        return;
      }
      if (item.kind === 'text' || item.kind === 'tag') {
        if (!item.text) return;
        const mono = item.kind === 'text' ? !!item.mono : false;
        const font = mono ? 'F1' : (item.bold || item.kind === 'tag' ? 'F3' : 'F2');
        const size = S(item.size);
        const width = S(textWidth(item.text, item.size, mono)) +
          (item.tracking ? S(item.tracking) * (item.text.length - 1) : 0);
        let x;
        if (item.kind === 'tag') x = item.anchor === 'end' ? X(item.x) - width : X(item.x);
        else x = X(item.cx) - width / 2;
        setFill(item.color);
        ops.push('BT /' + font + ' ' + f3(size) + ' Tf' +
          (item.tracking ? ' ' + f3(S(item.tracking)) + ' Tc' : ' 0 Tc') +
          ' ' + f3(x) + ' ' + f3(Y(item.baseline)) + ' Td (' + pdfString(item.text) + ') Tj ET');
      }
    });

    const content = ops.join('\n');

    /* ---- armado del archivo ---- */
    const bytes = [];
    function raw(str) {
      for (let i = 0; i < str.length; i++) {
        const code = str.codePointAt(i);
        if (code > 0xffff) i++;                     // par subrogado
        bytes.push(code <= 0xff ? code : 63);       // WinAnsi: lo raro pasa a '?'
      }
    }

    const objects = [
      '<</Type /Catalog /Pages 2 0 R>>',
      '<</Type /Pages /Kids [3 0 R] /Count 1>>',
      '<</Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f3(page.w) + ' ' + f3(page.h) +
        '] /Resources <</Font <</F1 5 0 R /F2 6 0 R /F3 7 0 R>>>> /Contents 4 0 R>>',
      null,   // el contenido, que lleva stream
      '<</Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding>>',
      '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding>>',
      '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding>>'
    ];

    // longitud del contenido en bytes (no en caracteres)
    let contentLength = 0;
    for (let i = 0; i < content.length; i++) {
      const code = content.codePointAt(i);
      if (code > 0xffff) i++;
      contentLength++;
    }

    raw('%PDF-1.4\n');
    bytes.push(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a);      // marca de binario
    const offsets = [];
    objects.forEach(function (body, index) {
      const num = index + 1;
      offsets.push(bytes.length);
      if (body === null) {
        raw(num + ' 0 obj\n<</Length ' + contentLength + '>>\nstream\n');
        raw(content);
        raw('\nendstream\nendobj\n');
      } else {
        raw(num + ' 0 obj\n' + body + '\nendobj\n');
      }
    });

    const xrefStart = bytes.length;
    raw('xref\n0 ' + (objects.length + 1) + '\n');
    raw('0000000000 65535 f \n');
    offsets.forEach(function (offset) {
      raw(('0000000000' + offset).slice(-10) + ' 00000 n \n');
    });
    raw('trailer\n<</Size ' + (objects.length + 1) + ' /Root 1 0 R>>\n' +
      'startxref\n' + xrefStart + '\n%%EOF\n');

    return new Uint8Array(bytes);
  }

  /* ---------------- nombre de archivo ---------------- */
  function fileName(title, extension) {
    const clean = String(title || 'diagrama')
      .normalize ? String(title || 'diagrama').normalize('NFD').replace(/[̀-ͯ]/g, '')
      : String(title || 'diagrama');
    const safe = clean.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-');
    return (safe || 'diagrama') + '.' + extension;
  }

  root.FlowExport = {
    PALETTE: PAL,
    buildScene: buildScene,
    toSVG: toSVG,
    toPDF: toPDF,
    wrapText: wrapText,
    shapeOutline: shapeOutline,
    wireOutline: wireOutline,
    textWidth: textWidth,
    fileName: fileName
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
