/* ------------------------------------------------------------------
   geometry.js  ·  Formas de los bloques y trazado de las flechas
   Sin dependencias del DOM. Expone globalThis.FlowGeo (necesita Flow)
------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const Flow = root.Flow;
  if (!Flow) throw new Error('geometry.js necesita flow.js');

  const STUB = 20;   // tramo recto al salir de un bloque
  const GAP = 24;    // tramo recto antes de entrar en un bloque
  const LANE = 38;   // separacion del carril lateral
  const RADIUS = 9;  // redondeo de las esquinas

  function box(node) {
    const info = Flow.typeInfo(node.type);
    return {
      x: node.x,
      y: node.y,
      w: node.w || info.w,
      h: node.h || info.minH
    };
  }

  /** Punto por donde sale una flecha.
      En la decision las dos ramas salen por los lados: Si a la izquierda
      y No a la derecha, dejando libre el vertice de abajo.               */
  function portPoint(node, port) {
    const b = box(node);
    if (node.type === 'decision') {
      if (port === 'true') return { x: b.x, y: b.y + b.h / 2, dir: 'left' };
      if (port === 'false') return { x: b.x + b.w, y: b.y + b.h / 2, dir: 'right' };
    }
    return { x: b.x + b.w / 2, y: b.y + b.h, dir: 'down' };
  }

  /** Punto por donde entra una flecha (siempre por arriba). */
  function entryPoint(node) {
    const b = box(node);
    return { x: b.x + b.w / 2, y: b.y, dir: 'down' };
  }

  /** Carril por el que sube una flecha de retorno: por el lado del que sale,
      y por la izquierda cuando los dos bloques estan en la misma columna. */
  function laneX(b1, b2, p1, p2) {
    const left = Math.min(b1.x, b2.x) - LANE;
    const right = Math.max(b1.x + b1.w, b2.x + b2.w) + LANE;
    if (p1.x > p2.x + 4) return right;
    return Math.max(6, left);
  }

  /**
   * Calcula la polilinea de una flecha. Distingue tres casos:
   * recta hacia abajo, escalon hacia abajo y retorno (bucle) por un carril.
   */
  function route(from, port, to) {
    const p1 = portPoint(from, port);
    const p2 = entryPoint(to);
    const b1 = box(from);
    const b2 = box(to);
    const pts = [{ x: p1.x, y: p1.y }];

    if (p1.dir === 'down') {
      if (Math.abs(p1.x - p2.x) < 2 && p2.y > p1.y) {
        pts.push({ x: p2.x, y: p2.y });          // misma columna: recta
        return pts;
      }
      if (p2.y > p1.y + 8) {
        const midY = Math.round((p1.y + p2.y) / 2);   // mas abajo: un escalon
        pts.push({ x: p1.x, y: midY }, { x: p2.x, y: midY }, { x: p2.x, y: p2.y });
        return pts;
      }
      const lane = laneX(b1, b2, p1, p2);        // retorno: carril lateral
      pts.push({ x: p1.x, y: p1.y + STUB });
      pts.push({ x: lane, y: p1.y + STUB });
      pts.push({ x: lane, y: p2.y - GAP });
      pts.push({ x: p2.x, y: p2.y - GAP });
      pts.push({ x: p2.x, y: p2.y });
      return pts;
    }

    // salida lateral: las dos ramas de una decision (izquierda o derecha)
    const sign = p1.dir === 'left' ? -1 : 1;
    const stubX = p1.x + sign * STUB;
    if (p2.y > p1.y + 8) {
      const cx = sign > 0 ? Math.max(stubX, p2.x) : Math.min(stubX, p2.x);
      if (Math.abs(cx - p2.x) < 2) {
        pts.push({ x: p2.x, y: p1.y }, { x: p2.x, y: p2.y });
      } else {
        // si el destino esta muy cerca, el tramo recto de entrada se acorta
        const preY = Math.max(p1.y, p2.y - GAP);
        pts.push({ x: cx, y: p1.y });
        pts.push({ x: cx, y: preY });
        pts.push({ x: p2.x, y: preY });
        pts.push({ x: p2.x, y: p2.y });
      }
      return pts;
    }
    const lane = sign > 0
      ? Math.max(stubX, b1.x + b1.w + LANE, b2.x + b2.w + LANE)
      : Math.max(6, Math.min(stubX, b1.x - LANE, b2.x - LANE));
    pts.push({ x: lane, y: p1.y });
    pts.push({ x: lane, y: p2.y - GAP });
    pts.push({ x: p2.x, y: p2.y - GAP });
    pts.push({ x: p2.x, y: p2.y });
    return pts;
  }

  function dedupe(pts) {
    const out = [];
    pts.forEach(function (p) {
      const last = out[out.length - 1];
      if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p);
    });
    return out;
  }

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  function toward(from, to, d) {
    const len = dist(from, to);
    if (len === 0) return { x: from.x, y: from.y };
    const t = d / len;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }

  function r1(n) { return Math.round(n * 10) / 10; }

  /** Polilinea -> path SVG con esquinas redondeadas. */
  function elbowPath(points, radius) {
    const p = dedupe(points);
    if (p.length < 2) return '';
    const r = radius === undefined ? RADIUS : radius;
    let d = 'M ' + r1(p[0].x) + ' ' + r1(p[0].y);
    for (let i = 1; i < p.length - 1; i++) {
      const prev = p[i - 1], cur = p[i], next = p[i + 1];
      const rr = Math.min(r, dist(prev, cur) / 2, dist(cur, next) / 2);
      if (rr < 1.5) {
        d += ' L ' + r1(cur.x) + ' ' + r1(cur.y);
        continue;
      }
      const a = toward(cur, prev, rr);
      const b = toward(cur, next, rr);
      d += ' L ' + r1(a.x) + ' ' + r1(a.y) +
        ' Q ' + r1(cur.x) + ' ' + r1(cur.y) + ' ' + r1(b.x) + ' ' + r1(b.y);
    }
    const last = p[p.length - 1];
    return d + ' L ' + r1(last.x) + ' ' + r1(last.y);
  }

  /** Punto medio (por longitud) de la polilinea: para el botón de borrar. */
  function midpoint(points) {
    const p = dedupe(points);
    if (!p.length) return { x: 0, y: 0 };
    if (p.length === 1) return { x: p[0].x, y: p[0].y };
    let total = 0;
    for (let i = 1; i < p.length; i++) total += dist(p[i - 1], p[i]);
    let target = total / 2;
    for (let i = 1; i < p.length; i++) {
      const seg = dist(p[i - 1], p[i]);
      if (target <= seg) return toward(p[i - 1], p[i], target);
      target -= seg;
    }
    return { x: p[p.length - 1].x, y: p[p.length - 1].y };
  }

  /** Contorno de cada tipo de bloque, en pixeles reales. */
  function shapePath(type, w, h) {
    const inset = 1.25;                       // deja sitio al grosor del borde
    const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
    const info = Flow.typeInfo(type);
    switch (info.shape) {
      case 'stadium': {
        const r = Math.min((y1 - y0) / 2, (x1 - x0) / 2);
        return 'M ' + (x0 + r) + ' ' + y0 +
          ' H ' + (x1 - r) +
          ' A ' + r + ' ' + r + ' 0 0 1 ' + (x1 - r) + ' ' + y1 +
          ' H ' + (x0 + r) +
          ' A ' + r + ' ' + r + ' 0 0 1 ' + (x0 + r) + ' ' + y0 + ' Z';
      }
      case 'parallelogram': {
        const skew = Math.min(22, w * 0.13);
        return 'M ' + (x0 + skew) + ' ' + y0 +
          ' L ' + x1 + ' ' + y0 +
          ' L ' + (x1 - skew) + ' ' + y1 +
          ' L ' + x0 + ' ' + y1 + ' Z';
      }
      case 'diamond': {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        return 'M ' + cx + ' ' + y0 +
          ' L ' + x1 + ' ' + cy +
          ' L ' + cx + ' ' + y1 +
          ' L ' + x0 + ' ' + cy + ' Z';
      }
      default: {
        const r = 7;
        return 'M ' + (x0 + r) + ' ' + y0 +
          ' H ' + (x1 - r) + ' Q ' + x1 + ' ' + y0 + ' ' + x1 + ' ' + (y0 + r) +
          ' V ' + (y1 - r) + ' Q ' + x1 + ' ' + y1 + ' ' + (x1 - r) + ' ' + y1 +
          ' H ' + (x0 + r) + ' Q ' + x0 + ' ' + y1 + ' ' + x0 + ' ' + (y1 - r) +
          ' V ' + (y0 + r) + ' Q ' + x0 + ' ' + y0 + ' ' + (x0 + r) + ' ' + y0 + ' Z';
      }
    }
  }

  root.FlowGeo = {
    STUB: STUB,
    GAP: GAP,
    LANE: LANE,
    box: box,
    portPoint: portPoint,
    entryPoint: entryPoint,
    route: route,
    elbowPath: elbowPath,
    midpoint: midpoint,
    shapePath: shapePath
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
