/* Pruebas del traductor a Python (pycode.js) con Node puro:
     node tests/pycode.test.js

   La prueba fuerte no mira el texto: ejecuta el Python generado con
   python y compara su salida con la del interprete del diagrama.      */
'use strict';

require('../js/expr.js');
require('../js/flow.js');
require('../js/examples.js');
require('../js/pycode.js');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const Flow = globalThis.Flow;
const Examples = globalThis.FlowExamples;
const Py = globalThis.FlowPy;

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(name + '\n      ' + (err && err.message ? err.message : String(err)));
  }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((what ? what + ': ' : '') + 'esperaba ' + b + ' y obtuve ' + a);
}
function ok(condition, what) {
  if (!condition) throw new Error(what || 'esperaba que fuera cierto');
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpy-'));

/* ---------------- utilidades ---------------- */
function gen(graph, opts) {
  const res = Py.generate(graph, opts || { prompts: false });
  if (!res.ok) throw new Error('no se pudo traducir: ' + res.problem.message);
  return res;
}

/** Traduce  r = <expresión>  y devuelve solo el lado derecho */
function pyExpr(src) {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p = Flow.addNode(g, 'process', 0, 100, 'r = ' + src);
  const f = Flow.addNode(g, 'end', 0, 200);
  Flow.connect(g, s.id, 'out', p.id);
  Flow.connect(g, p.id, 'out', f.id);
  const res = gen(g);
  const line = res.lines.filter(function (l) { return /^r = /.test(l.text); })[0];
  if (!line) throw new Error('no encontre la asignación en:\n' + res.code);
  return line.text.slice(4);
}

/** Traduce un bloque de Salida y devuelve la línea del print */
function pyPrint(src) {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const o = Flow.addNode(g, 'output', 0, 100, src);
  const f = Flow.addNode(g, 'end', 0, 200);
  Flow.connect(g, s.id, 'out', o.id);
  Flow.connect(g, o.id, 'out', f.id);
  const res = gen(g);
  const line = res.lines.filter(function (l) { return /^print\(/.test(l.text); })[0];
  if (!line) throw new Error('no encontre el print en:\n' + res.code);
  return line.text;
}

/** Corre el diagrama con el interprete propio y recoge lo que muestra */
function runInterpreter(graph, inputs) {
  const out = [];
  let i = 0;
  const rt = new Flow.Runtime({
    getGraph: function () { return graph; },
    hooks: {
      log: function (text, kind) { if (kind === 'out') out.push(text); },
      askInput: function () { rt.provideInput(i < inputs.length ? inputs[i++] : ''); }
    }
  });
  rt.trace = false;
  let guard = 0;
  do { rt.step(); } while (rt.isActive() && guard++ < 300000);
  if (rt.status !== 'finished') throw new Error('el interprete acabo en ' + rt.status);
  return out;
}

/** Corre el Python generado y recoge su salida */
function runPython(code, inputs, label) {
  const file = path.join(TMP, (label || 'prog') + '.py');
  fs.writeFileSync(file, code, 'utf8');
  try {
    const salida = execFileSync('python', [file], {
      input: inputs.join('\n') + '\n',
      encoding: 'utf8',
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
      timeout: 20000
    });
    return salida.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  } catch (err) {
    const detalle = (err.stderr || '').toString().trim().split('\n').slice(-4).join(' | ');
    throw new Error('python fallo: ' + detalle + '\n--- código ---\n' + code);
  }
}

/** Compara ignorando espacios repetidos y el 2.0 de Python frente al 2 del diagrama */
function normalize(lines) {
  return lines.map(function (l) {
    return String(l)
      .replace(/-?\d+\.\d+/g, function (m) { return String(Math.round(parseFloat(m) * 1e10) / 1e10); })
      .replace(/(\d)\.0+(?![0-9])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  });
}

function compara(graph, inputs, label) {
  const res = gen(graph);
  const mio = runInterpreter(graph, inputs);
  const suyo = runPython(res.code, inputs, label);
  eq(normalize(suyo), normalize(mio), 'la salida de Python no coincide con la del diagrama\n--- código ---\n' + res.code + '---');
  return res;
}

/* ---------------- expresiones ---------------- */
check('aritmética y paréntesis solo donde hacen falta', function () {
  eq(pyExpr('2 + 3 * 4'), '2 + 3 * 4');
  eq(pyExpr('(2 + 3) * 4'), '(2 + 3) * 4');
  eq(pyExpr('a * (b + c)'), 'a * (b + c)');
  eq(pyExpr('a - (b - c)'), 'a - (b - c)');
  eq(pyExpr('a - b - c'), 'a - b - c');
  eq(pyExpr('a / (b * c)'), 'a / (b * c)');
  eq(pyExpr('10 / 4'), '10 / 4');
});

check('mod y div se traducen a % y //', function () {
  eq(pyExpr('7 mod 3'), '7 % 3');
  eq(pyExpr('7 div 2'), '7 // 2');
  eq(pyExpr('7 % 3'), '7 % 3');
});

check('la potencia usa ** y liga igual que en el diagrama', function () {
  eq(pyExpr('2 ^ 10'), '2 ** 10');
  eq(pyExpr('-2 ^ 2'), '-2 ** 2', 'en Python tambien da -4');
  eq(pyExpr('2 ^ 3 ^ 2'), '2 ** 3 ** 2', 'asociativa a derecha en los dos');
  eq(pyExpr('(a + b) ^ 2'), '(a + b) ** 2');
  eq(pyExpr('pot(2, 8)'), '2 ** 8');
});

check('y / o / no pasan a and / or / not', function () {
  eq(pyExpr('a y b'), 'a and b');
  eq(pyExpr('a o b'), 'a or b');
  eq(pyExpr('a y b o c'), 'a and b or c');
  eq(pyExpr('a o (b y c)'), 'a or b and c');
  eq(pyExpr('no a'), 'not a');
  eq(pyExpr('no (a y b)'), 'not (a and b)');
});

check('comparaciones', function () {
  eq(pyExpr('a == b'), 'a == b');
  eq(pyExpr('a <> b'), 'a != b');
  eq(pyExpr('a >= b y a >= c'), 'a >= b and a >= c');
  eq(pyExpr('(a < b) == verdadero'), '(a < b) == True', 'sin encadenar comparaciones');
});

check('valores logicos y pi', function () {
  eq(pyExpr('verdadero'), 'True');
  eq(pyExpr('falso'), 'False');
  eq(pyExpr('pi'), '3.141592653589793');
});

check('funciones matematicas', function () {
  eq(pyExpr('raiz(16)'), 'math.sqrt(16)');
  eq(pyExpr('abs(-3)'), 'abs(-3)');
  eq(pyExpr('redondear(x, 2)'), 'round(x, 2)');
  eq(pyExpr('truncar(x)'), 'math.trunc(x)');
  eq(pyExpr('piso(x)'), 'math.floor(x)');
  eq(pyExpr('techo(x)'), 'math.ceil(x)');
  eq(pyExpr('ln(x)'), 'math.log(x)');
  eq(pyExpr('log(x)'), 'math.log10(x)');
  eq(pyExpr('sen(x)'), 'math.sin(x)');
  eq(pyExpr('min(a, b)'), 'min(a, b)');
  eq(pyExpr('max(a, b, c)'), 'max(a, b, c)');
  eq(pyExpr('aleatorio(1, 6)'), 'random.randint(1, 6)');
  eq(pyExpr('aleatorio(6)'), 'random.randint(1, 6)');
  eq(pyExpr('aleatorio()'), 'random.random()');
});

check('funciones de texto', function () {
  eq(pyExpr('longitud("hola")'), 'len("hola")');
  eq(pyExpr('longitud(nombre)'), 'len(texto(nombre))');
  eq(pyExpr('mayusculas("hola")'), '"hola".upper()');
  eq(pyExpr('minusculas(nombre)'), 'texto(nombre).lower()');
  eq(pyExpr('subcadena("hola", 2, 3)'), '"hola"[1:3]', 'el diagrama cuenta desde 1');
  eq(pyExpr('subcadena(s, i, j)'), 'texto(s)[i - 1:j]');
  eq(pyExpr('concatenar("a", b)'), '"a" + texto(b)');
  eq(pyExpr('"Hola " + nombre'), '"Hola " + texto(nombre)',
    'nombre puede ser un número y Python no lo junta solo');
  eq(pyExpr('"n = " + 5'), '"n = " + texto(5)', 'en Python hay que convertir el número');
  eq(pyExpr('1 + 2'), '1 + 2', 'los números se suman normal');
  eq(pyExpr('cadena(3)'), 'texto(3)');
  eq(pyExpr('esnumero(dato)'), 'es_numero(dato)');
  eq(pyExpr('numero("5")'), 'numero("5")');
  eq(pyExpr('entero(2.7)'), 'int(2.7)', 'si ya es número basta int()');
  eq(pyExpr('entero(dato)'), 'entero(dato)', 'si puede ser texto usa el ayudante');
});

check('los textos se escapan bien', function () {
  eq(pyExpr('"dice \\"hola\\""'), '"dice \\"hola\\""');
  eq(pyExpr('"con \\n salto"'), '"con \\n salto"');
});

/* ---------------- print ---------------- */
check('print respeta los espacios del diagrama', function () {
  eq(pyPrint('"La suma es: ", suma'), 'print("La suma es:", suma)');
  eq(pyPrint('n, " x ", i, " = ", n * i'), 'print(n, "x", i, "=", n * i)');
  eq(pyPrint('a, b'), 'print(a, b)');
  eq(pyPrint('"Total:", x'), 'print("Total:", x)');
  eq(pyPrint('"solo texto"'), 'print("solo texto")');
  eq(pyPrint('"a", " ", "b"'), 'print("a", "b")');
  eq(pyPrint('"Total: ", x, " unidades"'), 'print("Total:", x, "unidades")');
});

check('cuando los espacios no cuadran usa sep=""', function () {
  eq(pyPrint('"a  ", b'), 'print("a  ", b, sep="")');
});

check('acepta la palabra escribir delante', function () {
  eq(pyPrint('escribir "hola"'), 'print("hola")');
});

/* ---------------- estructura ---------------- */
check('el programa mas simple sale plano y sin ayudantes', function () {
  const res = gen(Examples.get('suma'));
  ok(/^# Suma de dos números/.test(res.code), 'la primera línea es el título');
  ok(res.code.indexOf('def leer(') > 0, 'necesita el ayudante leer');
  ok(res.code.indexOf('import math') < 0, 'no importa math sin usarlo');
  ok(res.code.indexOf('def main') < 0, 'un solo Fin al final no necesita main()');
  ok(!/^return/m.test(res.code), 'ni return en el cuerpo del programa');
  ok(res.code.indexOf('suma = a + b') > 0, 'la asignación tal cual');
});

check('una decision da un if/else', function () {
  const code = gen(Examples.get('par')).code;
  ok(/if n % 2 == 0:/.test(code), 'la condición del rombo\n' + code);
  ok(/\nelse:/.test(code), 'y su rama No');
  ok(code.indexOf('pass') < 0, 'sin ramas vacías');
});

check('decisiones encadenadas dan elif', function () {
  const code = gen(Examples.get('mayor')).code;
  ok(/if a >= b and a >= c:/.test(code), 'la primera condición');
  ok(/\nelif b >= c:/.test(code), 'la segunda va como elif\n' + code);
  ok(/\nelse:/.test(code), 'y el ultimo caso');
  ok(code.indexOf('if b >= c') === code.lastIndexOf('if b >= c'), 'sin if anidado de mas');
});

check('la flecha que vuelve arriba da un while', function () {
  const code = gen(Examples.get('tabla')).code;
  ok(/while i <= 10:/.test(code), 'la decisión es la condición del while\n' + code);
  ok(code.indexOf('continue') < 0, 'sin continue de mas');
  ok(code.indexOf('break') < 0, 'ni break');
  const cuerpo = code.split('while i <= 10:')[1];
  ok(/\n {4}print\(/.test(cuerpo), 'el cuerpo va indentado');
  ok(/\n {4}i = i \+ 1/.test(cuerpo), 'el contador dentro del bucle');
});

check('el bucle con acumulador queda igual de limpio', function () {
  const code = gen(Examples.get('factorial')).code;
  ok(/while i <= n:/.test(code), 'condición del while\n' + code);
  ok(/\nprint\(/.test(code), 'el resultado se muestra fuera del bucle');
});

check('entrada dentro del bucle', function () {
  const code = gen(Examples.get('promedio')).code;
  ok(/while contador < cantidad:/.test(code), 'condición\n' + code);
  ok(/\n {4}nota = leer\(/.test(code), 'la lectura va dentro');
  ok(/\npromedio = suma \/ cantidad/.test(code), 'la media fuera');
});

check('repetir-hasta se convierte en while True con break', function () {
  const code = gen(Examples.get('adivina')).code;
  ok(/while True:/.test(code), 'el bucle empieza por el cuerpo\n' + code);
  ok(/\n {8}break/.test(code), 'y sale con break');
  ok(/\n {4}if intento < secreto:/.test(code), 'la segunda decisión no queda anidada\n' + code);
  ok(code.indexOf('continue') < 0, 'sin continue de mas\n' + code);
});

check('varias variables en un bloque de Entrada', function () {
  const code = gen(Examples.get('mayor')).code;
  ok(/a = leer\(\)\nb = leer\(\)\nc = leer\(\)/.test(code), 'una línea por variable\n' + code);
});

check('con prompts pide el dato por su nombre', function () {
  const res = Py.generate(Examples.get('suma'), {});
  ok(res.ok, 'se traduce');
  ok(res.code.indexOf('a = leer("a = ")') > 0, 'el mensaje lleva el nombre\n' + res.code);
});

check('los ayudantes solo aparecen si se usan', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p = Flow.addNode(g, 'process', 0, 100, 'x = 2 + 2');
  const o = Flow.addNode(g, 'output', 0, 200, 'x');
  const f = Flow.addNode(g, 'end', 0, 300);
  Flow.connect(g, s.id, 'out', p.id);
  Flow.connect(g, p.id, 'out', o.id);
  Flow.connect(g, o.id, 'out', f.id);
  const code = gen(g).code;
  ok(code.indexOf('def leer') < 0, 'sin Entrada no hace falta leer()');
  ok(code.indexOf('def texto') < 0, 'ni texto()');
  eq(code.split('\n').filter(function (l) { return /^import /.test(l); }), [], 'sin imports');
});

check('renombra las variables que en Python significan otra cosa', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p = Flow.addNode(g, 'process', 0, 100, 'print = 5; lambda = print + 1');
  const o = Flow.addNode(g, 'output', 0, 200, 'lambda');
  const f = Flow.addNode(g, 'end', 0, 300);
  Flow.connect(g, s.id, 'out', p.id);
  Flow.connect(g, p.id, 'out', o.id);
  Flow.connect(g, o.id, 'out', f.id);
  const res = gen(g);
  ok(/^print_ = 5$/m.test(res.code), 'print pasa a print_\n' + res.code);
  ok(/^lambda_ = print_ \+ 1$/m.test(res.code), 'y lambda a lambda_');
  ok(/^print\(lambda_\)$/m.test(res.code), 'el print de verdad sigue funcionando');
  ok(res.notes.some(function (n) { return /nombre/.test(n); }), 'lo avisa en las notas');
});

check('un Fin a media altura obliga a usar main()', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const i = Flow.addNode(g, 'input', 0, 100, 'n');
  const d = Flow.addNode(g, 'decision', 0, 200, 'n < 0');
  const o1 = Flow.addNode(g, 'output', 0, 320, '"No vale"');
  const f1 = Flow.addNode(g, 'end', 0, 420);
  const o2 = Flow.addNode(g, 'output', 300, 320, '"Vale ", n');
  const f2 = Flow.addNode(g, 'end', 300, 420);
  Flow.connect(g, s.id, 'out', i.id);
  Flow.connect(g, i.id, 'out', d.id);
  Flow.connect(g, d.id, 'true', o1.id);
  Flow.connect(g, o1.id, 'out', f1.id);
  Flow.connect(g, d.id, 'false', o2.id);
  Flow.connect(g, o2.id, 'out', f2.id);
  const code = gen(g).code;
  ok(/^def main\(\):$/m.test(code), 'hace falta main() para poder usar return\n' + code);
  ok(/^main\(\)$/m.test(code), 'y la llamada al final');
  ok(/ {8}return/.test(code), 'el Fin de la rama es un return');
});

check('las notas avisan de mod, redondear y los decimales', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p = Flow.addNode(g, 'process', 0, 100, 'a = -7 mod 3; b = -7 div 2; c = redondear(2.5); d = 4 / 2');
  const f = Flow.addNode(g, 'end', 0, 200);
  Flow.connect(g, s.id, 'out', p.id);
  Flow.connect(g, p.id, 'out', f.id);
  const notes = gen(g).notes.join(' | ');
  ok(/mod/.test(notes), 'avisa de mod');
  ok(/div/.test(notes), 'avisa de div');
  ok(/round/.test(notes), 'avisa de redondear');
  ok(/2\.0/.test(notes), 'avisa de los decimales');
});

check('con exactMod respeta el signo del diagrama', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p = Flow.addNode(g, 'process', 0, 100, 'a = x mod 3; b = x div 2');
  const f = Flow.addNode(g, 'end', 0, 200);
  Flow.connect(g, s.id, 'out', p.id);
  Flow.connect(g, p.id, 'out', f.id);
  const code = Py.generate(g, { prompts: false, exactMod: true }).code;
  ok(/a = math\.fmod\(x, 3\)/.test(code), 'mod con fmod\n' + code);
  ok(/b = int\(x \/ 2\)/.test(code), 'div truncando');
});

/* ---------------- diagramas que no se pueden traducir ---------------- */
check('sin Inicio lo dice en vez de inventar codigo', function () {
  const g = Flow.createGraph();
  Flow.addNode(g, 'process', 0, 100, 'x = 1');
  const res = Py.generate(g, { prompts: false });
  eq(res.ok, false);
  ok(/Inicio/.test(res.problem.message), 'nombra lo que falta');
  ok(/^#/.test(res.code), 'el codigo es un comentario explicando');
});

check('avisa del bloque al que le falta la flecha', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p = Flow.addNode(g, 'process', 0, 100, 'x = 1');
  Flow.connect(g, s.id, 'out', p.id);
  const res = Py.generate(g, { prompts: false });
  eq(res.ok, false);
  ok(/flecha de salida/.test(res.problem.message), res.problem.message);
  eq(res.problem.nodeId, p.id, 'senala el bloque');
});

check('avisa del bloque con la expresion mal escrita', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p = Flow.addNode(g, 'process', 0, 100, 'x = 2 +');
  const f = Flow.addNode(g, 'end', 0, 200);
  Flow.connect(g, s.id, 'out', p.id);
  Flow.connect(g, p.id, 'out', f.id);
  const res = Py.generate(g, { prompts: false });
  eq(res.ok, false);
  eq(res.problem.nodeId, p.id, 'senala el bloque del error');
});

check('un diagrama con flechas cruzadas dice cual lo rompe', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const d1 = Flow.addNode(g, 'decision', 0, 100, 'x > 0');
  const d2 = Flow.addNode(g, 'decision', 0, 300, 'x > 10');
  const a = Flow.addNode(g, 'process', 0, 500, 'a = 1');
  const b = Flow.addNode(g, 'process', 0, 620, 'b = 2');
  const f = Flow.addNode(g, 'end', 0, 740);
  Flow.connect(g, s.id, 'out', d1.id);
  Flow.connect(g, d1.id, 'true', d2.id);
  Flow.connect(g, d1.id, 'false', a.id);
  Flow.connect(g, d2.id, 'true', a.id);
  Flow.connect(g, d2.id, 'false', b.id);
  Flow.connect(g, a.id, 'out', b.id);
  Flow.connect(g, b.id, 'out', f.id);
  const res = Py.generate(g, { prompts: false });
  eq(res.ok, false);
  ok(/ya pasó/.test(res.problem.message), res.problem.message);
  ok(!!res.problem.nodeId, 'senala un bloque');
});

check('un bucle con dos salidas distintas se explica', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p0 = Flow.addNode(g, 'process', 0, 100, 'i = 1');
  const d1 = Flow.addNode(g, 'decision', 0, 200, 'i < 3');
  const d2 = Flow.addNode(g, 'decision', 0, 400, 'i == 2');
  const p1 = Flow.addNode(g, 'process', 0, 600, 'i = i + 1');
  const x = Flow.addNode(g, 'output', 300, 600, '"corte"');
  const y = Flow.addNode(g, 'output', 600, 600, '"normal"');
  const f = Flow.addNode(g, 'end', 300, 720);
  Flow.connect(g, s.id, 'out', p0.id);
  Flow.connect(g, p0.id, 'out', d1.id);
  Flow.connect(g, d1.id, 'true', d2.id);
  Flow.connect(g, d1.id, 'false', y.id);
  Flow.connect(g, d2.id, 'true', x.id);
  Flow.connect(g, d2.id, 'false', p1.id);
  Flow.connect(g, p1.id, 'out', d1.id);
  Flow.connect(g, x.id, 'out', f.id);
  Flow.connect(g, y.id, 'out', f.id);
  const res = Py.generate(g, { prompts: false });
  eq(res.ok, false);
  ok(/dos sitios distintos/.test(res.problem.message), res.problem.message);
});

/* ---------------- resaltar el bloque en curso ---------------- */
check('cada linea sabe de que bloque salio', function () {
  const graph = Examples.get('tabla');
  const res = gen(graph);
  const conBloque = res.lines.filter(function (l) { return l.node; });
  ok(conBloque.length >= 4, 'varias líneas apuntan a su bloque');
  graph.nodes.forEach(function (n) {
    if (n.type === 'start' || n.type === 'end') return;
    ok(Py.lineOf(res, n.id) > 0, 'el bloque ' + n.id + ' (' + n.type + ') tiene línea');
  });
  const linea = Py.lineOf(res, 'd1');
  eq(res.lines[linea - 1].text.trim(), 'while i <= 10:', 'la decisión apunta al while');
  eq(Py.lineOf(res, 'no-existe'), 0, 'un bloque que no esta da 0');
});

check('el nombre del archivo sale del titulo', function () {
  eq(Py.fileName('Tabla de multiplicar'), 'tabla_de_multiplicar.py');
  eq(Py.fileName('Promedio de várias notas'), 'promedio_de_varias_notas.py');
  eq(Py.fileName(''), 'diagrama.py');
});

/* ---------------- la prueba de verdad: correr el Python ---------------- */
const CASOS = [
  { key: 'suma', inputs: ['3', '4'] },
  { key: 'par', inputs: ['7'] },
  { key: 'par', inputs: ['8'], label: 'par2' },
  { key: 'mayor', inputs: ['3', '9', '5'] },
  { key: 'mayor', inputs: ['9', '3', '5'], label: 'mayor2' },
  { key: 'mayor', inputs: ['3', '5', '9'], label: 'mayor3' },
  { key: 'tabla', inputs: ['7'] },
  { key: 'factorial', inputs: ['5'] },
  { key: 'factorial', inputs: ['0'], label: 'factorial0' },
  { key: 'promedio', inputs: ['3', '4', '5', '6'] },
  { key: 'promedio', inputs: ['2', '3', '4'], label: 'promedio2' }
];

CASOS.forEach(function (caso) {
  const label = caso.label || caso.key;
  check('Python y el diagrama dan lo mismo: ' + label + ' (' + caso.inputs.join(', ') + ')', function () {
    compara(Examples.get(caso.key), caso.inputs, label);
  });
});

check('Python y el diagrama dan lo mismo: adivina (sin azar)', function () {
  const graph = Examples.get('adivina');
  graph.nodes.forEach(function (n) {
    if (n.text && n.text.indexOf('aleatorio') >= 0) n.text = 'secreto = 42; intentos = 0';
  });
  compara(graph, ['50', '25', '42'], 'adivina');
});

check('Python y el diagrama dan lo mismo: textos y funciones', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const i1 = Flow.addNode(g, 'input', 0, 100, 'nombre');
  const p1 = Flow.addNode(g, 'process', 0, 200,
    'largo = longitud(nombre); grito = mayusculas(nombre); inicial = subcadena(nombre, 1, 1)');
  const o1 = Flow.addNode(g, 'output', 0, 320, '"Hola ", grito, " tienes ", largo, " letras"');
  const o2 = Flow.addNode(g, 'output', 0, 420, 'concatenar("Empieza por ", inicial)');
  const o3 = Flow.addNode(g, 'output', 0, 520, '"raiz de 2 = ", redondear(raiz(2), 4)');
  const o4 = Flow.addNode(g, 'output', 0, 620, '"17 mod 5 = ", 17 mod 5, " y 17 div 5 = ", 17 div 5');
  const f = Flow.addNode(g, 'end', 0, 720);
  Flow.connect(g, s.id, 'out', i1.id);
  Flow.connect(g, i1.id, 'out', p1.id);
  Flow.connect(g, p1.id, 'out', o1.id);
  Flow.connect(g, o1.id, 'out', o2.id);
  Flow.connect(g, o2.id, 'out', o3.id);
  Flow.connect(g, o3.id, 'out', o4.id);
  Flow.connect(g, o4.id, 'out', f.id);
  compara(g, ['Ana'], 'textos');
});

check('Python y el diagrama dan lo mismo: bucle anidado', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p1 = Flow.addNode(g, 'process', 0, 100, 'i = 1');
  const d1 = Flow.addNode(g, 'decision', 0, 200, 'i <= 3');
  const p2 = Flow.addNode(g, 'process', 0, 400, 'j = 1');
  const d2 = Flow.addNode(g, 'decision', 0, 500, 'j <= i');
  const o1 = Flow.addNode(g, 'output', 0, 700, 'i, "-", j');
  const p3 = Flow.addNode(g, 'process', 0, 800, 'j = j + 1');
  const p4 = Flow.addNode(g, 'process', 400, 600, 'i = i + 1');
  const f = Flow.addNode(g, 'end', 700, 300);
  Flow.connect(g, s.id, 'out', p1.id);
  Flow.connect(g, p1.id, 'out', d1.id);
  Flow.connect(g, d1.id, 'true', p2.id);
  Flow.connect(g, d1.id, 'false', f.id);
  Flow.connect(g, p2.id, 'out', d2.id);
  Flow.connect(g, d2.id, 'true', o1.id);
  Flow.connect(g, d2.id, 'false', p4.id);
  Flow.connect(g, o1.id, 'out', p3.id);
  Flow.connect(g, p3.id, 'out', d2.id);
  Flow.connect(g, p4.id, 'out', d1.id);
  const res = compara(g, [], 'anidado');
  ok(/while i <= 3:/.test(res.code), 'el bucle de fuera\n' + res.code);
  ok(/ {4}while j <= i:/.test(res.code), 'y el de dentro, indentado');
});

check('Python y el diagrama dan lo mismo: condicion compuesta y logicos', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const i1 = Flow.addNode(g, 'input', 0, 100, 'edad, socio');
  const d1 = Flow.addNode(g, 'decision', 0, 220, 'edad >= 18 y (socio == verdadero o edad > 65)');
  const o1 = Flow.addNode(g, 'output', 0, 420, '"Entra"');
  const o2 = Flow.addNode(g, 'output', 400, 420, '"No entra"');
  const f = Flow.addNode(g, 'end', 200, 540);
  Flow.connect(g, s.id, 'out', i1.id);
  Flow.connect(g, i1.id, 'out', d1.id);
  Flow.connect(g, d1.id, 'true', o1.id);
  Flow.connect(g, d1.id, 'false', o2.id);
  Flow.connect(g, o1.id, 'out', f.id);
  Flow.connect(g, o2.id, 'out', f.id);
  compara(g, ['20', 'verdadero'], 'logicos1');
  compara(g, ['20', 'falso'], 'logicos2');
  compara(g, ['70', 'falso'], 'logicos3');
});

check('Python y el diagrama dan lo mismo: Fin en medio de una rama', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const i = Flow.addNode(g, 'input', 0, 100, 'n');
  const d = Flow.addNode(g, 'decision', 0, 200, 'n < 0');
  const o1 = Flow.addNode(g, 'output', 0, 400, '"No acepto negativos"');
  const f1 = Flow.addNode(g, 'end', 0, 500);
  const o2 = Flow.addNode(g, 'output', 400, 400, '"La raíz es ", redondear(raiz(n), 3)');
  const f2 = Flow.addNode(g, 'end', 400, 500);
  Flow.connect(g, s.id, 'out', i.id);
  Flow.connect(g, i.id, 'out', d.id);
  Flow.connect(g, d.id, 'true', o1.id);
  Flow.connect(g, o1.id, 'out', f1.id);
  Flow.connect(g, d.id, 'false', o2.id);
  Flow.connect(g, o2.id, 'out', f2.id);
  compara(g, ['-5'], 'negativo');
  compara(g, ['9'], 'positivo');
});

/* ---------------- resultado ---------------- */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* da igual */ }

console.log('');
if (failures.length) {
  console.log('  ' + passed + ' pruebas OK, ' + failures.length + ' fallaron:');
  failures.forEach(function (f) { console.log('   x ' + f); });
  process.exit(1);
} else {
  console.log('  ' + passed + ' pruebas OK');
}
