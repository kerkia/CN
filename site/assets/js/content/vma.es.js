// The MAS (VMA) page's long texts in Spanish (pages/vma.js); vma.fr.js is the reference.
// Checked 2026-10-14 (the apps: free, no subscription needed for the test itself).
const ext = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const row = (name, where, how, result) => `<tr><td><b>${name}</b></td><td>${where}</td><td>${how}</td><td>${result}</td></tr>`;

export const howTo = `
  <section class="card"><div class="card-head"><h2>Cómo hacer el test</h2></div>
    <div class="card-body vma-text">
      <ul>
        <li><b>Calienta</b> de 15 a 20 minutos, con algunas progresiones.</li>
        <li><b>Corre a ritmo regular</b>: salir demasiado rápido cuesta más de lo que se gana. Fíjate un tiempo por vuelta y acelera en el último minuto si te queda margen.</li>
        <li><b>Cuenta tus vueltas</b> (o pide que te las cuenten) y anota dónde estás en la señal final: las marcas de la pista cada 100 m, o conos cada 20 o 50 m, dan los metros de la última vuelta.</li>
        <li><b>Quédate en la misma calle</b>: la primera, pegada al bordillo, es la más corta. Una vuelta por la calle 2 ya mide 7 m más.</li>
        <li><b>El temporizador del móvil</b>, puesto en 6 o 12 minutos, basta: suena al final.</li>
        <li><b>Repítelo en las mismas condiciones</b> (pista, tiempo, forma) cada dos o tres meses para seguir tus progresos.</li>
      </ul>
      <p class="muted">Un test máximo exige estar en buena salud: en caso de duda, consulta a un médico.</p>
    </div></section>`;

export const methods = `
  <section class="card" style="margin-bottom:16px"><div class="card-body vma-text">
    <p>La <b>VAM</b> (velocidad aeróbica máxima) es la menor velocidad de carrera a la que se alcanza el consumo
      máximo de oxígeno (VO2máx). Se mantiene de 4 a 11 minutos según el corredor en los estudios de tiempo límite (Billat), a menudo unos 6. Sirve sobre todo para ajustar los ritmos de entrenamiento,
      en porcentaje de la VAM. Tres familias de tests la estiman:</p>
    <ul>
      <li><b>En el laboratorio</b>, en cinta con análisis de gases respiratorios: la referencia, que mide también el VO2máx.</li>
      <li><b>En el campo, guiado por pitidos</b> (tests «triangulares»): la velocidad aumenta por escalones y unos pitidos
        marcan el ritmo; la VAM es la velocidad del último escalón mantenido. No hace falta saber dosificar el ritmo.</li>
      <li><b>En el campo, con duración fija</b> (6 o 12 minutos): la mayor distancia posible; la VAM se deduce de la
        velocidad media. Nada más que una pista y un cronómetro, pero hay que saber correr regular.</li>
    </ul>
  </div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Los principales tests</h2></div>
    <div class="table-wrap"><table class="data compact vma-methods"><thead><tr><th>Test</th><th>Dónde</th><th>Desarrollo</th><th>Resultado</th></tr></thead>
      <tbody>
        ${row("VAMEVAL (Cazorla y Léger)", "Pista de 200 o 400 m, conos cada 20 m",
          "Salida a 8 km/h, +0,5 km/h cada minuto; hay que estar en un cono en cada pitido. Se para cuando se va demasiado retrasado en dos conos seguidos.",
          "VAM = velocidad del último escalón completado. El test de campo más preciso y más extendido.")}
        ${row("Léger-Boucher (Universidad de Montreal, 1980)", "Pista de 400 m, conos cada 50 m",
          "Escalones de 2 minutos, con la velocidad aumentando en cada escalón (1 km/h en las versiones francesas habituales, salida hacia 8 km/h; 0,5 km/h en la versión original).",
          "VAM = velocidad del último escalón. Escalones largos: más duro que el VAMEVAL.")}
        ${row("Medio Cooper (6 minutos)", "Pista",
          "La mayor distancia posible en 6 minutos, a ritmo regular.",
          "VAM ≈ distancia (m) ÷ 100. Sencillo y cercano a la VAM; exige dosificar bien el esfuerzo.")}
        ${row("Cooper (12 minutos, 1968)", "Pista",
          "La mayor distancia posible en 12 minutos.",
          "Se corre por debajo de la VAM: VAM ≈ distancia ÷ 200 ÷ 0,95 (bien entrenado), ÷ 0,90 (moderadamente) o ÷ 0,85 (poco entrenado). La regla «distancia ÷ 200» sola da la velocidad mantenida, no la VAM, y la variante «÷ 205» que también se lee la sitúa incluso por debajo de esa velocidad: ambas la subestiman. La fórmula de Cooper para el VO2máx, (distancia − 504,9) ÷ 44,73 (1968, 115 militares estadounidenses), da con unos pocos ml/kg/min de diferencia el mismo valor que 3,5 × VAM para un corredor bien entrenado, algo más por encima de 3 km. Quienes mantienen su VAM más tiempo, de 10 a 11 minutos, corren sin duda los 12 minutos hacia el 97 a 99 % de su VAM (VAM ≈ distancia ÷ 194 a ÷ 198): una estimación sacada de la bajada habitual de la velocidad con la duración de la carrera, no una medición.")}
        ${row("Course Navette de Léger (20 m)", "Pabellón o campo, dos líneas a 20 m",
          "Idas y vueltas, salida a 8,5 km/h, +0,5 km/h cada minuto.",
          "Los cambios de sentido frenan: la velocidad alcanzada es inferior a la VAM en pista. Bueno para el VO2máx, hay que convertirlo para los ritmos.")}
        ${row("45-15 (Gacon)", "Pista, conos cada 6,25 m",
          "45 s de carrera, 15 s de recuperación; 100 m en 45 s al principio (8 km/h), luego un cono más lejos en cada escalón (+0,5 km/h).",
          "Una VAM «intermitente», más alta que la VAM continua: sirve para ajustar las sesiones de series cortas.")}
      </tbody></table></div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>¿Cuál elegir?</h2></div><div class="card-body vma-text">
    <ul>
      <li><b>Solo en una pista, sin material</b>: el medio Cooper, y la calculadora de esta página.</li>
      <li><b>Solo o en grupo, con un móvil y conos</b>: el VAMEVAL, con una aplicación que reproduce los pitidos
        (ver la pestaña Aplicaciones); sin ritmo que dosificar.</li>
      <li><b>En un pabellón</b>: la Course Navette de Léger, teniendo en cuenta que subestima la VAM en pista.</li>
      <li>Una VAM también puede estimarse a partir de una marca en carrera (un 10 km se corre hacia el 85 a 90 % de la VAM), pero es
        aproximado: nada sustituye a un test.</li>
    </ul>
    <p class="muted">Fuentes: ${ext("https://www.topendsports.com/testing/tests/vameval.htm", "VAMEVAL")},
      ${ext("https://www.topendsports.com/testing/tests/track-test.htm", "Université de Montréal Track Test")},
      ${ext("https://www.topendsports.com/testing/tests/gacon.htm", "test de Gacon")} (Topend Sports);
      ${ext("https://www.aeeps.org/ajouter-un-fichier/doc_download/3071-.html", "ficha de los tests de VAM")} de la AEEPS (en francés).</p>
  </div></section>`;

const APPS = [
  { name: "EZ BIPsVMA", test: "VAMEVAL (conos cada 20 m) y Course Navette de Léger",
    where: "Aplicación web: se abre en el navegador de cualquier móvil, se instala en la pantalla de inicio y funciona sin conexión.",
    links: [["https://bips.ezapps.be/", "bips.ezapps.be"]],
    note: "Lo más sencillo para un VAMEVAL en pista: coloca conos cada 20 m y lanza los pitidos." },
  { name: "EPS Test VMA", test: "Léger-Boucher (conos cada 50 m, escalones de 2 minutos)",
    where: "Android y iPhone / iPad, gratuita, sin compras integradas.",
    links: [["https://play.google.com/store/apps/details?id=com.GrangerM.testvma", "Google Play"],
      ["https://apps.apple.com/fr/app/eps-test-vma/id6466824820", "App Store"]],
    note: "Pensada para profesores de Educación Física; también sirve para un corredor solo." },
];
const SHUTTLE = [
  { name: "VMA Test (Beep test, PACER)", links: [["https://play.google.com/store/apps/details?id=com.victormeunier.vmatest", "Google Play"]] },
  { name: "BeepRun : Test Luc Léger & VMA", links: [["https://apps.apple.com/fr/app/beeprun-test-luc-l%C3%A9ger-vma/id1411308819", "App Store"]] },
];
export const apps = `
  <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Para un test en pista</h2>
    <div class="hint">Gratuitas; el móvil reproduce los pitidos que marcan el ritmo en cada cono</div></div></div>
    <div class="card-body vma-apps">${APPS.map((a) => `<div class="vma-app">
      <h3>${a.name}</h3>
      <div><b>Test:</b> ${a.test}</div>
      <div>${a.where}</div>
      <div class="muted">${a.note}</div>
      <div class="row">${a.links.map(([u, l]) => `<a class="btn btn-sm" href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`).join("")}</div>
    </div>`).join("")}</div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Sin aplicación</h2></div><div class="card-body vma-text">
    <p>El <b>medio Cooper</b> y el <b>Cooper</b> no necesitan ninguna: el temporizador del móvil puesto en 6 o 12 minutos,
      el número de vueltas y los metros de la última vuelta bastan, y después la calculadora de esta página. Un reloj GPS mide
      mal una pista (de 1 a 3 % de error): cuenta las vueltas.</p>
    <p><b>Consejos</b>: un altavoz Bluetooth si sois varios; el volumen al máximo y la pantalla sin que entre en
      reposo; conos colocados con cinta métrica, la línea de meta de la pista como referencia del primero.</p>
  </div></section>
  <section class="card"><div class="card-head"><div><h2>En un pabellón: la Course Navette de 20 m</h2>
    <div class="hint">No es un test en pista: la velocidad alcanzada queda por debajo de la VAM (ver la pestaña Métodos)</div></div></div>
    <div class="card-body vma-text"><ul>${SHUTTLE.map((a) => `<li><b>${a.name}</b> — ${a.links.map(([u, l]) => ext(u, l)).join(", ")}</li>`).join("")}</ul></div></section>`;
