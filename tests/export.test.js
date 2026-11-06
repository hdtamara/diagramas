/* Pruebas del exportador (SVG y PDF) con Node puro:
     node tests/export.test.js                                        */
'use strict';

require('../js/expr.js');
require('../js/flow.js');
require('../js/geometry.js');
require('../js/examples.js');
require('../js/export.js');

const Flow = globalThis.Flow;
const Examples = globalThis.FlowExamples;
const Exp = globalThis.FlowExport;

let passed = 0;
const failures = [];

function check(name, fn) {
  try { fn(); passed++; }
  catch (err) { failures.push(name + '\n      ' + (err && err.message ? err.message : String(err))); }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((what ? what + ': ' : '') + 'esperaba ' + b + ' y obtuve ' + a);
}
function ok(cond, what) { if (!cond) throw new Error(what || 'esperaba algo verdadero'); }

const graphOf = function (key) { return Flow.deserialize(Examples.get(key)); };
const latin1 = function (bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

/* ---------------- reparto del texto ---------------- */
check('el texto se reparte en lineas', function () {
  eq(Exp.wrapText('hola', 10), ['hola']);
  eq(Exp.wrapText('suma = a + b', 8), ['suma = a', '+ b'], 'corta lo mas tarde posible');
  eq(Exp.wrapText('suma = a + b', 6), ['suma =', 'a + b']);
  eq(Exp.wrapText('a\nb', 10), ['a', 'b']);
  eq(Exp.wrapText('', 10), ['']);
  eq(Exp.wrapText('abcdefghij', 4), ['abcd', 'efgh', 'ij'], 'una palabra larga se corta');
  Exp.wrapText('suma = suma + nota; contador = contador + 1', 20).forEach(function (line) {
    ok(line.length <= 20, 'linea demasiado larga: ' + line);
  });
});

/* ---------------- escena ---------------- */
check('la escena tiene una figura por bloque y por flecha', function () {
  const g = graphOf('promedio');
  const scene = Exp.buildScene(g);
  eq(scene.items.filter(function (i) { return i.kind === 'shape'; }).length, g.nodes.length);
  eq(scene.items.filter(function (i) { return i.kind === 'wire'; }).length, g.edges.length);
  ok(scene.width > 200 && scene.height > 200, 'medidas raras: ' + scene.width + 'x' + scene.height);
  ok(scene.title === 'Promedio de varias notas', 'deberia llevar el titulo');
});

check('todas las flechas llevan punta', function () {
  const scene = Exp.buildScene(graphOf('mayor'));
  scene.items.filter(function (i) { return i.kind === 'wire'; }).forEach(function (wire) {
    ok(wire.head && wire.head.length === 3, 'flecha sin punta');
    wire.head.forEach(function (p) {
      ok(isFinite(p.x) && isFinite(p.y), 'punta con coordenadas invalidas');
    });
  });
});

check('el texto de cada bloque cabe dentro de su figura', function () {
  Examples.list.forEach(function (item) {
    const g = graphOf(item.key);
    const scene = Exp.buildScene(g);
    const shapes = scene.items.filter(function (i) { return i.kind === 'shape'; });
    const texts = scene.items.filter(function (i) { return i.kind === 'text'; });
    texts.forEach(function (t) {
      const holder = shapes.filter(function (s) {
        return t.cx >= s.x && t.cx <= s.x + s.w && t.baseline >= s.y - 2 && t.baseline <= s.y + s.h + 2;
      });
      ok(holder.length > 0, item.key + ': el texto "' + t.text + '" se sale del bloque');
      const width = Exp.textWidth(t.text, t.size, t.mono);
      const box = holder[0];
      ok(width <= box.w + 1, item.key + ': "' + t.text + '" mide ' + Math.round(width) +
        ' y el bloque ' + Math.round(box.w));
    });
  });
});

check('sin bloques no revienta', function () {
  const scene = Exp.buildScene(Flow.createGraph());
  ok(scene.width > 0 && scene.height > 0);
  const svg = Exp.toSVG(scene);
  ok(svg.indexOf('<svg') >= 0);
  ok(Exp.toPDF(scene).length > 400);
});

/* ---------------- SVG ---------------- */
check('el SVG esta bien formado', function () {
  const scene = Exp.buildScene(graphOf('tabla'));
  const svg = Exp.toSVG(scene);
  ok(svg.indexOf('<?xml') === 0, 'deberia empezar por la cabecera xml');
  ok(/<svg[^>]+width="\d+"[^>]+height="\d+"/.test(svg), 'faltan las medidas');
  ok(svg.trim().slice(-6) === '</svg>', 'deberia cerrar el svg');
  ok(!/NaN|undefined|Infinity/.test(svg), 'hay valores invalidos en el svg');
  eq((svg.match(/<svg/g) || []).length, 1);
  eq((svg.match(/<\/g>/g) || []).length, 1);
  const shapes = (svg.match(/<path/g) || []).length;
  ok(shapes >= 7 + 7, 'faltan contornos: ' + shapes);
  ok(svg.indexOf('n mod 2') < 0, 'ese texto no es de este ejemplo');
  ok(svg.indexOf('i &lt;= 10') >= 0, 'el texto deberia ir escapado');
});

check('el SVG escapa comillas y simbolos del texto', function () {
  const g = Flow.deserialize({
    title: 'raro & <malo>',
    nodes: [
      { id: 's', type: 'start', x: 40, y: 40 },
      { id: 'o', type: 'output', x: 40, y: 160, text: '"a" < "b" & c' }
    ],
    edges: [{ from: 's', port: 'out', to: 'o' }]
  });
  const svg = Exp.toSVG(Exp.buildScene(g));
  ok(svg.indexOf('&amp;') >= 0, 'el & deberia escaparse');
  ok(svg.indexOf('&lt;') >= 0, 'el < deberia escaparse');
  ok(!/<text[^>]*>[^<]*<(?!\/text)/.test(svg), 'hay un < sin escapar dentro de un texto');
});

/* ---------------- PDF ---------------- */
function parsePdf(bytes) {
  const text = latin1(bytes);
  ok(text.indexOf('%PDF-1.4') === 0, 'la cabecera deberia ser %PDF-1.4');
  ok(/%%EOF\s*$/.test(text), 'deberia terminar en %%EOF');

  const startIndex = text.lastIndexOf('startxref');
  ok(startIndex > 0, 'falta startxref');
  const startxref = parseInt(text.slice(startIndex + 9).trim(), 10);
  ok(text.slice(startxref, startxref + 4) === 'xref',
    'startxref (' + startxref + ') no apunta a la tabla xref sino a "' +
    text.slice(startxref, startxref + 12) + '"');

  const xrefBody = text.slice(startxref);
  const sizeMatch = /\/Size (\d+)/.exec(xrefBody);
  ok(sizeMatch, 'el trailer no dice el tamano');
  const size = parseInt(sizeMatch[1], 10);

  const entries = xrefBody.match(/^\d{10} \d{5} [nf] $/gm) || [];
  eq(entries.length, size, 'la tabla xref deberia tener una entrada por objeto');

  // cada offset debe caer justo en su objeto
  for (let num = 1; num < size; num++) {
    const offset = parseInt(entries[num].slice(0, 10), 10);
    const head = text.slice(offset, offset + 24);
    ok(head.indexOf(num + ' 0 obj') === 0,
      'el objeto ' + num + ' deberia empezar en ' + offset + ' y alli hay "' + head.slice(0, 16) + '"');
  }

  // el /Length del contenido tiene que cuadrar con el stream de verdad
  const lengthMatch = /<<\/Length (\d+)>>\nstream\n/.exec(text);
  ok(lengthMatch, 'no encuentro el stream del contenido');
  const streamStart = lengthMatch.index + lengthMatch[0].length;
  const declared = parseInt(lengthMatch[1], 10);
  const endIndex = text.indexOf('\nendstream', streamStart);
  ok(endIndex > 0, 'el stream no se cierra');
  eq(endIndex - streamStart, declared, 'el /Length declarado no coincide con el stream');

  return { text: text, size: size, content: text.slice(streamStart, endIndex) };
}

check('el PDF tiene una estructura valida', function () {
  const bytes = Exp.toPDF(Exp.buildScene(graphOf('suma')));
  ok(bytes instanceof Uint8Array, 'deberia devolver bytes');
  const pdf = parsePdf(bytes);
  eq(pdf.size, 8, 'catalogo, paginas, pagina, contenido y tres fuentes');
  ok(pdf.text.indexOf('/BaseFont /Courier') > 0, 'falta la fuente monoespaciada');
  ok(pdf.text.indexOf('/WinAnsiEncoding') > 0, 'las fuentes necesitan codificacion WinAnsi');
  ok(pdf.text.indexOf('/MediaBox') > 0, 'falta el tamano de pagina');
});

check('el contenido del PDF no lleva valores invalidos', function () {
  Examples.list.forEach(function (item) {
    const pdf = parsePdf(Exp.toPDF(Exp.buildScene(graphOf(item.key))));
    ok(!/NaN|undefined|Infinity/.test(pdf.content), item.key + ': contenido con valores invalidos');
    // los operadores de dibujo esperados
    ok(pdf.content.indexOf(' m\n') > 0 || / m$/m.test(pdf.content), item.key + ': sin trazos');
    ok(/\bBT\b/.test(pdf.content) && /\bET\b/.test(pdf.content), item.key + ': sin texto');
    eq((pdf.content.match(/\bBT\b/g) || []).length, (pdf.content.match(/\bET\b/g) || []).length,
      item.key + ': BT y ET descompensados');
    ok(/\bB$|\bB\n/m.test(pdf.content), item.key + ': las figuras deberian rellenarse y trazarse');
  });
});

check('los parentesis y las tildes del texto no rompen el PDF', function () {
  const g = Flow.deserialize({
    title: 'Prueba (rara) \\ con acentos: ñ á',
    nodes: [
      { id: 's', type: 'start', x: 40, y: 40 },
      { id: 'p', type: 'process', x: 40, y: 160, text: 'x = redondear(a, 2)' },
      { id: 'o', type: 'output', x: 40, y: 280, text: '"mañana (o no)", x' }
    ],
    edges: [
      { from: 's', port: 'out', to: 'p' },
      { from: 'p', port: 'out', to: 'o' }
    ]
  });
  const pdf = parsePdf(Exp.toPDF(Exp.buildScene(g)));
  ok(pdf.content.indexOf('\\(') > 0, 'los parentesis deberian ir escapados');
  ok(pdf.content.indexOf('\\\\') > 0, 'la barra deberia ir escapada');
  // los parentesis sin escapar romperian el objeto: no debe haber ninguno suelto
  const inStrings = pdf.content.match(/\(([^()\\]|\\.)*\)/g) || [];
  ok(inStrings.length > 3, 'deberia haber varios textos');
});

check('la pagina se orienta segun la forma del diagrama', function () {
  // una columna de bloques: mucho mas alto que ancho
  const columna = Flow.deserialize({
    nodes: [
      { id: 's', type: 'start', x: 100, y: 40 },
      { id: 'a', type: 'process', x: 100, y: 200, text: 'x = 1' },
      { id: 'b', type: 'process', x: 100, y: 360, text: 'x = 2' },
      { id: 'c', type: 'process', x: 100, y: 520, text: 'x = 3' },
      { id: 'f', type: 'end', x: 100, y: 680 }
    ],
    edges: [
      { from: 's', port: 'out', to: 'a' },
      { from: 'a', port: 'out', to: 'b' },
      { from: 'b', port: 'out', to: 'c' },
      { from: 'c', port: 'out', to: 'f' }
    ]
  });
  const alto = Exp.toPDF(Exp.buildScene(columna));
  const ancho = Exp.toPDF(Exp.buildScene(graphOf('suma')), { landscape: true });
  const boxOf = function (bytes) {
    const m = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(latin1(bytes));
    return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
  };
  const vertical = boxOf(alto);
  ok(vertical.h > vertical.w, 'un diagrama alto deberia ir en vertical');
  const horizontal = boxOf(ancho);
  ok(horizontal.w > horizontal.h, 'forzando landscape deberia ir en horizontal');
});

check('el diagrama entra en la pagina', function () {
  Examples.list.forEach(function (item) {
    const scene = Exp.buildScene(graphOf(item.key));
    const text = latin1(Exp.toPDF(scene));
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    const w = parseFloat(box[1]), h = parseFloat(box[2]);
    const numbers = text.slice(text.indexOf('stream'), text.indexOf('endstream'))
      .match(/-?\d+\.?\d*/g) || [];
    numbers.forEach(function (raw) {
      const v = parseFloat(raw);
      ok(v > -200 && v < Math.max(w, h) + 200,
        item.key + ': coordenada fuera de la pagina: ' + v);
    });
  });
});

/* ---------------- nombres de archivo ---------------- */
check('el nombre de archivo se limpia', function () {
  eq(Exp.fileName('Suma de dos números', 'png'), 'Suma-de-dos-numeros.png');
  eq(Exp.fileName('', 'pdf'), 'diagrama.pdf');
  eq(Exp.fileName('a/b\\c:d*e?', 'svg'), 'abcde.svg');
  eq(Exp.fileName('   ', 'json'), 'diagrama.json');
});

/* ---------------- resultado ---------------- */
console.log('');
if (failures.length) {
  console.log('  ' + passed + ' pruebas OK, ' + failures.length + ' fallaron:');
  failures.forEach(function (f) { console.log('   x ' + f); });
  process.exit(1);
} else {
  console.log('  ' + passed + ' pruebas OK');
}
