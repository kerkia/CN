// « Organisation › Direct » (pages/orgdirect.js): how it works, in Spanish; orgdirect.fr.js is the reference. One text per
// part of the page (owner, 2026-10-25: the MeOS and the file instructions were one block, « Le jour de la course » read as if
// it were MeOS's too): `meos` and `file` are shown only for the way the organiser chose in step 2, `after` with step 3.

// the page's three steps, at its top
export const overview = `
  <ol class="od-overview">
    <li><b>La carrera</b>: elígela o créala, una sola vez.</li>
    <li><b>El envío de los resultados</b>: elige tu software, <b>MeOS</b> u <b>otro</b>. Solo se muestran las instrucciones de tu
      elección: las dos formas no se combinan.</li>
    <li><b>Después de la carrera</b>: vinculada a una competición de tu club, la carrera se queda en «Resultados».</li>
  </ol>`;

// what both ways share, under the choice
export const common = `En ambos casos no hay que declarar nada de antemano: los recorridos, las categorías, los controles y los corredores
  vienen de tu software, y un recorrido que aparece durante la carrera se añade. Los corredores se reconocen por su nombre
  y su club, y se enlazan con su página en Ozimut.`;

export const meos = `
  <p class="od-what">MeOS envía él mismo sus resultados, sus controles de radio y sus tiempos parciales a Ozimut.
    <b>No hay que dejar nada abierto en Ozimut</b>, ni archivo que elegir: solo MeOS debe seguir conectado a internet.</p>
  <h3>En MeOS</h3>
  <ol class="od-steps">
    <li>En la pestaña <b>Servicios</b> (Services), añade el servicio <b>Resultados en línea</b> (Online Results).</li>
    <li>Marca «Enviar a la web» (Send to the web) y copia los tres valores de abajo: la dirección (URL), el «Número de identificación de la
      competición» (Competition ID number, el número) y la «Contraseña» (Password). Formato de exportación: «MeOS Online Protocol XML 2.0». Un intervalo de 10 a
      15 segundos es adecuado.</li>
    <li>En «Controles» (Controls), marca los controles de radio: sus tiempos llegan en directo. Marca también <b>«Enviar todas las picadas
      tras la lectura de la pinza»</b> (Send all punches after card readout): en cada llegada se publican todos los tiempos parciales del corredor.</li>
    <li>Haz clic en «Iniciar» (Start) en MeOS. Primero envía toda la carrera y luego solo lo que cambia; la última
      recepción aparece bajo los valores.</li>
  </ol>
  <p class="od-tip">Haz una prueba la víspera, con la carrera en preparación: los corredores aparecen en «En directo» incluso
    antes de la salida, y sus horas de salida en el «Calendario».</p>`;

export const file = `
  <p class="od-what">Para OE (SportSoftware), otro software, o MeOS sin su servicio «Resultados en línea»: el software
    exporta la lista de resultados a un archivo, y <b>esta página, abierta en el ordenador de la arena, vuelve a leer ese archivo</b>
    y lo envía a Ozimut.</p>
  <h3>Antes de la carrera</h3>
  <ol class="od-steps">
    <li>En tu software de cronometraje, programa una <b>exportación automática de la lista de resultados</b> a un archivo,
      cada 15 a 30 segundos, siempre en el mismo lugar y con el mismo nombre.
      <ul>
        <li>El formato recomendado es <b>IOF XML 3.0</b> (lista de resultados): contiene las horas de salida, los tiempos
          parciales y los corredores que siguen en carrera.</li>
        <li>Las listas de resultados HTML de MeOS y de OE también se leen, pero solo muestran a los corredores que han llegado o
          se han retirado.</li>
        <li>Si tu software no sabe exportar a intervalos regulares, exporta el archivo a mano de vez en cuando, con el
          mismo nombre: la página recoge cada nueva versión.</li>
      </ul></li>
    <li>Haz una prueba la víspera, con el archivo de una carrera pasada o de la carrera en preparación.</li>
  </ol>
  <h3>El día de la carrera</h3>
  <ol class="od-steps">
    <li>En el ordenador de la arena, conectado a internet, abre esta página en <b>Chrome o Edge</b> (Firefox y Safari no
      permiten a una página volver a leer un archivo por sí sola), con la sesión iniciada con la cuenta que creó la carrera en el paso 1:
      solo esa cuenta puede alimentarla.</li>
    <li>Elige abajo el archivo exportado, <b>una sola vez</b>. El navegador pide permiso para leerlo.</li>
    <li>Haz clic en «Iniciar». La página vuelve a leer el archivo por sí sola, cada 15 segundos por defecto, y solo envía lo que
      ha cambiado.</li>
    <li>Deja la página abierta, preferiblemente en su propia ventana, y el ordenador encendido, sin suspensión. Si la página se
      recarga, basta un clic en «Reanudar».</li>
  </ol>`;

export const after = `
  <ul class="od-steps">
    <li>Una carrera vinculada a una competición de tu club se guarda cada pocos minutos y se publica en
      <b>Carreras › Resultados</b>: los resultados, los tiempos parciales (en «Análisis») y, antes de la salida, la lista
      de salida. Los corredores reciben la alerta «una de mis carreras está en línea» una vez terminada la carrera.</li>
    <li>«Publicar ahora» la guarda al instante, sin esperar a la siguiente actualización.</li>
    <li>Un archivo de resultados subido después en la pestaña <b>Resultados</b> del evento tiene prioridad sobre la emisión, al igual que la
      lista de salida subida en su pestaña «Salidas».</li>
    <li>Abierta en la pestaña «Directo» de un evento, una emisión queda vinculada a la competición que lleva el evento. Sin
      competición, solo es visible en «En directo».</li>
  </ul>`;
