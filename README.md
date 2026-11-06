# Diagramas de flujo

Herramienta para **armar, modificar y ejecutar** diagramas de flujo, pensada para
enseñar programación. Todo funciona en el navegador: no hay servidor ni base de datos.

```
index.html          la página
css/styles.css      estilos
js/expr.js          intérprete de expresiones en pseudocódigo (sin DOM)
js/flow.js          modelo del diagrama, validación y máquina de ejecución (sin DOM)
js/geometry.js      formas de los bloques y trazado de las flechas (sin DOM)
js/examples.js      diagramas de ejemplo
js/store.js         biblioteca de diagramas guardados en el navegador (sin DOM)
js/export.js        el diagrama a SVG y a PDF, sin librerías (sin DOM)
js/ui.js            dibujo, edición con ratón o dedo, y controles
tests/              pruebas automáticas (ver más abajo)
respaldo/           la versión original de un solo archivo, por si acaso
```

## Qué se puede hacer

- Arrastrar bloques desde la paleta (o pulsarlos para colocarlos en el centro).
  Funciona igual con ratón y con dedo.
- Escribir el contenido de un bloque con doble clic, con el lápiz del bloque,
  o con Enter/F2 si está seleccionado.
- Unir bloques arrastrando desde los puntos naranjas. Cada salida admite una
  sola flecha; la decisión tiene dos salidas laterales, Sí a la izquierda y No a
  la derecha, y el vértice de abajo queda libre.
- Ejecutar **paso a paso** o seguido, con velocidad regulable, viendo en todo
  momento el bloque actual, la flecha que se acaba de tomar, las variables y la consola.
- Cambiar cualquier variable a mano, incluso a mitad de la ejecución, y añadir variables nuevas.
- Deshacer/rehacer, duplicar, mover con las flechas del teclado, zoom y "Ajustar".
- **Guardar varios diagramas en el navegador** y volver a abrirlos desde la lista
  *Mis diagramas*, donde también se renombran, duplican y borran.
- **Exportar** a `PNG`, `SVG` (vectorial) o `PDF` listo para imprimir; descargar el
  `.json`, abrir uno de un archivo, o generar un **enlace** que lleva el diagrama dentro.
- **Modo claro u oscuro** con el botón de sol/luna de la barra; la elección se
  recuerda y se aplica antes de pintar, así que no parpadea al recargar.
- **Ver el mismo programa en Python** con el botón *Python*: se escribe solo mientras
  editas y marca la línea del bloque en curso al ejecutar paso a paso.
- Lo que estás haciendo se guarda solo y se recupera al volver, aunque no le hayas
  dado a Guardar.

## Qué se escribe en cada bloque

| Bloque | Contenido | Ejemplo |
|---|---|---|
| Entrada | nombres de variables | `n` · `a, b` |
| Proceso | asignaciones (`;` o salto de línea para varias) | `suma = a + b` · `i = i + 1` |
| Salida | textos y valores separados por comas | `"Total: ", suma` |
| Decisión | una condición | `n mod 2 == 0` · `i <= 10 y encontrado == falso` |

Operadores: `+ - * / ^ mod div`, comparaciones `== != < <= > >=`,
lógicos `y o no`, asignación `=` `<-` `:=`, valores `verdadero` / `falso`,
textos entre comillas.

Ojo con los iguales, que es la confusión clásica: **`=` da valor** a una variable
(`contador = 0`) y **`==` compara** (`contador == 10`). También valen `<>` o `!=`
para «distinto de». Si se confunden, el bloque avisa con el mensaje concreto.

Funciones: `abs concatenar cadena cos entero esnumero exp ln log longitud max min
mayusculas minusculas numero piso pot raiz redondear sen subcadena tan techo texto
truncar aleatorio` y la constante `pi`.

Los mensajes de error están en castellano y señalan el bloque culpable: variable sin
valor (con sugerencia si hay una parecida), división por cero, condición que no da
verdadero/falso, salida sin conectar, bucle que no termina, etc. Un error **detiene**
la ejecución; al corregir el bloque y volver a pulsar Ejecutar o Paso, se arranca de cero.

## Guardar y exportar

**Guardar** deja el diagrama dentro de este navegador (`localStorage`), con su nombre,
y aparece en la lista **Mis diagramas**. No se usa `sessionStorage` a propósito: eso se
borra al cerrar la pestaña. Un punto naranja en el botón Guardar avisa de que hay
cambios sin guardar, y al abrir otro diagrama con cambios pendientes se pregunta antes.

Ojo con dónde vive eso: **solo en ese navegador y en ese equipo**. Si el alumno cambia
de ordenador o borra los datos del sitio, no está. Para llevarlo a otro sitio están
`Archivo > Descargar .json` y `Archivo > Copiar enlace`.

| Formato | Para qué |
|---|---|
| PNG | pegar en un documento o una presentación |
| SVG | vectorial: se amplia sin pixelarse y se puede retocar |
| PDF | imprimir o repartir; A4, con el nombre del diagrama arriba |
| JSON | volver a abrirlo aquí, o pasarlo a otro equipo |

El PNG, el SVG y el PDF se generan desde el modelo, sin librerías ni servidor: el PDF
es vectorial de verdad (texto seleccionable, se ve nítido a cualquier zoom).

## Compartir por enlace

`Archivo > Copiar enlace` no sube nada a ningun sitio: el diagrama entero viaja
**dentro del enlace**, en el fragmento (lo que va despues del `#`):

```
https://diagramas.pages.dev/#d=eyJ2ZXJzaW9uIjoxLCJ0aXRsZSI6...
                            └─ el diagrama, en base64url
```

El JSON se pasa a bytes UTF-8 y de ahi a base64url (`+`/`/`/`=` cambiados por
`-`/`_`/nada) para que aguante pegado en un chat. Al abrirlo, el JavaScript del
otro lado lo decodifica y lo dibuja.

Funciona **porque el fragmento es la unica parte de una URL que el navegador no
manda al servidor**: por eso basta un sitio estatico y Cloudflare nunca ve el
diagrama. A cambio, hay que tener presente que:

- El enlace es una **foto del momento**: si sigues editando, hay que copiar otro.
- Cualquiera con el enlace lo puede abrir, y va a la vista (base64 no es cifrado).
- Abrir un enlace **no** lo guarda en *Mis diagramas*: se carga en el lienzo con el
  aviso de «sin guardar», y se guarda si quien lo recibe le da a Guardar.
- Si el diagrama no cabe (mas de 8000 caracteres de enlace) la app lo dice y
  propone `Descargar .json`.

## El diagrama en Python

El botón **Python** de la barra abre un panel con el mismo programa escrito en
Python. No es una plantilla con huecos: se traduce el **árbol de la expresión**
que ya usa el intérprete, así que sale el código que uno escribiría a mano.

- La flecha que vuelve arriba se reconoce como bucle: si la controla un rombo sale
  un `while condición:`, y si la condición está al final (repetir-hasta) sale un
  `while True:` con su `break`.
- Las dos ramas de un rombo se siguen hasta donde vuelven a juntarse, de ahí salen
  `if` / `else`, y las decisiones encadenadas se escriben con `elif`.
- Si el diagrama tiene una flecha que Python no puede escribir sin saltos, el panel
  **dice qué flecha lo rompe** y ofrece *Ver el bloque*, en lugar de generar código raro.
- El bloque *Entrada* genera un ayudante `leer()` que convierte lo que se teclea
  igual que el diagrama (número, lógico o texto), en vez de adivinar `int()` o `float()`.
- Debajo del código aparecen los avisos de lo que **no es idéntico** en Python:
  `mod`/`div` con negativos, `round(2.5)`, o que `4 / 2` se muestra como `2.0`.
- Con **Copiar** o **.py** te lo llevas tal cual.

Pulsando una línea de código se selecciona su bloque en el diagrama.

De momento va en un solo sentido: de diagrama a Python. Leer Python y dibujar el
diagrama queda fuera.

## Probar en local

```bash
node tests/serve.js          # http://localhost:8787
```

## Pruebas automáticas

```bash
npm test                                # 133 pruebas sin navegador
node tests/serve.js &                   # hace falta para las de interfaz
npm run test:ui                         # 68 pruebas en Chrome sin ventana
npm run test:ui:movil                   # las mismas en pantalla de móvil
npm run test:ui:publicado               # las mismas contra el sitio publicado
```

- `tests/core.test.js` prueba el intérprete, la ejecución de los ejemplos, la
  validación, el guardado y el trazado de flechas con Node puro.
- `tests/export.test.js` comprueba el SVG y la estructura del PDF (tabla xref,
  longitudes de los streams, escapes, que todo quepa en la página).
- `tests/store.test.js` prueba la biblioteca con un `localStorage` de mentira,
  incluido qué pasa si no queda espacio o si los datos están corruptos.
- `tests/pycode.test.js` prueba la traducción a Python, y sobre todo la **ejecuta**:
  corre el `.py` generado con `python`, le da las mismas entradas que al intérprete
  del diagrama y compara las dos salidas línea a línea. Necesita `python` en el PATH.
- `tests/ui-selftest.js` se carga en la página con `index.html?selftest=1` y maneja
  la interfaz de verdad (arrastres, doble clic, botones); `tests/run-ui-tests.js`
  la lanza en Chrome y devuelve el resultado.
- `node tests/screenshot.js salida.png 1440 900 "código js opcional"` saca un
  pantallazo, útil para revisar el aspecto.
- Las mismas pruebas se pueden lanzar contra el sitio ya publicado, sin servidor local:
  `node tests/run-ui-tests.js --url=https://diagramas.pages.dev`
- El PDF generado se comprobó además con un visor independiente (poppler:
  `pdfinfo` y `pdftoppm`), no solo con las pruebas propias.

## Publicado en

**https://diagramas.pages.dev**  (proyecto de Cloudflare Pages `diagramas`)

## Volver a publicar

Es un sitio estático: se sube la carpeta tal cual.

```bash
npx wrangler pages deploy . --project-name=diagramas --branch=main --commit-dirty=true
```

Cada `deploy` publica una versión nueva y devuelve además una URL propia de esa
versión (útil para revisarla antes de repartir el enlace bueno). También se puede
conectar un repositorio de Git desde el panel de
Cloudflare Pages y dejar el campo de comando de compilación vacío (no hay compilación),
con el directorio de salida `/`.

El archivo `_headers` fija las cabeceras de caché: `index.html` se revalida siempre
y los `.css`/`.js` se revalidan cada minuto, para que tras publicar nadie se quede
con una mezcla de archivos viejos y nuevos.

## Notas

- No hace falta conexión ni cuenta: se puede usar también abriendo `index.html`
  directamente, aunque en ese caso algunos navegadores no guardan el diagrama.
- La carpeta `tests/` se puede subir sin problema (no se ejecuta nada salvo que se
  pida `?selftest=1`), o borrarla antes de publicar si se prefiere.
