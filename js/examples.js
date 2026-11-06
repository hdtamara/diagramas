/* ------------------------------------------------------------------
   examples.js  ·  Diagramas de ejemplo listos para ejecutar
   Expone globalThis.FlowExamples (necesita flow.js)
------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const Flow = root.Flow;
  if (!Flow) throw new Error('examples.js necesita flow.js');

  const LANES = { l: 250, c: 560, r: 880, rr: 1200 };

  /** Coloca un bloque centrado en un carril. */
  function at(type, lane, y) {
    const w = Flow.typeInfo(type).w;
    return { x: Math.round((LANES[lane] || LANES.c) - w / 2), y: y };
  }

  /**
   * spec: [id, tipo, texto, carril, y]
   * links: [desde, puerto, hasta]
   */
  function build(title, spec, links) {
    const nodes = spec.map(function (s) {
      const pos = at(s[1], s[3], s[4]);
      return { id: s[0], type: s[1], text: s[2], x: pos.x, y: pos.y };
    });
    const edges = links.map(function (l, i) {
      return { id: 'e' + (i + 1), from: l[0], port: l[1], to: l[2] };
    });
    return { version: 1, title: title, nodes: nodes, edges: edges };
  }

  const EXAMPLES = [
    {
      key: 'suma',
      name: 'Suma de dos números',
      note: 'Lo más basico: leer, calcular y mostrar.',
      make: function () {
        return build('Suma de dos números', [
          ['s', 'start', '', 'c', 40],
          ['i1', 'input', 'a', 'c', 150],
          ['i2', 'input', 'b', 'c', 260],
          ['p1', 'process', 'suma = a + b', 'c', 370],
          ['o1', 'output', '"La suma es: ", suma', 'c', 480],
          ['f', 'end', '', 'c', 590]
        ], [
          ['s', 'out', 'i1'],
          ['i1', 'out', 'i2'],
          ['i2', 'out', 'p1'],
          ['p1', 'out', 'o1'],
          ['o1', 'out', 'f']
        ]);
      }
    },
    {
      key: 'par',
      name: 'Par o impar',
      note: 'Una decision con sus dos ramas.',
      make: function () {
        return build('Par o impar', [
          ['s', 'start', '', 'c', 40],
          ['i1', 'input', 'n', 'c', 150],
          ['d1', 'decision', 'n mod 2 == 0', 'c', 260],
          ['o1', 'output', '"El número ", n, " es par"', 'l', 470],
          ['o2', 'output', '"El número ", n, " es impar"', 'r', 470],
          ['f', 'end', '', 'c', 620]
        ], [
          ['s', 'out', 'i1'],
          ['i1', 'out', 'd1'],
          ['d1', 'true', 'o1'],
          ['d1', 'false', 'o2'],
          ['o1', 'out', 'f'],
          ['o2', 'out', 'f']
        ]);
      }
    },
    {
      key: 'mayor',
      name: 'El mayor de tres números',
      note: 'Decisiones encadenadas.',
      make: function () {
        return build('El mayor de tres números', [
          ['s', 'start', '', 'c', 40],
          ['i1', 'input', 'a, b, c', 'c', 150],
          ['d1', 'decision', 'a >= b y a >= c', 'c', 260],
          ['o1', 'output', '"El mayor es ", a', 'l', 660],
          ['d2', 'decision', 'b >= c', 'r', 450],
          ['o2', 'output', '"El mayor es ", b', 'c', 660],
          ['o3', 'output', '"El mayor es ", c', 'rr', 660],
          ['f', 'end', '', 'c', 810]
        ], [
          ['s', 'out', 'i1'],
          ['i1', 'out', 'd1'],
          ['d1', 'true', 'o1'],
          ['d1', 'false', 'd2'],
          ['d2', 'true', 'o2'],
          ['d2', 'false', 'o3'],
          ['o1', 'out', 'f'],
          ['o2', 'out', 'f'],
          ['o3', 'out', 'f']
        ]);
      }
    },
    {
      key: 'tabla',
      name: 'Tabla de multiplicar',
      note: 'Un bucle: la flecha vuelve hacia arriba.',
      make: function () {
        return build('Tabla de multiplicar', [
          ['s', 'start', '', 'c', 40],
          ['i1', 'input', 'n', 'c', 150],
          ['p1', 'process', 'i = 1', 'c', 260],
          ['d1', 'decision', 'i <= 10', 'c', 370],
          ['o1', 'output', 'n, " x ", i, " = ", n * i', 'l', 570],
          ['p2', 'process', 'i = i + 1', 'l', 690],
          ['f', 'end', '', 'r', 520]
        ], [
          ['s', 'out', 'i1'],
          ['i1', 'out', 'p1'],
          ['p1', 'out', 'd1'],
          ['d1', 'true', 'o1'],
          ['d1', 'false', 'f'],
          ['o1', 'out', 'p2'],
          ['p2', 'out', 'd1']
        ]);
      }
    },
    {
      key: 'factorial',
      name: 'Factorial',
      note: 'Bucle con acumulador.',
      make: function () {
        return build('Factorial', [
          ['s', 'start', '', 'c', 40],
          ['i1', 'input', 'n', 'c', 150],
          ['p1', 'process', 'f = 1', 'c', 250],
          ['p2', 'process', 'i = 1', 'c', 350],
          ['d1', 'decision', 'i <= n', 'c', 470],
          ['p3', 'process', 'f = f * i', 'l', 670],
          ['p4', 'process', 'i = i + 1', 'l', 780],
          ['o1', 'output', '"El factorial de ", n, " es ", f', 'r', 600],
          ['f', 'end', '', 'r', 720]
        ], [
          ['s', 'out', 'i1'],
          ['i1', 'out', 'p1'],
          ['p1', 'out', 'p2'],
          ['p2', 'out', 'd1'],
          ['d1', 'true', 'p3'],
          ['d1', 'false', 'o1'],
          ['p3', 'out', 'p4'],
          ['p4', 'out', 'd1'],
          ['o1', 'out', 'f']
        ]);
      }
    },
    {
      key: 'promedio',
      name: 'Promedio de varias notas',
      note: 'Contador, acumulador y entrada dentro del bucle.',
      make: function () {
        return build('Promedio de varias notas', [
          ['s', 'start', '', 'c', 40],
          ['i1', 'input', 'cantidad', 'c', 150],
          ['p1', 'process', 'suma = 0; contador = 0', 'c', 260],
          ['d1', 'decision', 'contador < cantidad', 'c', 380],
          ['i2', 'input', 'nota', 'l', 580],
          ['p2', 'process', 'suma = suma + nota; contador = contador + 1', 'l', 700],
          ['p3', 'process', 'promedio = suma / cantidad', 'r', 520],
          ['o1', 'output', '"El promedio es ", redondear(promedio, 2)', 'r', 640],
          ['f', 'end', '', 'r', 790]
        ], [
          ['s', 'out', 'i1'],
          ['i1', 'out', 'p1'],
          ['p1', 'out', 'd1'],
          ['d1', 'true', 'i2'],
          ['d1', 'false', 'p3'],
          ['i2', 'out', 'p2'],
          ['p2', 'out', 'd1'],
          ['p3', 'out', 'o1'],
          ['o1', 'out', 'f']
        ]);
      }
    },
    {
      key: 'adivina',
      name: 'Adivina el número',
      note: 'Bucle con condición compuesta y números al azar.',
      make: function () {
        return build('Adivina el número', [
          ['s', 'start', '', 'c', 40],
          ['p1', 'process', 'secreto = aleatorio(1, 100); intentos = 0', 'c', 150],
          ['o0', 'output', '"Piensa un número del 1 al 100"', 'c', 260],
          ['i1', 'input', 'intento', 'c', 370],
          ['p2', 'process', 'intentos = intentos + 1', 'c', 480],
          ['d1', 'decision', 'intento == secreto', 'c', 590],
          ['d2', 'decision', 'intento < secreto', 'r', 780],
          ['o1', 'output', '"Muy bajo, prueba más alto"', 'c', 1010],
          ['o2', 'output', '"Muy alto, prueba más bajo"', 'rr', 1010],
          ['o3', 'output', '"Correcto! Lo lograste en ", intentos, " intentos"', 'l', 800],
          ['f', 'end', '', 'l', 920]
        ], [
          ['s', 'out', 'p1'],
          ['p1', 'out', 'o0'],
          ['o0', 'out', 'i1'],
          ['i1', 'out', 'p2'],
          ['p2', 'out', 'd1'],
          ['d1', 'true', 'o3'],
          ['d1', 'false', 'd2'],
          ['d2', 'true', 'o1'],
          ['d2', 'false', 'o2'],
          ['o1', 'out', 'i1'],
          ['o2', 'out', 'i1'],
          ['o3', 'out', 'f']
        ]);
      }
    }
  ];

  root.FlowExamples = {
    list: EXAMPLES.map(function (e) { return { key: e.key, name: e.name, note: e.note }; }),
    get: function (key) {
      for (let i = 0; i < EXAMPLES.length; i++) {
        if (EXAMPLES[i].key === key) return EXAMPLES[i].make();
      }
      return null;
    },
    starter: function () { return EXAMPLES[0].make(); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
