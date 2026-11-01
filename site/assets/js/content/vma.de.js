// The MAS (VMA) page's long texts in German (pages/vma.js); vma.fr.js is the reference.
// Checked 2026-10-14 (the apps: free, no subscription needed for the test itself).
const ext = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const row = (name, where, how, result) => `<tr><td><b>${name}</b></td><td>${where}</td><td>${how}</td><td>${result}</td></tr>`;

export const howTo = `
  <section class="card"><div class="card-head"><h2>So machst du den Test</h2></div>
    <div class="card-body vma-text">
      <ul>
        <li><b>Wärm dich</b> 15 bis 20 Minuten auf, mit ein paar Steigerungsläufen.</li>
        <li><b>Lauf ein gleichmäßiges Tempo</b>: Zu schnell loszulaufen kostet mehr, als es bringt. Peile eine Zeit pro Runde an und beschleunige in der letzten Minute, wenn du noch Reserven hast.</li>
        <li><b>Zähl deine Runden</b> (oder lass sie zählen) und merk dir, wo du beim Schlusssignal bist: Die Markierungen der Bahn alle 100 m oder Hütchen alle 20 oder 50 m geben die Meter der letzten Runde.</li>
        <li><b>Bleib auf derselben Bahn</b>: Die erste, direkt am Innenrand, ist die kürzeste. Eine Runde auf Bahn 2 ist schon 7 m länger.</li>
        <li><b>Der Timer des Handys</b>, auf 6 oder 12 Minuten gestellt, reicht: Er klingelt am Ende.</li>
        <li><b>Wiederhole ihn unter denselben Bedingungen</b> (Bahn, Wetter, Form) alle zwei oder drei Monate, um deine Fortschritte zu verfolgen.</li>
      </ul>
      <p class="muted">Ein Maximaltest setzt gute Gesundheit voraus: Im Zweifel frag einen Arzt.</p>
    </div></section>`;

export const methods = `
  <section class="card" style="margin-bottom:16px"><div class="card-body vma-text">
    <p>Die <b>MAG</b> (maximale aerobe Geschwindigkeit) ist die niedrigste Laufgeschwindigkeit, bei der man seine maximale
      Sauerstoffaufnahme (VO2max) erreicht. In den Studien zur Grenzzeit (Billat) hält man sie je nach Läufer 4 bis 11 Minuten, oft um die 6. Sie dient vor allem dazu, die Trainingstempos
      in Prozent der MAG festzulegen. Drei Familien von Tests schätzen sie:</p>
    <ul>
      <li><b>Im Labor</b>, auf dem Laufband mit Atemgasanalyse: die Referenz, die auch die VO2max misst.</li>
      <li><b>Im Feld, mit Signaltönen</b> („Stufentests“): Die Geschwindigkeit steigt stufenweise, und Signaltöne
        geben das Tempo vor; die MAG ist die Geschwindigkeit der letzten gehaltenen Stufe. Man muss sein Tempo nicht selbst einteilen können.</li>
      <li><b>Im Feld, mit fester Dauer</b> (6 oder 12 Minuten): die größtmögliche Strecke; die MAG ergibt sich aus der
        Durchschnittsgeschwindigkeit. Nichts als eine Bahn und eine Stoppuhr, aber man muss gleichmäßig laufen können.</li>
    </ul>
  </div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Die wichtigsten Tests</h2></div>
    <div class="table-wrap"><table class="data compact vma-methods"><thead><tr><th>Test</th><th>Wo</th><th>Ablauf</th><th>Ergebnis</th></tr></thead>
      <tbody>
        ${row("VAMEVAL (Cazorla und Léger)", "Bahn von 200 oder 400 m, Hütchen alle 20 m",
          "Start bei 8 km/h, +0,5 km/h jede Minute; bei jedem Signalton muss man an einem Hütchen sein. Abbruch, wenn man an zwei Hütchen nacheinander zu weit zurückliegt.",
          "MAG = Geschwindigkeit der letzten beendeten Stufe. Der genaueste und verbreitetste Feldtest.")}
        ${row("Léger-Boucher (Universität Montréal, 1980)", "400-m-Bahn, Hütchen alle 50 m",
          "Stufen von 2 Minuten, die Geschwindigkeit steigt mit jeder Stufe (1 km/h in den üblichen französischen Versionen, Start bei etwa 8 km/h; 0,5 km/h in der Originalversion).",
          "MAG = Geschwindigkeit der letzten Stufe. Lange Stufen: anstrengender als der VAMEVAL.")}
        ${row("Halber Cooper-Test (6 Minuten)", "Bahn",
          "Die größtmögliche Strecke in 6 Minuten, in gleichmäßigem Tempo.",
          "MAG ≈ Strecke (m) ÷ 100. Einfach und nah an der MAG; verlangt eine gute Krafteinteilung.")}
        ${row("Cooper-Test (12 Minuten, 1968)", "Bahn",
          "Die größtmögliche Strecke in 12 Minuten.",
          "Man läuft ihn unterhalb der MAG: MAG ≈ Strecke ÷ 200 ÷ 0,95 (gut trainiert), ÷ 0,90 (mäßig) oder ÷ 0,85 (wenig trainiert). Die Regel „Strecke ÷ 200“ allein gibt die gehaltene Geschwindigkeit, nicht die MAG, und die ebenfalls zu lesende Variante „÷ 205“ setzt sie sogar unter diese Geschwindigkeit: Beide unterschätzen sie. Coopers Formel für die VO2max, (Strecke − 504,9) ÷ 44,73 (1968, 115 US-Soldaten), ergibt bis auf wenige ml/kg/min denselben Wert wie 3,5 × MAG für einen gut trainierten Läufer, etwas mehr jenseits von 3 km. Wer seine MAG am längsten hält, 10 bis 11 Minuten, läuft die 12 Minuten vermutlich bei 97 bis 99 % seiner MAG (MAG ≈ Strecke ÷ 194 bis ÷ 198): eine Schätzung aus dem üblichen Rückgang der Geschwindigkeit mit der Laufdauer, keine Messung.")}
        ${row("Luc-Léger-Test (Shuttle-Run, 20 m)", "Halle oder Platz, zwei Linien im Abstand von 20 m",
          "Hin und zurück, Start bei 8,5 km/h, +0,5 km/h jede Minute.",
          "Die Wenden bremsen: Die erreichte Geschwindigkeit liegt unter der MAG auf der Bahn. Gut für die VO2max, für die Tempos umzurechnen.")}
        ${row("45-15 (Gacon)", "Bahn, Hütchen alle 6,25 m",
          "45 s Laufen, 15 s Erholung; anfangs 100 m in 45 s (8 km/h), dann mit jeder Stufe ein Hütchen weiter (+0,5 km/h).",
          "Eine „intermittierende“ MAG, höher als die kontinuierliche MAG: Sie dient zum Festlegen kurzer Intervalleinheiten.")}
      </tbody></table></div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Welchen wählen?</h2></div><div class="card-body vma-text">
    <ul>
      <li><b>Allein auf einer Bahn, ohne Material</b>: der halbe Cooper-Test und der Rechner dieser Seite.</li>
      <li><b>Allein oder zu mehreren, mit einem Handy und Hütchen</b>: der VAMEVAL, mit einer App, die die Signaltöne abspielt
        (siehe Reiter „Apps“); kein Tempo einzuteilen.</li>
      <li><b>In der Halle</b>: der Luc-Léger-Test, im Wissen, dass er die MAG auf der Bahn unterschätzt.</li>
      <li>Eine MAG lässt sich auch aus einer Wettkampfzeit schätzen (10 km läuft man bei etwa 85 bis 90 % der MAG), aber das ist
        ungenau: Nichts geht über einen Test.</li>
    </ul>
    <p class="muted">Quellen: ${ext("https://www.topendsports.com/testing/tests/vameval.htm", "VAMEVAL")},
      ${ext("https://www.topendsports.com/testing/tests/track-test.htm", "Université de Montréal Track Test")},
      ${ext("https://www.topendsports.com/testing/tests/gacon.htm", "Gacon-Test")} (Topend Sports);
      ${ext("https://www.aeeps.org/ajouter-un-fichier/doc_download/3071-.html", "Übersicht der VMA-Tests")} der AEEPS (auf Französisch).</p>
  </div></section>`;

const APPS = [
  { name: "EZ BIPsVMA", test: "VAMEVAL (Hütchen alle 20 m) und Luc-Léger-Test",
    where: "Web-App: öffnet sich im Browser jedes Handys, lässt sich auf dem Startbildschirm installieren und funktioniert offline.",
    links: [["https://bips.ezapps.be/", "bips.ezapps.be"]],
    note: "Am einfachsten für einen VAMEVAL auf der Bahn: Stell Hütchen alle 20 m auf und starte die Signaltöne." },
  { name: "EPS Test VMA", test: "Léger-Boucher (Hütchen alle 50 m, Stufen von 2 Minuten)",
    where: "Android und iPhone / iPad, kostenlos, ohne In-App-Käufe.",
    links: [["https://play.google.com/store/apps/details?id=com.GrangerM.testvma", "Google Play"],
      ["https://apps.apple.com/fr/app/eps-test-vma/id6466824820", "App Store"]],
    note: "Für Sportlehrer entwickelt; funktioniert auch für einen Läufer allein." },
];
const SHUTTLE = [
  { name: "VMA Test (Beep test, PACER)", links: [["https://play.google.com/store/apps/details?id=com.victormeunier.vmatest", "Google Play"]] },
  { name: "BeepRun : Test Luc Léger & VMA", links: [["https://apps.apple.com/fr/app/beeprun-test-luc-l%C3%A9ger-vma/id1411308819", "App Store"]] },
];
export const apps = `
  <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Für einen Test auf der Bahn</h2>
    <div class="hint">Kostenlos; das Handy spielt die Signaltöne, die an jedem Hütchen das Tempo vorgeben</div></div></div>
    <div class="card-body vma-apps">${APPS.map((a) => `<div class="vma-app">
      <h3>${a.name}</h3>
      <div><b>Test:</b> ${a.test}</div>
      <div>${a.where}</div>
      <div class="muted">${a.note}</div>
      <div class="row">${a.links.map(([u, l]) => `<a class="btn btn-sm" href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`).join("")}</div>
    </div>`).join("")}</div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Ohne App</h2></div><div class="card-body vma-text">
    <p>Der <b>halbe Cooper-Test</b> und der <b>Cooper-Test</b> brauchen keine: Der Timer des Handys auf 6 oder 12 Minuten,
      die Zahl der Runden und die Meter der letzten Runde reichen, dann der Rechner dieser Seite. Eine GPS-Uhr misst
      eine Bahn schlecht (1 bis 3 % Fehler): Zähl die Runden.</p>
    <p><b>Tipps</b>: ein Bluetooth-Lautsprecher, wenn ihr zu mehreren seid; die Lautstärke auf Maximum und den Bildschirm so, dass er nicht in den
      Ruhezustand geht; die Hütchen mit dem Maßband gesetzt, die Ziellinie der Bahn als Bezugspunkt für das erste.</p>
  </div></section>
  <section class="card"><div class="card-head"><div><h2>In der Halle: der 20-m-Shuttle-Run</h2>
    <div class="hint">Kein Test auf der Bahn: Die erreichte Geschwindigkeit liegt unter der MAG (siehe Reiter „Methoden“)</div></div></div>
    <div class="card-body vma-text"><ul>${SHUTTLE.map((a) => `<li><b>${a.name}</b> — ${a.links.map(([u, l]) => ext(u, l)).join(", ")}</li>`).join("")}</ul></div></section>`;
