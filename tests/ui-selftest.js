/* ------------------------------------------------------------------
   Pruebas de la interfaz dentro del navegador.
   Se cargan solo con  index.html?selftest=1
   Los resultados quedan en #selftest-out y en document.title.
------------------------------------------------------------------ */
(function () {
  'use strict';

  const app = window.__app;
  const Flow = window.Flow;
  const results = [];
  let passed = 0;

  const out = document.createElement('pre');
  out.id = 'selftest-out';
  out.style.cssText = 'position:fixed;left:0;bottom:0;z-index:9999;max-height:40vh;overflow:auto;' +
    'background:#000;color:#0f0;font:11px monospace;padding:6px;margin:0;width:100%';
  document.body.appendChild(out);

  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); };

  function eq(actual, expected, what) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error((what || '') + ' esperaba ' + b + ' y obtuve ' + a);
  }
  function ok(cond, what) {
    if (!cond) throw new Error(what || 'esperaba algo verdadero');
  }

  // en pantalla estrecha no caben dos bloques a la vez: esas pruebas se saltan
  const NARROW = window.innerWidth < 700;

  async function checkWide(name, fn) {
    if (NARROW) {
      results.push('SALTA ' + name + ' (pantalla estrecha)');
      passed++;
      out.textContent = results.join('\n');
      return;
    }
    return check(name, fn);
  }

  async function check(name, fn) {
    try {
      await fn();
      passed++;
      results.push('OK   ' + name);
    } catch (err) {
      results.push('FALLA ' + name + '\n        ' + (err && err.message ? err.message : String(err)));
    }
    out.textContent = results.join('\n');
  }

  /* ---------- ayudas de ratón / dedo ---------- */
  function fire(target, type, x, y, extra) {
    const init = Object.assign({
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 1, isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'mouse'
    }, extra || {});
    target.dispatchEvent(new PointerEvent(type, init));
  }
  function nodeEl(id) { return document.querySelector('.node[data-id="' + id + '"]'); }
  function boxOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r };
  }
  async function dragNode(id, dx, dy) {
    const el = nodeEl(id);
    const p = boxOf(el);
    fire(el, 'pointerdown', p.x, p.y);
    await frame();
    fire(window, 'pointermove', p.x + dx / 2, p.y + dy / 2);
    fire(window, 'pointermove', p.x + dx, p.y + dy);
    await frame();
    fire(window, 'pointerup', p.x + dx, p.y + dy);
    await frame();
  }
  async function connectNodes(fromId, port, toId) {
    const anchor = nodeEl(fromId).querySelector('.anchor[data-port="' + port + '"]');
    const a = boxOf(anchor);
    const target = boxOf(nodeEl(toId));
    fire(anchor, 'pointerdown', a.x, a.y);
    await frame();
    fire(window, 'pointermove', target.x, target.y);
    await frame();
    fire(window, 'pointerup', target.x, target.y);
    await frame();
  }
  function doubleClick(el) {
    const p = boxOf(el);
    fire(el, 'pointerdown', p.x, p.y);
    fire(window, 'pointerup', p.x, p.y);
    fire(el, 'pointerdown', p.x, p.y);
    fire(window, 'pointerup', p.x, p.y);
    el.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, clientX: p.x, clientY: p.y
    }));
  }
  function key(el, k, extra) {
    el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({
      key: k, bubbles: true, cancelable: true
    }, extra || {})));
  }

  /** Contesta a la ventanita de "escribe el valor" si esta abierta. */
  function answer(value) {
    const field = document.getElementById('askField');
    if (!field) return false;
    field.value = String(value);
    key(field, 'Enter');
    return true;
  }

  /** Da pasos hasta que termine, contestando lo que le vayan pidiendo. */
  async function stepUntilDone(answers, limit) {
    const queue = (answers || []).slice();
    const max = limit || 400;
    let guard = 0;
    do {
      if (document.getElementById('askField')) {
        answer(queue.length ? queue.shift() : 0);
      } else {
        app.doStep();
      }
      guard++;
      if (guard % 25 === 0) await frame();
    } while (guard < max && app.runtime.status !== 'finished' && app.runtime.status !== 'error');
    await frame();
  }

  function freshGraph() {
    const g = Flow.createGraph();
    app.loadGraph(g);
  }

  /* ---------- dialogos ----------
     prompt() y confirm() bloquean el navegador cuando no hay nadie delante,
     asi que se sustituyen y cada prueba decide que se contesta.            */
  let promptAnswer = null;        // null = se acepta el valor que propone
  let confirmAnswer = true;
  const asked = { prompt: [], confirm: [] };

  function stubDialogs() {
    window.prompt = function (message, suggested) {
      asked.prompt.push(String(message));
      return promptAnswer === null ? (suggested === undefined ? '' : suggested) : promptAnswer;
    };
    window.confirm = function (message) {
      asked.confirm.push(String(message));
      return confirmAnswer;
    };
    window.alert = function (message) { asked.prompt.push('alert: ' + message); };
  }

  /* ---------- las pruebas ---------- */
  async function run() {
    stubDialogs();
    await frame();

    await check('la página arranca con el ejemplo y sin errores', async function () {
      ok(app.getGraph().nodes.length > 0, 'debería haber bloques');
      eq(app.problems().errors.length, 0, 'el ejemplo inicial no debería tener errores:');
      ok(document.querySelectorAll('.node').length === app.getGraph().nodes.length, 'faltan bloques dibujados');
      ok(document.querySelectorAll('.edges path.wire').length === app.getGraph().edges.length, 'faltan flechas dibujadas');
    });

    await check('cada bloque dibuja su contorno con medidas reales', async function () {
      app.getGraph().nodes.forEach(function (n) {
        const el = nodeEl(n.id);
        const d = el.querySelector('.shape .body').getAttribute('d');
        ok(d && d.length > 10, 'sin contorno en ' + n.type);
        ok(!/NaN/.test(d), 'contorno con NaN en ' + n.type);
        ok(n.h >= Flow.typeInfo(n.type).minH, 'altura no medida en ' + n.type);
      });
    });

    await check('pulsar en la paleta crea un bloque', async function () {
      const before = app.getGraph().nodes.length;
      document.querySelector('.pal-item[data-type="process"]').click();
      await frame();
      eq(app.getGraph().nodes.length, before + 1, 'debería haber un bloque más');
      app.closeEditor(true);
    });

    await checkWide('arrastrar desde la paleta suelta el bloque donde toca', async function () {
      freshGraph();
      await frame();
      const item = document.querySelector('.pal-item[data-type="output"]');
      const from = boxOf(item);
      const wrap = document.getElementById('canvasWrap').getBoundingClientRect();
      const dropX = Math.round(wrap.left + 260);
      const dropY = Math.round(wrap.top + 200);

      fire(item, 'pointerdown', from.x, from.y);
      fire(window, 'pointermove', from.x + 20, from.y + 10);   // pasa el umbral
      await frame();
      ok(document.querySelector('.drag-ghost'), 'deberia verse el bloque fantasma');
      fire(window, 'pointermove', dropX, dropY);
      await frame();
      fire(window, 'pointerup', dropX, dropY);
      await frame();
      app.closeEditor(true);
      await frame();

      ok(!document.querySelector('.drag-ghost'), 'el fantasma deberia desaparecer');
      eq(app.getGraph().nodes.length, 1, 'deberia haber un bloque:');
      const node = app.getGraph().nodes[0];
      eq(node.type, 'output', 'del tipo que se arrastro:');
      const dropped = app.toCanvas(dropX, dropY);
      ok(Math.abs(node.x + node.w / 2 - dropped.x) <= 14 &&
        Math.abs(node.y + node.h / 2 - dropped.y) <= 40,
        'cayo en ' + node.x + ',' + node.y + ' y se solto en ' +
        Math.round(dropped.x) + ',' + Math.round(dropped.y));
    });

    await check('un toque corto en la paleta no arrastra nada', async function () {
      freshGraph();
      await frame();
      const item = document.querySelector('.pal-item[data-type="process"]');
      const p = boxOf(item);
      fire(item, 'pointerdown', p.x, p.y);
      fire(window, 'pointermove', p.x + 1, p.y + 1);
      fire(window, 'pointerup', p.x + 1, p.y + 1);
      await frame();
      ok(!document.querySelector('.drag-ghost'), 'no deberia haber fantasma');
      eq(app.getGraph().nodes.length, 0, 'sin arrastre y sin click no se anade nada:');
    });

    await check('doble clic edita el texto y se guarda con Enter', async function () {
      freshGraph();
      const node = app.addNodeAt('process', 120, 120, false);
      app.closeEditor(true);
      await frame();

      doubleClick(nodeEl(node.id));
      await frame();
      const area = document.querySelector('.node-editor');
      ok(area, 'no se abrio el editor con el doble clic');
      ok(document.body.contains(area), 'el editor no está en la página');
      area.value = 'total = 7 * 6';
      key(area, 'Enter');
      await frame();
      eq(Flow.findNode(app.getGraph(), node.id).text, 'total = 7 * 6', 'el texto no se guardo:');
      eq(nodeEl(node.id).querySelector('.text').textContent, 'total = 7 * 6', 'el bloque no muestra el texto nuevo:');
      ok(!document.querySelector('.node-editor'), 'el editor debería cerrarse');
    });

    await check('Escape cancela la edicion', async function () {
      const node = app.getGraph().nodes[0];
      const before = node.text;
      doubleClick(nodeEl(node.id));
      await frame();
      const area = document.querySelector('.node-editor');
      area.value = 'esto no se guarda';
      key(area, 'Escape');
      await frame();
      eq(Flow.findNode(app.getGraph(), node.id).text, before, 'no debería haber cambiado:');
    });

    await checkWide('un bloque se puede arrastrar y las flechas lo siguen', async function () {
      freshGraph();
      const a = app.addNodeAt('process', 120, 100, false);
      app.closeEditor(true);
      const b = app.addNodeAt('process', 120, 320, false);
      app.closeEditor(true);
      await frame();
      await connectNodes(a.id, 'out', b.id);
      eq(app.getGraph().edges.length, 1, 'no se creo la flecha:');

      const before = { x: a.x, y: a.y };
      const wireBefore = document.querySelector('.edges path.wire').getAttribute('d');
      await dragNode(a.id, 60, 0);
      const after = Flow.findNode(app.getGraph(), a.id);
      ok(Math.abs((after.x - before.x) - 60) <= 10, 'se movio ' + (after.x - before.x) + 'px en vez de 60');
      eq(after.y, before.y, 'no debería cambiar la altura:');
      const wireAfter = document.querySelector('.edges path.wire').getAttribute('d');
      ok(wireBefore !== wireAfter, 'la flecha debería haberse redibujado');
      eq(nodeEl(a.id).style.left, after.x + 'px', 'el bloque dibujado no coincide con el modelo:');
    });

    await checkWide('arrastrar con zoom distinto mueve la distancia correcta', async function () {
      app.setZoom(0.6);
      await frame();
      const node = app.getGraph().nodes[0];
      const before = node.x;
      await dragNode(node.id, 60, 0);      // 60 px de pantalla = 100 px de lienzo
      const moved = Flow.findNode(app.getGraph(), node.id).x - before;
      ok(Math.abs(moved - 100) <= 12, 'se movio ' + moved + ' px de lienzo, esperaba ~100');
      app.setZoom(1);
      await frame();
    });

    await checkWide('una salida solo admite una flecha', async function () {
      freshGraph();
      const a = app.addNodeAt('process', 100, 80, false); app.closeEditor(true);
      const b = app.addNodeAt('process', 100, 300, false); app.closeEditor(true);
      const c = app.addNodeAt('process', 400, 300, false); app.closeEditor(true);
      await frame();
      await connectNodes(a.id, 'out', b.id);
      await connectNodes(a.id, 'out', c.id);
      eq(app.getGraph().edges.length, 1, 'debería quedar solo la última:');
      eq(app.getGraph().edges[0].to, c.id);
    });

    await checkWide('no se puede conectar un bloque consigo mismo', async function () {
      const a = app.getGraph().nodes[0];
      const antes = app.getGraph().edges.length;
      await connectNodes(a.id, 'out', a.id);
      eq(app.getGraph().edges.length, antes, 'no debería crear la flecha:');
    });

    await check('la decision tiene rama Sí y rama No', async function () {
      freshGraph();
      const d = app.addNodeAt('decision', 200, 100, false); app.closeEditor(true);
      await frame();
      const el = nodeEl(d.id);
      ok(el.querySelector('.anchor[data-port="true"]'), 'falta el punto de la rama Sí');
      ok(el.querySelector('.anchor[data-port="false"]'), 'falta el punto de la rama No');
      const tags = Array.prototype.map.call(el.querySelectorAll('.port-tag'), function (t) { return t.textContent; });
      eq(tags.sort(), ['No', 'Sí']);
    });

    await checkWide('borrar con Suprimir y recuperar con deshacer', async function () {
      freshGraph();
      const a = app.addNodeAt('process', 100, 100, false); app.closeEditor(true);
      const b = app.addNodeAt('process', 100, 300, false); app.closeEditor(true);
      await frame();
      await connectNodes(a.id, 'out', b.id);
      app.select(b.id, null);
      key(document.body, 'Delete');
      await frame();
      eq(app.getGraph().nodes.length, 1, 'debería quedar un bloque:');
      eq(app.getGraph().edges.length, 0, 'la flecha debería irse con el bloque:');
      app.undo();
      await frame();
      eq(app.getGraph().nodes.length, 2, 'deshacer debería devolver el bloque:');
      eq(app.getGraph().edges.length, 1, 'y también la flecha:');
      eq(document.querySelectorAll('.node').length, 2, 'el dibujo no se actualizo:');
    });

    await check('el botón × del bloque lo borra', async function () {
      const nodes = app.getGraph().nodes;
      const target = nodes[nodes.length - 1];
      const del = nodeEl(target.id).querySelector('.node-del');
      const p = boxOf(del);
      fire(del, 'pointerdown', p.x, p.y);
      await frame();
      ok(!Flow.findNode(app.getGraph(), target.id), 'el bloque debería haberse borrado');
    });

    await checkWide('clic en una flecha la selecciona y se borra con Suprimir', async function () {
      freshGraph();
      const a = app.addNodeAt('process', 120, 100, false); app.closeEditor(true);
      const b = app.addNodeAt('process', 120, 320, false); app.closeEditor(true);
      await frame();
      await connectNodes(a.id, 'out', b.id);
      const hit = document.querySelector('.edges path.hit');
      const p = boxOf(hit);
      fire(hit, 'pointerdown', p.x, p.y);
      await frame();
      ok(document.querySelector('.edges path.wire.is-selected'), 'la flecha debería quedar marcada');
      key(document.body, 'Delete');
      await frame();
      eq(app.getGraph().edges.length, 0, 'la flecha debería borrarse:');
    });

    await checkWide('las flechas se pueden pinchar de verdad (nada las tapa)', async function () {
      freshGraph();
      const a = app.addNodeAt('process', 140, 100, false); app.closeEditor(true);
      const b = app.addNodeAt('process', 560, 420, false); app.closeEditor(true);
      await frame();
      await connectNodes(a.id, 'out', b.id);
      app.select(null, null);          // al conectar queda seleccionada
      await frame();
      const hit = document.querySelector('.edges path.hit');
      const box = hit.getBoundingClientRect();
      // punto sobre el tramo horizontal del medio del recorrido
      const el = document.elementFromPoint(
        Math.round(box.left + box.width / 2),
        Math.round(box.top + box.height / 2)
      );
      ok(el, 'no hay nada en ese punto');
      ok(el.classList.contains('hit'),
        'lo que hay bajo el cursor es ' + (el.getAttribute('class') || el.tagName) + ' en vez de la flecha');
      fire(el, 'pointerdown', box.left + box.width / 2, box.top + box.height / 2);
      await frame();
      ok(document.querySelector('.edges path.wire.is-selected'), 'no se selecciono la flecha');
      ok(document.querySelector('.edge-cut'), 'debería aparecer el botón de borrar la flecha');
    });

    await checkWide('el botón de borrar la flecha funciona', async function () {
      document.querySelector('.edge-cut').click();
      await frame();
      eq(app.getGraph().edges.length, 0, 'la flecha debería haberse borrado:');
    });

    await check('el lapiz del bloque abre el editor', async function () {
      freshGraph();
      const node = app.addNodeAt('process', 130, 120, false);
      app.closeEditor(true);
      await frame();
      const pencil = nodeEl(node.id).querySelector('.node-edit');
      ok(pencil, 'el bloque deberia tener boton de editar');
      const p = boxOf(pencil);
      fire(pencil, 'pointerdown', p.x, p.y);
      await frame();
      const area = document.querySelector('.node-editor');
      ok(area, 'no se abrio el editor');
      area.value = 'contador = contador + 1';
      key(area, 'Enter');
      await frame();
      eq(Flow.findNode(app.getGraph(), node.id).text, 'contador = contador + 1');
      ok(!nodeEl(node.id).querySelector('.node-edit') === false, 'sigue habiendo boton');
    });

    await check('los bloques Inicio y Fin no tienen lapiz', async function () {
      freshGraph();
      const s1 = app.addNodeAt('start', 120, 60, false);
      const f1 = app.addNodeAt('end', 120, 300, false);
      await frame();
      ok(!nodeEl(s1.id).querySelector('.node-edit'), 'Inicio no deberia tener lapiz');
      ok(!nodeEl(f1.id).querySelector('.node-edit'), 'Fin no deberia tener lapiz');
    });

    await check('un bloque mal escrito se marca en rojo', async function () {
      freshGraph();
      const p = app.addNodeAt('process', 120, 100, false);
      app.closeEditor(true);
      doubleClick(nodeEl(p.id));
      await frame();
      const area = document.querySelector('.node-editor');
      area.value = 'x +';
      key(area, 'Enter');
      await frame();
      ok(nodeEl(p.id).classList.contains('has-error'), 'debería tener la marca de error');
      const warn = nodeEl(p.id).querySelector('.node-warn');
      ok(!warn.hidden, 'debería verse el aviso');
      ok(warn.title.length > 5, 'el aviso debería explicar el problema');
    });

    /* ---------- ejecución ---------- */
    await check('ejecutar paso a paso: las variables se ven y se llenan', async function () {
      app.loadExample('suma');
      await frame();
      app.resetRun();
      await stepUntilDone([3, 4]);
      eq(app.runtime.status, 'finished', 'debería terminar:');
      eq(app.runtime.vars.suma, 7, 'suma mal calculada:');
      const rows = document.querySelectorAll('#varsBody .vars-table tr');
      eq(rows.length, 3, 'el panel debería mostrar 3 variables:');
      const shown = Array.prototype.map.call(rows, function (tr) {
        return tr.querySelector('.vname').textContent + '=' + tr.querySelector('.var-input').value;
      });
      eq(shown, ['a=3', 'b=4', 'suma=7'], 'el panel de variables no coincide:');
      const salida = app.logLines().filter(function (l) { return l.indexOf('out|') === 0; });
      eq(salida, ['out|La suma es: 7'], 'la consola no muestra la salida:');
    });

    await check('el bloque en curso se resalta y al final no queda ninguno', async function () {
      app.loadExample('suma');
      await frame();
      app.resetRun();
      app.doStep();
      await frame();
      eq(document.querySelectorAll('.node.is-current').length, 1, 'debería haber un bloque resaltado:');
      await stepUntilDone([1, 2]);
      eq(app.runtime.status, 'finished');
      eq(document.querySelectorAll('.node.is-current').length, 0, 'al terminar no debería quedar resaltado:');
    });

    await check('volver a ejecutar después de terminar arranca de cero', async function () {
      eq(app.runtime.status, 'finished', 'la prueba anterior debería dejarlo terminado:');
      await stepUntilDone([5, 5]);
      eq(app.runtime.status, 'finished', 'la segunda vuelta debería terminar:');
      eq(app.runtime.vars, { a: 5, b: 5, suma: 10 }, 'variables de la segunda vuelta:');
    });

    await check('un error se muestra, se corrige y se puede volver a ejecutar', async function () {
      app.loadExample('suma');
      await frame();
      app.resetRun();
      // rompe el bloque de proceso
      const proceso = app.getGraph().nodes.filter(function (n) { return n.type === 'process'; })[0];
      proceso.text = 'suma = a + noExiste';
      app.afterChange();
      await frame();

      await stepUntilDone([2, 2]);
      eq(app.runtime.status, 'error', 'debería quedarse en error:');
      const errores = app.logLines().filter(function (l) { return l.indexOf('err|') === 0; });
      eq(errores.length, 1, 'debería haber un solo error:');
      ok(/noExiste/.test(errores[0]), 'el error debería nombrar la variable: ' + errores[0]);
      eq(document.querySelector('.status-chip').dataset.status, 'error', 'la barra de estado no lo refleja:');
      ok(nodeEl(proceso.id).classList.contains('is-current'), 'el bloque del error debería resaltarse');

      // el usuario lo corrige y vuelve a ejecutar, sin reiniciar a mano
      proceso.text = 'suma = a + b';
      app.afterChange();
      await frame();
      await stepUntilDone([2, 3]);
      eq(app.runtime.status, 'finished', 'la ejecución corregida debería terminar:');
      eq(app.runtime.vars.suma, 5, 'suma tras corregir:');
    });

    await check('ejecutar seguido (botón Ejecutar) llega al final', async function () {
      app.loadExample('tabla');
      await frame();
      app.resetRun();
      document.getElementById('speed').value = '0';
      app.toggleRun();
      let guard = 0;
      while (app.runtime.isActive() && guard < 400) {
        if (document.getElementById('askField')) answer(3);
        await frame();
        guard++;
      }
      eq(app.runtime.status, 'finished', 'la tabla debería terminar sola:');
      const salidas = app.logLines().filter(function (l) { return l.indexOf('out|') === 0; });
      eq(salidas.length, 10, 'debería imprimir 10 líneas:');
      eq(salidas[9], 'out|3 x 10 = 30');
    });

    await check('pausar deja el programa a medias y se puede seguir', async function () {
      app.loadExample('tabla');
      await frame();
      app.resetRun();
      document.getElementById('speed').value = '600';
      await stepUntilDone([2], 6);            // unos pocos pasos
      app.toggleRun();                        // ejecutar
      await frame();
      eq(app.runtime.status, 'running', 'debería estar ejecutando:');
      app.toggleRun();                        // pausar
      await frame();
      eq(app.runtime.status, 'paused', 'debería quedar en pausa:');
      document.getElementById('speed').value = '0';
      app.toggleRun();
      let guard = 0;
      while (app.runtime.isActive() && guard < 400) {
        if (document.getElementById('askField')) answer(2);
        await frame();
        guard++;
      }
      eq(app.runtime.status, 'finished', 'al reanudar debería terminar:');
    });

    await check('cancelar el dato pedido no rompe nada', async function () {
      app.loadExample('suma');
      await frame();
      app.resetRun();
      app.doStep();
      app.doStep();
      await frame();
      const field = document.getElementById('askField');
      ok(field, 'debería estar pidiendo el primer dato');
      key(field, 'Escape');
      await frame();
      eq(app.runtime.status, 'paused', 'tras cancelar debería quedar a medias:');
      ok(!document.getElementById('askField'), 'la ventanita debería cerrarse');
      await stepUntilDone([8, 9]);
      eq(app.runtime.status, 'finished', 'debería poder seguir:');
      eq(app.runtime.vars.suma, 17);
    });

    await check('cambiar una variable a mano en el panel', async function () {
      app.loadExample('suma');
      await frame();
      app.resetRun();
      await stepUntilDone([1, 1]);
      const input = document.querySelectorAll('#varsBody .vars-table tr')[0].querySelector('.var-input');
      input.focus();
      const focused = document.activeElement === input;
      input.value = '99';
      input.blur();
      input.dispatchEvent(new Event('blur'));   // el modo sin ventana no siempre da el foco
      await frame();
      eq(app.runtime.vars.a, 99, 'la variable no se cambio (foco=' + focused + '):');
    });

    await check('añadir una variable nueva desde el panel', async function () {
      const nombre = document.querySelector('#varsBody .new-var .nv-name');
      const valor = document.querySelector('#varsBody .new-var .nv-value');
      nombre.value = 'edad';
      valor.value = '17';
      document.querySelector('#varsBody .new-var .mini-btn').click();
      await frame();
      eq(app.runtime.vars.edad, 17, 'no se creo la variable:');
    });

    await check('un nombre de variable inválido avisa y no se crea', async function () {
      const nombre = document.querySelector('#varsBody .new-var .nv-name');
      const valor = document.querySelector('#varsBody .new-var .nv-value');
      nombre.value = '2mal';
      valor.value = '1';
      document.querySelector('#varsBody .new-var .mini-btn').click();
      await frame();
      ok(!('2mal' in app.runtime.vars), 'no debería haberse creado');
      ok(!document.getElementById('toast').hidden, 'debería avisar');
    });

    await check('Reiniciar limpia variables, consola y resaltado', async function () {
      app.resetRun();
      await frame();
      eq(Object.keys(app.runtime.vars).length, 0, 'no deberían quedar variables:');
      eq(app.runtime.status, 'idle');
      eq(document.querySelectorAll('.node.is-current').length, 0);
      eq(app.logLines().length, 0, 'la consola debería quedar vacía:');
    });

    await check('sin bloque Inicio avisa en vez de romperse', async function () {
      freshGraph();
      const p = app.addNodeAt('process', 100, 100, false);
      app.closeEditor(true);
      await frame();
      app.doStep();
      await frame();
      eq(app.runtime.status, 'error');
      const errores = app.logLines().filter(function (l) { return l.indexOf('err|') === 0; });
      ok(/Inicio/.test(errores.join(' ')), 'debería hablar del bloque Inicio: ' + errores.join(' '));
      ok(!!p, 'el bloque sigue ahí');
    });

    await check('la lista de problemas se puede consultar', async function () {
      document.getElementById('problemsBtn').click();
      await frame();
      ok(app.logLines().length > 0, 'debería escribir los problemas en la consola');
    });

    await check('los ejemplos se cargan todos y quedan sin errores', async function () {
      const keys = window.FlowExamples.list.map(function (e) { return e.key; });
      for (const k of keys) {
        app.loadExample(k);
        await frame();
        eq(app.problems().errors.length, 0, 'el ejemplo ' + k + ' tiene errores:');
        eq(document.querySelectorAll('.node').length, app.getGraph().nodes.length, 'bloques dibujados en ' + k + ':');
        eq(document.querySelectorAll('.edges path.wire').length, app.getGraph().edges.length, 'flechas dibujadas en ' + k + ':');
      }
    });

    await check('reusar un id con otro tipo redibuja el bloque entero', async function () {
      app.loadGraph(Flow.deserialize({
        nodes: [{ id: 'x', type: 'process', x: 120, y: 100, text: 'a = 1' }],
        edges: []
      }));
      await frame();
      eq(nodeEl('x').dataset.type, 'process');
      app.loadGraph(Flow.deserialize({
        nodes: [{ id: 'x', type: 'decision', x: 120, y: 100, text: 'a > 1' }],
        edges: []
      }));
      await frame();
      const el = nodeEl('x');
      eq(el.dataset.type, 'decision', 'el bloque deberia ser ahora una decision:');
      eq(el.querySelectorAll('.anchor').length, 2, 'la decision tiene dos puntos de salida:');
      ok(el.querySelector('.anchor[data-port="false"]'), 'falta la rama No');
      eq(document.querySelectorAll('.node').length, 1, 'no deberia quedar el bloque viejo:');
    });

    await check('borrar el bloque que pide el dato cierra la ventanita', async function () {
      app.loadExample('suma');
      await frame();
      app.resetRun();
      app.doStep();
      app.doStep();
      await frame();
      ok(document.getElementById('askField'), 'deberia estar pidiendo un dato');
      const entrada = app.getGraph().nodes.filter(function (n) { return n.type === 'input'; })[0];
      app.select(entrada.id, null);
      key(document.body, 'Delete');
      await frame();
      await frame();
      ok(!document.getElementById('askField'), 'la ventanita deberia cerrarse');
      eq(app.runtime.status, 'paused', 'deberia quedar a medias, no roto:');
    });

    await check('guardar y volver a abrir deja el mismo diagrama', async function () {
      app.loadExample('promedio');
      await frame();
      const antes = JSON.stringify(Flow.serialize(app.getGraph()));
      app.loadGraph(Flow.deserialize(JSON.parse(antes)));
      await frame();
      const después = JSON.stringify(Flow.serialize(app.getGraph()));
      eq(después, antes, 'el diagrama cambio al abrirlo:');
    });

    await check('abrir un enlace no pisa el diagrama guardado de la biblioteca', async function () {
      app.store.useStorage(fakeStorage());
      app.loadExample('suma');
      await frame();
      document.getElementById('title').value = 'El mio';
      app.saveToLibrary(false);
      const mio = app.libraryId();
      ok(mio, 'deberia haber quedado guardado');

      // llega el diagrama de otra persona dentro de un enlace
      const ajeno = app.encodeGraph.call(null);      // el actual sirve de ejemplo
      app.loadExample('tabla');
      await frame();
      const codigo = app.encodeGraph();
      app.openFromCode(codigo);
      await frame();
      eq(app.libraryId(), null, 'no deberia seguir apuntando a tu entrada guardada:');
      eq(app.isDirty(), true, 'un diagrama recien llegado no esta guardado:');
      ok(ajeno.length > 10);

      // guardar ahora crea una entrada nueva, no machaca la tuya
      document.getElementById('title').value = 'Recibido';
      app.saveToLibrary(false);
      await frame();
      eq(app.store.list().length, 2, 'deberia haber dos entradas:');
      eq(app.store.titleOf(mio), 'El mio', 'la tuya deberia seguir intacta:');
      app.store.useStorage(window.localStorage);
    });

    await check('al tocar el diagrama, el enlace deja de mandar en la barra', async function () {
      app.loadExample('par');
      await frame();
      const codigo = app.encodeGraph();
      history.replaceState(null, '', '#d=' + codigo);
      eq(location.hash.indexOf('#d=') === 0, true, 'preparado con el enlace en la barra');

      app.getGraph().nodes[0].x += 10;
      app.afterChange();
      await frame();
      eq(location.hash.indexOf('#d='), -1,
        'el enlace deberia haberse quitado para no tapar tus cambios: ' + location.hash);
    });

    await check('el enlace aguanta tildes y textos raros', async function () {
      app.loadGraph(Flow.deserialize({
        title: 'Año 2026: ñandú & "comillas"',
        nodes: [
          { id: 's', type: 'start', x: 40, y: 40 },
          { id: 'o', type: 'output', x: 40, y: 170, text: '"¿Cuántos años?", edad' }
        ],
        edges: [{ from: 's', port: 'out', to: 'o' }]
      }));
      await frame();
      const codigo = app.encodeGraph();
      ok(/^[A-Za-z0-9_-]+$/.test(codigo), 'el codigo deberia ser seguro para una URL');
      const vuelta = Flow.deserialize(app.decodeGraph(codigo));
      eq(vuelta.title, 'Año 2026: ñandú & "comillas"', 'el titulo deberia volver igual:');
      eq(vuelta.nodes[1].text, '"¿Cuántos años?", edad', 'y el texto del bloque:');
    });

    await check('el enlace para compartir se puede volver a leer', async function () {
      app.loadExample('factorial');
      await frame();
      const code = app.encodeGraph();
      const copia = Flow.deserialize(app.decodeGraph(code));
      eq(copia.nodes.length, app.getGraph().nodes.length, 'bloques tras el enlace:');
      eq(copia.edges.length, app.getGraph().edges.length, 'flechas tras el enlace:');
    });

    await check('el menu de ejemplos carga un diagrama', async function () {
      freshGraph();
      await frame();
      document.getElementById('btnExamples').click();
      await frame();
      const menu = document.getElementById('menuExamples');
      ok(!menu.hidden, 'el menu deberia abrirse');
      ok(menu.querySelectorAll('button').length >= 5, 'deberia listar los ejemplos');
      menu.querySelectorAll('button')[3].click();   // el lienzo esta vacio: no pregunta
      await frame();
      ok(menu.hidden, 'el menu deberia cerrarse');
      ok(app.getGraph().nodes.length > 3, 'deberia haberse cargado un ejemplo');
      eq(app.problems().errors.length, 0, 'y sin errores:');
    });

    await check('la ayuda se abre y se cierra', async function () {
      const modal = document.getElementById('modalHelp');
      document.getElementById('btnHelp').click();
      await frame();
      ok(!modal.hidden, 'la ayuda deberia abrirse');
      ok(document.getElementById('helpFunctions').textContent.indexOf('redondear') >= 0,
        'deberia listar las funciones');
      modal.querySelector('[data-close]').click();
      await frame();
      ok(modal.hidden, 'la ayuda deberia cerrarse');
    });

    await check('quitar la traza deja la consola limpia de detalles', async function () {
      const trace = document.getElementById('trace');
      trace.checked = false;
      trace.dispatchEvent(new Event('change', { bubbles: true }));
      app.loadExample('suma');
      await frame();
      app.resetRun();
      await stepUntilDone([2, 3]);
      const lineas = app.logLines();
      eq(lineas.filter(function (l) { return l.indexOf('trace|') === 0; }).length, 0,
        'no deberia haber lineas de traza:');
      eq(lineas.filter(function (l) { return l.indexOf('out|') === 0; }).length, 1,
        'la salida si debe aparecer:');
      trace.checked = true;
      trace.dispatchEvent(new Event('change', { bubbles: true }));
    });

    /* ---------- biblioteca del navegador ---------- */
    // se usa un almacen de mentira para no tocar los diagramas de quien prueba
    function fakeStorage() {
      const data = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem: function (k, v) { data[k] = String(v); },
        removeItem: function (k) { delete data[k]; }
      };
    }

    await check('guardar deja el diagrama en la lista y se puede volver a abrir', async function () {
      app.store.useStorage(fakeStorage());
      app.loadExample('par');
      await frame();
      document.getElementById('title').value = 'Mi par o impar';
      app.saveToLibrary(false);
      await frame();

      const lista = app.store.list();
      eq(lista.length, 1, 'deberia haber un diagrama guardado:');
      eq(lista[0].title, 'Mi par o impar');
      eq(lista[0].nodes, app.getGraph().nodes.length);
      ok(app.libraryId(), 'deberia recordar en que entrada estamos');

      // se cambia a otra cosa y se vuelve
      app.loadExample('suma');
      await frame();
      ok(app.getGraph().nodes.length > 0);
      app.openFromLibrary(lista[0].id);
      await frame();
      eq(document.getElementById('title').value, 'Mi par o impar', 'deberia volver el titulo:');
      const condiciones = app.getGraph().nodes.filter(function (n) { return n.type === 'decision'; });
      eq(condiciones.length, 1, 'deberia ser el diagrama de par o impar:');
      eq(condiciones[0].text, 'n mod 2 == 0');
      eq(app.problems().errors.length, 0, 'y abrirse sin errores:');
    });

    await check('el boton Guardar avisa de los cambios sin guardar', async function () {
      const boton = document.getElementById('btnSave');
      eq(app.isDirty(), false, 'recien abierto no deberia haber cambios:');
      eq(boton.textContent.indexOf('\u2022') >= 0, false, 'sin punto:');

      const node = app.getGraph().nodes[0];
      node.x = node.x + 20;
      app.afterChange();
      await frame();
      eq(app.isDirty(), true, 'tras tocar algo deberia haber cambios:');
      ok(boton.textContent.indexOf('\u2022') >= 0, 'el boton deberia marcar el punto');

      app.saveToLibrary(false);
      await frame();
      eq(app.isDirty(), false, 'tras guardar ya no hay cambios:');
      eq(boton.textContent.indexOf('\u2022') >= 0, false, 'y se va el punto:');
      eq(app.store.list().length, 1, 'deberia seguir habiendo un solo diagrama:');
    });

    await check('el menu Mis diagramas lista, renombra, duplica y borra', async function () {
      app.store.useStorage(fakeStorage());
      app.loadExample('suma');
      await frame();
      document.getElementById('title').value = 'Uno';
      app.saveToLibrary(false);
      document.getElementById('title').value = 'Dos';
      promptAnswer = 'Dos';
      app.saveToLibrary(true);              // como copia nueva (pregunta el nombre)
      promptAnswer = null;
      await frame();
      eq(app.store.list().length, 2, 'deberia haber dos:');

      document.getElementById('btnLibrary').click();
      await frame();
      const menu = document.getElementById('menuLibrary');
      ok(!menu.hidden, 'el menu deberia abrirse');
      const filas = menu.querySelectorAll('.lib-row');
      eq(filas.length, 2, 'una fila por diagrama:');
      ok(menu.textContent.indexOf('Uno') >= 0 && menu.textContent.indexOf('Dos') >= 0,
        'deberian salir los dos nombres');
      ok(menu.querySelector('.lib-row.is-current'), 'deberia marcarse el que esta abierto');

      // renombrar
      promptAnswer = 'Renombrado';
      filas[0].querySelectorAll('.lib-btn')[0].click();
      await frame();
      promptAnswer = null;
      ok(app.store.list().some(function (i) { return i.title === 'Renombrado'; }), 'no se renombro');

      // duplicar
      const antes = app.store.list().length;
      document.querySelectorAll('#menuLibrary .lib-row')[0].querySelectorAll('.lib-btn')[1].click();
      await frame();
      eq(app.store.list().length, antes + 1, 'duplicar deberia anadir uno:');
      ok(app.store.list().some(function (i) { return /\(copia\)/.test(i.title); }), 'falta la copia');

      // borrar
      const total = app.store.list().length;
      confirmAnswer = true;
      document.querySelectorAll('#menuLibrary .lib-row')[0].querySelectorAll('.lib-btn')[2].click();
      await frame();
      eq(app.store.list().length, total - 1, 'borrar deberia quitar uno:');
      app.closeMenus();
    });

    await check('sin poder guardar, la app lo dice en vez de fallar', async function () {
      app.store.useStorage(null);
      app.buildLibraryMenu();
      await frame();
      const menu = document.getElementById('menuLibrary');
      ok(/no deja guardar/i.test(menu.textContent), 'deberia explicarlo: ' + menu.textContent.slice(0, 60));
      app.saveToLibrary(false);
      await frame();
      ok(!document.getElementById('toast').hidden, 'deberia avisar');
      app.store.useStorage(window.localStorage);   // se devuelve el de verdad
    });

    await check('abrir otro diagrama con cambios sin guardar pide confirmacion', async function () {
      app.store.useStorage(fakeStorage());
      app.loadExample('suma');
      await frame();
      document.getElementById('title').value = 'Guardado';
      app.saveToLibrary(false);
      const id = app.libraryId();

      app.loadExample('par');                 // otro diagrama, sin guardar
      app.getGraph().nodes[0].x += 30;
      app.afterChange();
      await frame();
      eq(app.isDirty(), true);

      const antes = asked.confirm.length;
      confirmAnswer = false;                  // el usuario dice que no
      app.openFromLibrary(id);
      await frame();
      ok(asked.confirm.length > antes, 'deberia haber preguntado');
      eq(document.getElementById('title').value, 'Par o impar', 'no deberia haber cambiado de diagrama:');

      confirmAnswer = true;                   // ahora si
      app.openFromLibrary(id);
      await frame();
      eq(document.getElementById('title').value, 'Guardado', 'ahora si deberia abrirlo:');
      app.store.useStorage(window.localStorage);
    });

    /* ---------- exportar ---------- */
    await check('el menu Archivo ofrece PNG, SVG, PDF, json y enlace', async function () {
      document.getElementById('btnFile').click();
      await frame();
      const menu = document.getElementById('menuFile');
      ok(!menu.hidden, 'deberia abrirse');
      const texto = menu.textContent;
      ['PNG', 'SVG', 'PDF', '.json', 'enlace'].forEach(function (palabra) {
        ok(texto.indexOf(palabra) >= 0, 'falta la opcion ' + palabra);
      });
      app.closeMenus();
      await frame();
      ok(menu.hidden, 'deberia cerrarse');
    });

    await check('el SVG exportado lo entiende el navegador', async function () {
      app.loadExample('promedio');
      await frame();
      const scene = app.currentScene();
      const svg = app.exporter.toSVG(scene);
      ok(svg.indexOf('<svg') >= 0);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      eq(doc.querySelectorAll('parsererror').length, 0, 'el svg deberia ser xml valido');
      eq(doc.documentElement.tagName, 'svg');
      const dibujos = doc.querySelectorAll('path').length;
      ok(dibujos >= app.getGraph().nodes.length + app.getGraph().edges.length,
        'faltan figuras en el svg: ' + dibujos);
      const textos = Array.prototype.map.call(doc.querySelectorAll('text'), function (t) {
        return t.textContent;
      }).join(' | ');
      ok(textos.indexOf('Promedio de varias notas') >= 0, 'deberia llevar el titulo');
      ok(textos.indexOf('cantidad') >= 0, 'deberia llevar el texto de los bloques');
    });

    await check('el SVG se puede rasterizar: la imagen sale con dibujo', async function () {
      const scene = app.currentScene();
      const svg = app.exporter.toSVG(scene);
      const image = await new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('el navegador no pudo cargar el svg')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
      ok(image.width > 100 && image.height > 100,
        'medidas raras: ' + image.width + 'x' + image.height);

      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let pintados = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) pintados++;
      }
      const total = canvas.width * canvas.height;
      ok(pintados > total * 0.01, 'la imagen sale casi vacia: ' + pintados + ' de ' + total);
      ok(pintados < total * 0.8, 'la imagen sale casi toda pintada: ' + pintados);
      ok(canvas.toDataURL('image/png').indexOf('data:image/png') === 0, 'no se pudo pasar a png');
    });

    await check('exportar a PNG termina bien', async function () {
      const hecho = await app.exportPNG(1);
      eq(hecho, true, 'deberia acabar la exportacion');
    });

    await check('el PDF exportado empieza por la cabecera correcta', async function () {
      const bytes = app.exporter.toPDF(app.currentScene());
      ok(bytes instanceof Uint8Array, 'deberian ser bytes');
      ok(bytes.length > 1000, 'demasiado pequeno: ' + bytes.length);
      const cabecera = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, 0, 8));
      eq(cabecera, '%PDF-1.4');
      const blob = new Blob([bytes], { type: 'application/pdf' });
      eq(blob.type, 'application/pdf');
      ok(blob.size === bytes.length, 'el blob deberia medir lo mismo');
    });

    await check('exportar con el lienzo vacio avisa y no descarga nada', async function () {
      freshGraph();
      await frame();
      app.exportSVG();
      await frame();
      ok(!document.getElementById('toast').hidden, 'deberia avisar');
      ok(/dibuja algo/i.test(document.getElementById('toast').textContent),
        'mensaje raro: ' + document.getElementById('toast').textContent);
    });

    await check('nada se sale de la pantalla a lo ancho', async function () {
      eq(document.documentElement.scrollWidth <= window.innerWidth + 1, true,
        'la página no debería tener scroll horizontal (' +
        document.documentElement.scrollWidth + ' > ' + window.innerWidth + ')');
    });

    await check('la barra de bloques y los paneles se ven en pantalla estrecha', async function () {
      const palette = document.querySelector('.palette').getBoundingClientRect();
      const vars = document.querySelector('.panel.vars').getBoundingClientRect();
      const consola = document.querySelector('.panel.console').getBoundingClientRect();
      ok(palette.width > 0 && palette.height > 0, 'la paleta deberia verse');
      ok(vars.width > 1 && vars.height > 1, 'el panel de variables deberia verse');
      ok(consola.width > 1 && consola.height > 1, 'la consola deberia verse');
      ok(vars.width <= window.innerWidth + 1, 'el panel de variables se sale: ' + Math.round(vars.width));
      ok(consola.width <= window.innerWidth + 1, 'la consola se sale: ' + Math.round(consola.width));
      const item = document.querySelector('.pal-item').getBoundingClientRect();
      ok(item.width >= 60, 'los bloques de la paleta quedan muy pequenos');
    });

    /* ---------- modo claro / oscuro ---------- */
    await check('el boton cambia entre modo oscuro y claro', async function () {
      app.setTheme('dark');
      await frame();
      eq(document.documentElement.dataset.theme, 'dark', 'deberia empezar en oscuro:');
      const fondoOscuro = getComputedStyle(document.querySelector('.topbar')).backgroundColor;

      document.getElementById('btnTheme').click();
      await frame();
      eq(document.documentElement.dataset.theme, 'light', 'el botón deberia pasar a claro:');
      const fondoClaro = getComputedStyle(document.querySelector('.topbar')).backgroundColor;
      ok(fondoClaro !== fondoOscuro, 'la barra deberia cambiar de color: ' + fondoClaro);

      document.getElementById('btnTheme').click();
      await frame();
      eq(document.documentElement.dataset.theme, 'dark', 'y volver a oscuro:');
      eq(getComputedStyle(document.querySelector('.topbar')).backgroundColor, fondoOscuro,
        'deberia volver al mismo color:');
    });

    await check('en modo claro el texto se sigue leyendo sobre el fondo', async function () {
      app.setTheme('light');
      await frame();
      const lee = function (sel, prop) {
        return getComputedStyle(document.querySelector(sel))[prop];
      };
      const claro = function (color) {
        const n = color.match(/\d+/g).map(Number);
        return (n[0] * 299 + n[1] * 587 + n[2] * 114) / 1000;   // brillo 0-255
      };
      const fondo = claro(lee('.topbar', 'backgroundColor'));
      const texto = claro(lee('.topbar', 'color'));
      ok(fondo > 180, 'en modo claro la barra deberia ser clara: ' + fondo.toFixed(0));
      ok(fondo - texto > 100, 'el texto deberia contrastar con la barra');
      const lienzo = claro(lee('.canvas-wrap', 'backgroundColor'));
      ok(lienzo > 180, 'el lienzo tambien deberia ser claro: ' + lienzo.toFixed(0));
      app.setTheme('dark');
      await frame();
    });

    await check('el tema elegido queda guardado en las preferencias', async function () {
      app.setTheme('light');
      await frame();
      const prefs = JSON.parse(localStorage.getItem('diagramador.preferencias.v1') || '{}');
      eq(prefs.theme, 'light', 'deberia guardar el tema:');
      eq(app.theme(), 'light');
      app.setTheme('dark');
      await frame();
      eq(JSON.parse(localStorage.getItem('diagramador.preferencias.v1')).theme, 'dark');
    });

    await check('en modo claro nada se sale de la pantalla', async function () {
      app.setTheme('light');
      app.loadExample('tabla');
      app.togglePython(true);
      await frame();
      eq(document.documentElement.scrollWidth <= window.innerWidth + 1, true,
        'no deberia haber scroll horizontal (' +
        document.documentElement.scrollWidth + ' > ' + window.innerWidth + ')');
      app.togglePython(false);
      app.setTheme('dark');
      await frame();
    });

    /* ---------- panel de Python ---------- */
    await check('el panel de Python se abre y se cierra', async function () {
      app.loadExample('suma');
      app.togglePython(false);
      await frame();
      ok(document.getElementById('pyPanel').hidden, 'deberia empezar cerrado');
      app.togglePython(true);
      await frame();
      ok(!document.getElementById('pyPanel').hidden, 'deberia abrirse');
      const caja = document.getElementById('pyPanel').getBoundingClientRect();
      ok(caja.width > 1 && caja.height > 1, 'deberia ocupar sitio');
      ok(caja.width <= window.innerWidth + 1, 'se sale a lo ancho: ' + Math.round(caja.width));
      ok(document.documentElement.scrollWidth <= window.innerWidth + 1,
        'con el panel abierto la pagina no deberia tener scroll horizontal');
      const lineas = app.pythonPanel();
      ok(lineas.length > 5, 'deberia mostrar codigo: ' + lineas.length);
      ok(lineas.some(function (l) { return l.text === 'suma = a + b'; }),
        'falta la asignacion: ' + lineas.map(function (l) { return l.text; }).join(' / '));
      app.togglePython(false);
      await frame();
      ok(document.getElementById('pyPanel').hidden, 'deberia cerrarse');
    });

    await check('el codigo se actualiza al editar un bloque', async function () {
      app.loadExample('suma');
      app.togglePython(true);
      await frame();
      const proceso = app.getGraph().nodes.filter(function (n) { return n.type === 'process'; })[0];
      proceso.text = 'suma = a * b';
      app.afterChange();
      await frame();
      await frame();
      const textos = app.pythonPanel().map(function (l) { return l.text; });
      ok(textos.indexOf('suma = a * b') >= 0, 'no se actualizo: ' + textos.join(' / '));
      ok(textos.indexOf('suma = a + b') < 0, 'sigue el codigo viejo');
      app.togglePython(false);
    });

    await check('mientras se ejecuta se marca la linea del bloque en curso', async function () {
      app.loadExample('tabla');
      app.togglePython(true);
      app.resetRun();
      await frame();
      eq(app.pythonPanel().filter(function (l) { return l.now; }).length, 0,
        'sin ejecutar no deberia haber linea marcada:');
      await stepUntilDone([3], 8);            // unos pocos pasos, no hasta el final
      await frame();
      const marcadas = app.pythonPanel().filter(function (l) { return l.now; });
      ok(marcadas.length >= 1, 'deberia haber una linea marcada');
      ok(marcadas[0].node, 'la linea marcada sabe de que bloque es');
      eq(marcadas[0].node, app.runtime.current, 'la linea marcada es la del bloque en curso:');
      app.togglePython(false);
    });

    await check('pulsar una linea de codigo selecciona su bloque', async function () {
      app.loadExample('suma');
      app.togglePython(true);
      app.select(null, null);
      await frame();
      const filas = document.querySelectorAll('#pyBody .py-line[data-node]');
      ok(filas.length > 1, 'deberia haber lineas con bloque');
      const destino = filas[filas.length - 1].dataset.node;
      filas[filas.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await frame();
      const elegido = document.querySelector('.node.is-selected');
      ok(!!elegido, 'deberia quedar un bloque seleccionado');
      eq(elegido.dataset.id, destino, 'el bloque seleccionado es el de la linea:');
      app.togglePython(false);
    });

    await check('un diagrama que no se puede traducir lo explica en el panel', async function () {
      freshGraph();
      const g = app.getGraph();
      const p = Flow.addNode(g, 'process', 60, 60, 'x = 1');
      void p;
      app.togglePython(true);
      app.afterChange();
      await frame();
      await frame();
      const aviso = app.pythonNotes();
      ok(/Inicio/.test(aviso), 'deberia decir que falta el Inicio: ' + aviso);
      ok(document.getElementById('btnPyCopy').disabled, 'copiar deberia estar apagado');
      ok(document.getElementById('btnPyDownload').disabled, 'descargar tambien');
      app.togglePython(false);
    });

    await check('el panel avisa de lo que cambia en Python', async function () {
      app.loadExample('promedio');
      app.togglePython(true);
      await frame();
      await frame();
      const aviso = app.pythonNotes();
      ok(/round|2\.0/.test(aviso), 'deberia avisar de round o de los decimales: ' + aviso);
      ok(!document.getElementById('btnPyCopy').disabled, 'copiar deberia poder usarse');
      app.togglePython(false);
    });

    await check('el codigo sale coloreado y sin etiquetas sueltas', async function () {
      app.loadExample('tabla');
      app.togglePython(true);
      await frame();
      const cuerpo = document.getElementById('pyBody');
      ok(cuerpo.querySelectorAll('.py-kw').length > 0, 'deberia colorear palabras clave');
      ok(cuerpo.querySelectorAll('.py-str').length > 0, 'y los textos');
      ok(cuerpo.textContent.indexOf('<span') < 0, 'no deberia escapar mal el HTML');
      const conWhile = app.pythonPanel().filter(function (l) { return l.text === 'while i <= 10:'; });
      eq(conWhile.length, 1, 'deberia estar el while una sola vez:');
      app.togglePython(false);
    });

    /* ---------- resultado ---------- */
    const failed = results.length - passed;
    const summary = failed
      ? 'SELFTEST FALLA ' + failed + ' de ' + results.length
      : 'SELFTEST OK ' + passed + '/' + results.length;
    out.textContent = summary + '\n' + results.join('\n');
    document.title = summary;
    window.__selftestDone = summary;
  }

  run().catch(function (err) {
    document.title = 'SELFTEST ERROR ' + (err && err.message);
    out.textContent = 'ERROR GENERAL: ' + (err && err.stack || err) + '\n' + results.join('\n');
    window.__selftestDone = document.title;
  });
})();
