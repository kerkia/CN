// The Documentation's guide to the site, in German (guide.fr.js is the reference: the same structure, the same chapters).
// build(X) receives the page's helpers and returns « Die Website » (the documentation's home) and the guides of Arena, Coach and
// Orga. A page is named as the German menu names it, with a link.
export function build(X) {
  const { html, raw, subTabs, fr = true, admin = false, owner = false } = X;
  // a page of the site, as the menus name it
  const P = (href, label) => html`<a href="${href}">${label}</a>`;
  // a module's documentation
  const M = (mod, label) => html`<a href="#/documentation?module=${mod}">${label}</a>`;
  // a tab of the module's documentation shown (Orga: « Die Bahnlegung »)
  const D = (tab, label, goto) => html`<a href="#/documentation?onglet=${tab}${goto ? `&voir=${goto}` : ""}" data-tab-link="${tab}"${raw(goto ? ` data-goto="${goto}"` : "")}>${label}</a>`;
  const chapters = (list, CH) => raw(subTabs(list, list[0][0]).s.replace(/<div data-subpanel="([a-z]+)"( hidden)?><\/div>/g, (m0, k, hid) =>
    `<div data-subpanel="${k}"${hid || ""}>${CH[k]().s}</div>`));
  const slide = (kicker, title, body, id) => html`<section class="mx-slide"${raw(id ? ` id="${id}"` : "")}><p class="mx-kicker">${kicker}</p><h2>${title}</h2>${body}</section>`;
  const list = (items) => html`<ul class="mx-list">${items.filter(Boolean).map((i) => html`<li><span>${i}</span></li>`)}</ul>`;

  // what each documentation says under its title
  const LEDE = {
    home: html`Ozimut in wenigen Worten, dann die Dokumentation jedes Moduls: Wähle das, das dich interessiert.`,
    arena: html`Die Wettkämpfe: der Kalender, die Ergebnisse der Veranstalter, die Live-Ergebnisse und die Analyse der Zwischenzeiten.`,
    coach: owner ? html`Trainieren: die Analysen von GPS-Tracks, die Postenbeschreibungen, die Kartensymbole, die Spiele und die MAG.`
      : html`Trainieren: die Analysen von GPS-Tracks, die Spiele und die MAG.`,
    orga: html`Die Werkzeuge der Veranstalter: Ergebnisse, Startzeiten, Live-Übertragung, GPS-Tracking, Gruppenanalysen und Bahnlegung.`,
  };

  // ======================================================================================================
  // Die Website: the documentation's home, short
  // ======================================================================================================
  function site() {
    return html`
      ${slide("Die Website", "Die Module und das Konto", html`
        <p>Ozimut hat vier Module: Die Modulseite, auf der du landest, lässt dich eines davon wählen, und die obere Leiste zeigt dann nur dessen
          Seiten. Das Ozimut-Logo bringt dich jederzeit dorthin zurück. Orga wird bei der Registrierung, in den Einstellungen oder auf der Modulseite
          aktiviert und am Computer genutzt.</p>
        ${list([
          html`<b>Ohne Konto</b> zeigt Ozimut, was öffentlich ist: Arena, Coach außer der Gruppenanalyse, und in Stats den Läufer, die Rangliste und die
            Läufe aus dem Zeitraum, den der Verband frei veröffentlicht.`,
          html`<b>Ein Konto</b> wird mit einer E-Mail-Adresse und einem Passwort eröffnet, dazu kommen die Länder, in denen du läufst (${P("#/reglages?onglet=pays", "Einstellungen › Meine Länder")}).
            Für Frankreich werden Name und Lizenznummer mit der Liste der Lizenzinhaber abgeglichen: Das öffnet ${fr ? "die Ranglisten und deine Läuferseite" : "die französischen Ranglisten"}.
            Das Konto speichert nur das Nötige; ${P("#/compte/confidentialite", "Website-Regeln und Datenschutz")} sagt, was, wo und wie lange.`,
          html`Unter deinem Namen: die Modulseite, diese Dokumentation, die ${P("#/reglages", "Einstellungen")}, „Kontakt“ und das Abmelden. Seiten, die
            noch in der Testphase sind, tragen den Vermerk „Beta“.`,
        ])}`, "menus")}
      ${slide("Die Website", "Land, Sprache und Farbschema", html`
        ${list([
          html`<b>Das Land</b>, oben, bestimmt die Wettkämpfe, die du siehst: den Kalender von rund dreißig Ländern, jeden Morgen bei ihrem Verband gelesen,
            ihre Ergebnisse und ihre Live-Ergebnisse, offen für alle. Ranglisten gibt es nur dort, wo Ozimut die Ergebnisse des Verbands hat: Frankreich
            (${fr ? "der offizielle CN und " : ""}der Ozimut-Index) und Spanien (der Ozimut-Index).`,
          html`<b>Die Sprache</b> – Deutsch, Englisch, Französisch oder Spanisch – ändert sich auf diesem Gerät und, wenn du angemeldet bist, für das Konto (die E-Mails folgen).`,
          html`<b>Das Farbschema</b>, unter dem Mond: Tag, Lichtung, Wald, Unterholz oder Nacht; standardmäßig hell am Computer, dunkel auf dem Handy.`,
        ])}`, "pays")}
      ${slide("Die Website", "Die Benachrichtigungen", html`
        <p>In den ${P("#/reglages", "Einstellungen")} kommt jede Benachrichtigung per E-Mail, als Push-Mitteilung oder beides: <b>einer meiner Läufe ist online</b>${fr ? "" : " (mit einer französischen Lizenz)"},
          <b>meine Startzeit ist veröffentlicht</b>, <b>ein neuer Lauf in meinen Regionen</b> und <b>der Anmeldeschluss naht</b>. Die
          Push-Mitteilungen werden Gerät für Gerät eingestellt; die Benachrichtigungen per E-Mail werden Konto für Konto freigeschaltet, da die Website nur begrenzt viele E-Mails versenden kann.</p>`, "compte")}
      ${slide("Die Website", "Auf dem Handy", html`
        ${list([
          html`<b>Die App</b>: „App installieren“ im Menü unter deinem Namen (Chrome, Edge, Android); auf dem iPhone Teilen › „Zum Home-Bildschirm“
            – das ist auch der einzige Weg, dort Push-Mitteilungen zu erhalten.`,
          html`<b>Einen Track</b> von der Uhr oder dem Handy an Ozimut <b>teilen</b> öffnet die ${P("#/analyse-solo", "Einzelanalyse")} mit der Datei; nichts
            wird hochgeladen.`,
        ])}`, "telephone")}`;
  }

  // ======================================================================================================
  // Arena
  // ======================================================================================================
  const ARENA = [["competitions", "Die Wettkämpfe"], ["resultats", "Ergebnisse"], ["direct", "Live"], ["analyse", "Laufanalyse"]];
  function arena() {
    return chapters(ARENA, {
      competitions: () => html`
        ${slide("Arena", "Eine Seite, alle Wettkämpfe", html`
          <p>Arena ist eine einzige Seite, die ${P("#/agenda", "Wettkämpfe")} des gewählten Landes: Drei Kästchen wählen die von heute, die kommenden und
            die der letzten 60 Tage. Der Kalender kommt jeden Morgen aus dem Kalender des Verbands – die Läufe, aber auch Trainings, Trainingslager und
            Kurse. Filtern kannst du nach Datum, Disziplin, Region${fr ? ", Département und nach Läufen, die für den CN zählen" : ""}; am Computer zeigt eine Karte,
            wo sie stattfinden.</p>
          ${list([
            html`<b>Ein kommender Wettkampf</b> öffnet sich neben der Liste: der Ort und der Weg dorthin, die Ausschreibung, ${fr ? "die Zahl der Anmeldungen pro Bahn, " : ""}der
              Anmeldeschluss und Schaltflächen, wenn es sie gibt – die Startliste${fr ? " (mit dem CN jedes Läufers und dem Rang, den er erwarten lässt)" : ""},
              „Live verfolgen“, das GPS-Tracking.`,
            html`<b>Ein vergangener Wettkampf</b> öffnet seine Seite: die Ergebnisse als erster Reiter, dann, wenn Zwischenzeiten veröffentlicht sind, jede Ansicht
              ihrer Analyse. „‹ Wettkämpfe“ bringt dich zur Liste zurück, dort, wo du sie verlassen hast.`,
          ])}`)}`,
      resultats: () => html`
        ${slide("Arena", "Die Ergebnisse der Veranstalter", html`
          <p>Die Ergebnisse der letzten 60 Tage erscheinen so, wie die Veranstalter sie veröffentlichen, oft noch am selben Abend, Tage vor dem Verband.
            Ozimut sucht sie selbst mehrmals am Tag, samstags und sonntags abends alle 20 Minuten:</p>
          ${list([
            html`auf den Ergebnis-<b>Plattformen</b>: liveresultat, WinSplits, Helga, O'Live, SPORTident Center, den MeOSDjango-Websites (darunter Orientation Data);`,
            html`auf der <b>Website des veranstaltenden Vereins</b>: seine Seiten und Dateien (HTML von OE oder MeOS, IOF XML, PDF);`,
            html`in den <b>Uploads</b> der Veranstalter und ihren <b>Live-Übertragungen</b> (siehe die Dokumentation von ${M("orga", "Orga")}).`,
          ])}
          <p>Ein laufender Wettkampf zeigt es an („läuft“), solange Läufer unterwegs sind. Wenn es mehrere Dokumente gibt, zeigt Ozimut das beste:
            das des Veranstalters vor denen der Plattformen, Live-Ergebnisse zuletzt (sie werden danach nicht korrigiert). Die Läufer werden an
            Name und Verein erkannt.</p>`)}
        ${!fr ? "" : html`
        <section class="mx-slide">
          <p class="mx-kicker">Ergebnisse</p>
          <h2>Vorläufige Scores und CN</h2>
          <p>Die Website berechnet vorläufige Scores nach den Regeln jeder Methode, für die erkannten Läufer.</p>
          ${list([
            html`<b>Offiziell</b>: der offizielle CN jedes erkannten Läufers 15 Tage vor dem Lauf und die Regel der FFCO (gewöhnlicher Mittelwert über die schnellsten
              zwei Drittel).`,
            html`<b>Ozimut</b>: das übliche Niveau jedes erkannten Läufers 15 Tage vor dem Lauf, der Ozimut-Bahnwert (der
              Mittelwert von Niveau × Zeit der Schnellsten: 90 % des Felds im Wald, zwei Drittel im Sprint) und der Neuskalierungsfaktor des Tages. Der vorläufige
              Ozimut-Index nach dem Lauf folgt der Regel der Gewichtungsplätze.`,
            html`Nur Listen <b>nach Bahn</b> werden bewertet. Eine Liste nach Kategorie wird Bahn für Bahn bewertet, sobald bekannt ist, welche Kategorien
              auf welcher Bahn liefen (aus den Listen nach Bahn desselben Laufs, der Anmeldeliste der FFCO oder der Ausschreibung). Nicht erkannte
              Läufer bleiben ohne CN.`,
            html`Diese Werte sind vorläufig, bis die FFCO sie veröffentlicht: Die endgültigen Werte können abweichen, wenn Ergebnisse korrigiert
              oder Läufer hinzugefügt werden.`,
          ])}
        </section>`}`,
      direct: () => html`
        ${slide("Arena", "Live", html`
          <p>Am Wettkampftag gibt „Live verfolgen“ die Ergebnisse weiter, die während des Laufs auf liveresultat, O'Live, SPORTident Center, einer
            MeOSDjango-Website veröffentlicht oder vom Veranstalter aus seiner Zeitmessungssoftware gesendet werden. Ein Wettkampf, bei dem ein Posten
            oder das Ziel in der letzten halben Stunde einen Durchgang registriert hat, ist als „live“ markiert.</p>
          ${list([
            html`<b>Nach Bahn oder nach Kategorie</b>: Rang, Zeit, Rückstand, Startzeit${fr ? ", der CN jedes Läufers und der Rang, den er erwarten lässt, und der Score seiner Zeit" : ""}.
              Ein Läufer, der noch unterwegs ist, hat eine geschätzte Zielzeit anhand seiner Funkposten und der Zeiten der bereits Angekommenen.`,
            html`<b>Verfolgen</b>: „Mein Verein“ (die Läufer deines Vereins, alle Kategorien), „Noch unterwegs“, „Alle Durchgänge“ der letzten 15
              Minuten und die deines Vereins, die das Handy bei jedem Durchgang vibrieren und klingeln lassen können.`,
            html`<b>Neue Durchgänge</b> sind grün (weniger als 3 Minuten), dann gelb (weniger als 9); eine Suche findet einen Läufer oder einen Verein.`,
            html`Sobald eine Zwischenzeit eintrifft, analysiert „Analyse“ den Lauf live.`,
          ])}`)}`,
      analyse: () => html`
        ${slide("Arena", "Laufanalyse", html`
          <p>Wenn Zwischenzeiten veröffentlicht sind, analysiert die Seite eines Laufs sie Bahn für Bahn in mehreren Ansichten: Tabelle, Rückstände,
            Durchgänge, Teilstrecken, Profil, Duell, Gruppen, Selbstständigkeit, Regelmäßigkeit und Bilanz.</p>`)}
        <section class="mx-slide">
          <p class="mx-kicker">Zwischenzeiten</p>
          <h2>Zeitverlust und Fehler</h2>
          ${list([
            html`Auf jeder Teilstrecke zwischen zwei Posten ist der <b>Zeitverlust</b> die Differenz zwischen der Zeit des Läufers und der Zeit, die sein übliches Tempo
              auf diesem Lauf erwarten ließ. Er ist negativ, wenn der Läufer schneller ist als üblich. Die Referenzzeit einer Teilstrecke ist der
              Mittelwert der schnellsten Zeiten (das schnellste Sechstel, ohne den Sieger), und das übliche Tempo die Zeit des Läufers auf den fehlerfrei
              gelaufenen Teilstrecken im Verhältnis zu deren Referenzzeiten: Eine lange Teilstrecke zählt dabei mehr als eine kurze, wie in MeOS.`,
            html`Ein <b>Fehler</b> ist eine Teilstrecke, auf der der Läufer mindestens 20 % der Zeit der Teilstrecke <b>und</b> mindestens 10 Sekunden verloren hat; beide
              Schwellen sind einstellbar. Die Spalten „Verloren“ und „Ohne Zeitverlust“ zählen nur die Fehler.`,
            html`Die <b>Rückstände</b> werden am „Superman“ gemessen, einem gedachten Läufer mit der besten Zeit auf jeder Teilstrecke, unter allen
              Läufern oder unter den verglichenen.`,
            html`Die <b>Gruppen</b> erkennen Läufer, die dieselben Posten im Abstand weniger Sekunden passieren, Posten für Posten.`,
          ])}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Zwischenzeiten</p>
          <h2>Durchgänge, Selbstständigkeit, Regelmäßigkeit, Zeitkontrolle</h2>
          ${list([
            html`Das <b>Durchgangsdiagramm</b> zeigt jeden Läufer zu der Uhrzeit, zu der er jeden Posten stempelt (seine Startzeit plus seine kumulierte Zeit):
              Linien, die zusammenlaufen, sind Läufer, die gemeinsam unterwegs sind; eine steilere Linie ist ein Läufer, der andere einholt.`,
            html`<b>Selbstständigkeit</b>, wer wem gefolgt ist: Auf jeder Teilstrecke werden zwei Läufer der Bahn, die denselben Posten im Abstand von weniger als
              20 Sekunden verlassen haben, auf der ganzen Strecke verglichen, wobei für jeden ein gleichmäßiges Tempo zwischen den beiden Posten angenommen wird.
              Weniger als 7 Sekunden auseinander laufen sie zusammen; von 7 bis 20 Sekunden immer weniger. Wer als Zweiter passiert, folgt dem anderen. Der
              Mitläufer-Index ist die hinten gelaufene Zeit minus die vorne gelaufene Zeit, im Verhältnis zur Laufzeit: positiv für einen Mitläufer, negativ
              für einen Hasen. Folgen spart Zeit (der andere liest die Karte und bahnt den Weg), deshalb lohnt es sich, es zu erkennen; beide Schwellen sind
              einstellbar.`,
            html`<b>Regelmäßigkeit</b>: Auf jeder Teilstrecke ist der Leistungsindex die Referenzzeit (der Mittelwert des besten Viertels der Zeiten)
              geteilt durch die Zeit des Läufers, 100 %, wenn er so schnell ist wie die Besten. Die Unregelmäßigkeit ist die Standardabweichung dieser Indizes,
              jede Teilstrecke mit ihrer Referenzzeit gewichtet, im Verhältnis zum mittleren Index des Läufers: Ein regelmäßiger Läufer hält von einer
              Teilstrecke zur nächsten das gleiche Tempo, ein unregelmäßiger wechselt zwischen guten Teilstrecken und Zögern. Die Streuung einer Teilstrecke,
              mit dem Niveau jedes Einzelnen herausgerechnet, zeigt die, auf denen alle geschwankt haben: die tückischen Teilstrecken. Nur Läufer, die mit
              allen Zeiten ins Ziel gekommen sind, zählen.`,
            html`Die <b>Zeitkontrolle</b> prüft die Zwischenzeiten selbst. Eine Teilstrecke mit negativer Zeit am selben Posten bei mindestens zwei
              Läufern verrät eine falsch gestellte Station (die dieses Postens oder des vorherigen): Sie verschiebt alle, die dort stempeln. Eine einzelne
              negative Teilstrecke verrät einen nicht gelöschten Chip, der die Stempel eines früheren Laufs behält. Ein klassierter Läufer ohne einen Posten,
              den die anderen gestempelt haben, hat ihn wohl vor seinem Start gestempelt, und die Software hat diesen Stempel verworfen. Der Veranstalter sieht
              das beim Hochladen seiner Ergebnisse, bevor er sie veröffentlicht; der Leser über den Analysen, und die betroffenen Zellen sind in der Tabelle
              umrandet.`,
          ])}
        </section>`,
    });
  }

  // ======================================================================================================
  // Coach
  // ======================================================================================================
  const COACH = [["solo", "Einzelanalyse"], ["multi", "Gruppenanalyse"], ...(owner ? [["definitions", "Postenbeschreibungen"], ["symboles", "Kartensymbole"]] : []),     // (the accounts named Le Helloco only, auth.owner)
    ["jeux", "Spiele"], ["vma", "MAG"], ...(admin ? [["routes", "Berechnete Routen"]] : [])];     // (a prototype, for the administrators)
  function coach() {
    return chapters(COACH, {
      solo: () => html`
        ${slide("Coach", "Einzelanalyse", html`
          <p>Die ${P("#/analyse-solo", "Einzelanalyse")} spielt deinen Lauf auf deiner Karte mit deinem GPS-Track ab. Zwei Reiter: ein Wettkampf (ein vergangener
            Lauf aus Arena, dessen veröffentlichte Zwischenzeiten die Kalibrierung verfeinern) oder ein Training, jede beliebige Einheit.</p>
          ${list([
            html`<b>Die Dateien</b>: die Karte (Bild, PDF, KMZ oder die OCAD- oder Mapper-Datei selbst), der Track (GPX, FIT oder TCX) und, falls vorhanden,
              die Kalibrierung der Karte (KMZ, Georeferenzierungsdatei) und die Bahnen als IOF XML. Auf dem Handy „Karte fotografieren“.`,
            html`<b>Die Kalibrierung</b> erfolgt automatisch: Die Bahn wird auf der Karte gelesen, der Track darübergelegt; liegt das Lesen daneben, korrigieren es ein paar Klicks.`,
            html`<b>Der Lauf</b> wird dann abgespielt, auf Wunsch im Vollbild, Teilstrecke für Teilstrecke, mit Zeitverlust, Tempo und den Kurven der
              Uhr (Herzfrequenz, Schrittfrequenz, Höhe …).`,
          ])}
          <p>Karte und Track werden in deinem Browser gelesen und verlassen ihn nicht; nur die Kalibrierung der Posten wird gespeichert, damit du die Analyse
            so wiederfindest, wie du sie verlassen hast.</p>`)}`,
      multi: () => html`
        ${slide("Coach", "Gruppenanalyse", html`
          <p>Die ${P("#/analyse-competition", "Gruppenanalyse")} zeigt nebeneinander die Tracks aller, die einen Wettkampf oder ein Training gelaufen sind, auf der Karte,
            die der Veranstalter vorbereitet hat (siehe die Dokumentation von ${M("orga", "Orga")}). Wähle den Lauf, füge deinen Track hinzu – er behält nur die
            Positionen und Uhrzeiten – und vergleiche. Du brauchst dafür ein Konto.</p>
          ${list([
            html`<b>Die Wiedergabe</b>, wie bei Livelox: echte Uhrzeit, Massenstart, Warten an den Posten, eine Teilstrecke nach der anderen.`,
            html`<b>Unter der Karte</b>: die Zwischenzeiten (bei einem Wettkampf die veröffentlichten), die Teilstrecken, die Rückstände, die Routenvarianten und
              bei einem Training die Übungen des Veranstalters (Korridor, Kompassstrecke).`,
            html`<b>Der Zugang</b>: alle Konten, die Mitglieder eines Vereins oder ein Passwort. Deine eigene Datei zeigt zudem deine Kurven neben der Karte,
              nur für dich.`,
          ])}`)}`,
      definitions: () => html`
        ${slide("Coach", "Postenbeschreibungen", html`
          <p>Die ${P("#/definitions", "Postenbeschreibungen")} stellen die IOF-Symbole Spalte für Spalte vor, jedes mit seiner Entsprechung auf der Karte,
            ihre Namen in 23 Sprachen und eine Suche. „Eine Beschreibungszeile lesen“ erklärt ein Beispiel Spalte für Spalte. Zum Üben blendest du
            die Namen aus, errätst die Beschreibung anhand der Karte oder die Karte anhand des Symbols.</p>`)}`,
      symboles: () => html`
        ${slide("Coach", "Kartensymbole", html`
          <p>Die ${P("#/symboles", "Kartensymbole")} sind die vollständige Legende einer Waldkarte (ISOM 2017-2), Farbe für Farbe: jedes Symbol mit
            Nummer, Name und Bedeutung, die nicht zu überquerenden markiert. „Was die Farben sagen“ erklärt, wie gut man je nach Grün laufen kann. Zum Üben
            blendest du die Namen oder die Zeichnungen aus.</p>`)}`,
      jeux: () => html`
        ${slide("Coach", "Zwölf Spiele zum Kartenlesen", html`
          <p>Die ${P("#/jeux", "Spiele")} werden auf Karten gespielt, die die Website für jede Runde neu zeichnet – ein Wald mit Relief und Vegetation, eine
            Stadt, ein Labyrinth – und auf ebenso gezeichneten „Fotos“ des Geländes. Nichts wird gesendet; die besten Scores bleiben im Browser.</p>
          ${list([
            html`<b>Routenwahl</b>: Schnelle Route (die kürzeste zeichnen), Bahnwahl (20 Sekunden Karte, 5 zum Wählen), Schnellste Gabelung,
              Routenwahl zwischen drei oder vier Routen.`,
            html`<b>Relief und Gelände lesen</b>: Höhenlinien, Bergauf oder bergab?, Gleiche Karten, Finde den Fehler, Trail'O.`,
            html`<b>Gedächtnis</b>: Kartengedächtnis, Fotogedächtnis und das Labyrinth, aus der Ich-Perspektive.`,
          ])}`)}`,
      vma: () => html`
        ${slide("Coach", "Die MAG", html`
          <p>Die Seite ${P("#/vma", "MAG")} stellt die Tests vor (im Labor, VAMEVAL, Léger-Boucher, halber Cooper-Test, Cooper-Test, Shuttle-Run, 45-15), berechnet
            die maximale aerobe Geschwindigkeit aus einem halben Cooper-Test (6 Minuten) oder einem Cooper-Test (12 Minuten) – die Bahn im Stadion zählt, ebenso
            die letzte unvollständige Runde –, leitet daraus die Trainingstempi ab und schlägt kostenlose Apps für die Tests vor.</p>`)}`,
      routes: () => html`
        ${slide("Coach · Test, Administratoren", "Die berechneten Routen", html`
          <p>In beiden GPS-Analysen kann ein Administrator Ozimut für jede Teilstrecke die schnellsten Routen auf der Karte vorschlagen lassen,
            mit Länge, Steigung und geschätzter Zeit – und mit demselben Modell die Route messen, die jeder Läufer genommen hat.
            In der ${P("#/analyse-solo", "Einzelanalyse")} werden alle Teilstrecken berechnet und eine Tabelle unter der Karte fasst sie zusammen; in
            der ${P("#/analyse-club", "Gruppenanalyse")} die angezeigte Teilstrecke, mit der Liste der Läufer. Es ist ein Prototyp: Die Routen folgen
            der Karte so, wie Ozimut sie liest, und dieses Lesen kann sich irren.</p>`)}
        ${slide("Coach · Test", "1. Die Karte anhand ihrer Farben lesen", html`
          <p>Die Karte ist ein Bild: Ozimut kennt nur ihre Farben. Jeder Punkt wird eingeordnet: Weiß (gut belaufbarer Wald), Gelb
            (offenes Gelände, mehr oder weniger licht), die drei Grüntöne nach ihrer Intensität, Oliv (Sperrgebiet) und die darübergedruckten „Druckfarben“ –
            Schwarz, Grau, Braun, Blau und das Violett der Bahn.</p>
          ${list([
            html`Eine Druckfarbe ist eine <b>Linie</b> oder eine <b>Fläche</b>, je nach ihrer Dicke im Vergleich zu den schwarzen Linien der Karte: Was übrig
              bleibt, wenn man die dünnen Linien entfernt, ist eine Fläche. Dickes Schwarz ist ein Gebäude oder eine große Felswand (unpassierbar), Grau ein
              Gebäude im Sprint oder blanker Fels im Wald, dickes Braun eine befestigte Fläche, dickes Blau Wasser.`,
            html`Die <b>dünnen schwarzen Linien</b>, die lang genug sind (30 m), oder die Striche eines gestrichelten Wegs bilden die Wege. Ein kurzer
              einzelner Strich (eine kleine Felswand, eine Ruine) oder Punkte (eine Vegetationsgrenze) zählen nicht dazu.`,
            html`Die <b>dünnen blauen Linien</b> sind die Bäche und, dicht beieinander, die Sümpfe. Höhenlinien, Bahn, Text und Punkte werden
              entfernt: Jeder Punkt nimmt die Farbe des nächstgelegenen Geländes darunter an.`,
            html`Die Karte wird dann in Zellen von etwa 1,5 m zerlegt, jede mit dem häufigsten Gelände. „Gelände wie gelesen anzeigen“
              zeigt diese Zellen auf der Karte: das Erste, was du prüfen solltest.`,
          ])}
          <p>Bekannte Grenzen: Das violett schraffierte Sperrgebiet wird mit der Bahn entfernt; ein schlecht belichtetes Foto verfälscht die Farben; dünne
            unpassierbare Felswände, Mauern und Zäune sind schwarze Linien wie die Wege (die Einstellung „Dünne schwarze Linien“ sagt, was sie
            sind).</p>`)}
        ${slide("Coach · Test", "1b. Besser: die OCAD- oder Mapper-Karte", html`
          <p>Die Datei der Karte selbst – OCAD (.ocd) oder OpenOrienteering Mapper (.omap, .xmap) – beschreibt das Gelände, ohne zu raten: Ozimut liest sie
            in deinem Browser mit der Engine der Bahnlegung und zeichnet jedes Symbol an seiner genauen Stelle.</p>
          ${list([
            html`Die <b>Flächen</b> nach ihrer Füllfarbe (oder Schraffur: blau für einen Sumpf, oliv oder violett für ein Sperrgebiet), Schicht für
              Schicht wie auf der Karte – ein Grün über einem Gelb gewinnt. Die Farbe statt der Nummer: ISOM 2000, ISOM 2017 und ISSprOM nummerieren
              unterschiedlich.`,
            html`Die <b>Linien</b> nach ihrer Nummer: Straßen, Fahrwege und Pfade (501 bis 508) sind Wege, durchgehend, auch wenn die Karte sie
              gestrichelt zeichnet; unpassierbare Felswände, Mauern und Zäune (201, 515, 518; 521 und 524 in ISOM 2000) stoppen den Läufer, außer
              dort, wo ein Weg sie quert; passierbare Mauern und Zäune und Vegetationsgrenzen sind Leitlinien; die blauen Linien sind
              Bäche.`,
            html`Höhenlinien, Punktsymbole, Texte und Bahn bleiben unberücksichtigt.`,
          ])}
          <p>In der Einzelanalyse <b>ist</b> eine allein abgelegte OCAD- oder Mapper-Datei die Karte: hier gezeichnet, der Track über ihre
            Georeferenzierung kalibriert. Zusammen mit einem Bild der Karte abgelegt – oder im Feld „Berechnete Routen“ gewählt, in beiden Analysen –
            dient sie den Routen und wird über ihre Georeferenzierung auf das Bild gelegt: Sie muss eine haben und die angezeigte Karte abdecken.</p>`)}
        ${slide("Coach · Test", "2. Die Zeit eines Schritts", html`
          <p>Die Zeit von einer Zelle zur benachbarten ist die Distanz, multipliziert mit der Langsamkeit des Geländes und der der Hangneigung:</p>
          ${list([
            html`<b>Das Gelände</b>: seine Geschwindigkeit als Anteil der im weißen Wald – Weg 125 %, offenes Gelände 110 %, halboffenes
              100 %, die drei Grüntöne 75, 45 und 20 %, Sumpf 65 %, befestigte Fläche 120 %. Wasser, Gebäude, Sperrgebiet (und Grau
              im Sprint) sind unpassierbar. Alles ist unter „Geschwindigkeit nach Gelände“ einstellbar.`,
            html`<b>Die Hangneigung</b>, gelesen aus dem Relief des IGN (RGE ALTI, in Frankreich) oder den „Terrain Tiles“ anderswo: Bergauf kostet jeder
              erstiegene Meter so viel wie 8 m in der Ebene (die Einstellung „1 m Steigung entspricht in der Ebene“); leicht bergab ist man etwas schneller (bis zu 9 %
              bei 15 % Gefälle), steiler bremst man (bei 30 % 29 % langsamer als in der Ebene).`,
            html`Die Schritte gehen in 16 Richtungen (die acht Nachbarn und die Rösselsprünge), womit eine gerade Linie auf 3 % genau nachgebildet wird.`,
          ])}
          <p>Diese Zeit gilt für ein Referenztempo im flachen weißen Wald: standardmäßig 6:00 min/km, oder das eingegebene, oder – wenn nichts eingegeben ist –
            das des Läufers: in der Einzelanalyse der Median, über seine Teilstrecken, seiner echten Zeit geteilt durch die Modellzeit auf seiner eigenen
            Route; in der Gruppenanalyse der Median der Läufer auf der Teilstrecke.</p>`)}
        ${slide("Coach · Test", "3. Die Navigationsvorsicht", html`
          <p>Das Kürzeste ist nicht immer das Sicherste: fern von jedem Anhaltspunkt, mitten im Wald, liest man die Karte öfter, wird langsamer, macht
            Fehler. Ozimut nennt <b>Leitlinien</b> die Wege, Bäche, Grenzen zwischen unterschiedlichem Gelände und die Ränder dessen, was aufhält
            (Wasser, Gebäude). Die Vorsicht schlägt auf die Kosten eines Schritts einen Teil seiner Zeit auf, der mit der Entfernung zur nächsten Leitlinie
            wächst, voll bei 50 m:</p>
          <p class="mx-eq">Kosten = Zeit × (1 + Vorsicht × Sichtbarkeit × min(1, Distanz / 50 m))</p>
          <p>Die Sichtbarkeit wiegt 1 im weißen Wald, 1,2 bis 1,4 in den Grüntönen, 0,3 im offenen Gelände, 0 auf einem Weg. Bei 20 % (der
            Standardeinstellung) kostet das Durchqueren eines Waldes ohne Anhaltspunkt bis zu einem Fünftel mehr; bei 0 % läuft man geradeaus wie ein Läufer,
            der sich nie irrt. Die Vorsicht wählt die Route; die angezeigten Zeiten bleiben die des reinen Laufens, ohne sie.</p>`)}
        ${slide("Coach · Test", "4. Die Varianten", html`
          <p>Route A ist die günstigste, gefunden durch eine A*-Suche in einer Ellipse um die Teilstrecke (breit genug, um einen See zu umgehen). Für die
            nächsten bestraft Ozimut den Korridor der bereits gefundenen Routen und sucht erneut; jeder Vorschlag wird dann ohne Strafe in einem Band um
            ihn herum gestrafft und nur behalten, wenn:</p>
          ${list([
            html`er von den vorherigen abweicht (mindestens 30 % seiner Strecke außerhalb ihrer Korridore);`,
            html`er nicht mehr kostet als A plus den gewählten Spielraum (standardmäßig 25 %);`,
            html`er <b>lokal optimal</b> ist: Kein Abschnitt von 30 % seiner Länge lässt sich um mehr als 1 % verkürzen – ein großer Bogen durch
              gleichförmigen Wald ist keine Wahl, ein Umweg über einen Weg oder um ein Grün schon.`,
          ])}
          <p>Jede Variante sagt, ob sie gegenüber der Linie zwischen den Posten links, rechts oder geradeaus verläuft.</p>`)}
        ${slide("Coach · Test", "5. Deine Route", html`
          <p>Der Track des Läufers zwischen zwei Posten wird mit demselben Modell gemessen und dann der nächstgelegenen Variante zugeordnet (im Mittel auf
            25 m genau, sonst „andere“). Die Tabelle der Einzelanalyse leitet daraus zwei Differenzen ab:</p>
          ${list([
            html`<b>Wahl</b>: die Modellzeit auf deiner Route minus die von Route A – was deine Wahl bei gleichem Laufen gekostet (oder gebracht)
              hat;`,
            html`<b>Ausführung</b>: deine echte Zeit minus die Modellzeit auf deiner Route – was das Laufen selbst gekostet hat (Zögern,
              Fehler, Gelände langsamer, als die Karte sagt).`,
          ])}
          <p>Mit dem automatischen Tempo ist die Ausführung im Median null: Sie zeigt, welche Teilstrecken langsamer oder schneller als üblich waren.</p>`)}`,
    });
  }

  // ======================================================================================================
  // Orga (« Die Bahnlegung », its other tab, is content/methods.*.js' tracerDoc)
  // ======================================================================================================
  const ORGA = [["qui", "Wer veranstaltet"], ["resultats", "Ergebnisse"], ["horaires", "Startzeiten"], ["direct", "Live-Übertragung"], ["suivi", "GPS-Tracking"],
    ["analyses", "Gruppenanalysen"], ["declarer", "Eingetragene Wettkämpfe"]];
  function orga() {
    return chapters(ORGA, {
      qui: () => html`
        ${slide("Orga", "Die Seiten der Veranstalter", html`
          <p>Orga ist für Vereine, die veranstalten; es wird bei der Registrierung, in den Einstellungen oder auf der Modulseite aktiviert und am Computer
            genutzt. Veranstalter eines Wettkampfs ist ${fr ? "jedes Mitglied seines veranstaltenden Vereins – des Vereins seines letzten bekannten Laufs – oder" : ""}
            das Konto, das ihn eingetragen hat, außerhalb Frankreichs. Ein Training dagegen kann jedes Konto anlegen.</p>
          ${list([
            html`${P("#/orga-competitions", "Wettkämpfe")} und ${P("#/orga-entrainements", "Trainings")}: die Gruppenanalysen vorbereiten.`,
            html`${P("#/orga-resultats", "Ergebnisse")} und ${P("#/orga-horaires", "Startzeiten")}: die Ergebnisse und die Startliste hochladen.`,
            html`${P("#/orga-direct", "Live-Übertragung")}: die Ergebnisse live aus der Zeitmessungssoftware übertragen und den Link zum GPS-Tracking angeben.`,
            html`${P("#/orga-tracer", "Bahnlegung")}: die Bahnen legen; die Anleitung dazu ist der Reiter ${D("tracer", "Die Bahnlegung")}.`,
          ])}`)}`,
      resultats: () => html`
        ${slide("Orga", "Die Ergebnisse hochladen", html`
          <p>Für einen Wettkampf deines Vereins zeigt ${P("#/orga-resultats", "Orga › Ergebnisse")}, was Arena schon davon hat, und
            „Ergebnisse hochladen“ fügt deine Datei hinzu, in drei Schritten:</p>
          <div class="mx-steps">
            <div class="mx-step"><b>Die Datei</b>Ein IOF-XML-Export deiner Software (am besten: Er enthält die Bahnen und die Zwischenzeiten),
              das HTML von OE oder MeOS oder ein PDF; gezippt oder nicht, höchstens 30 MB.</div>
            <div class="mx-step"><b>Die Prüfung</b>Die Datei wird in deinem Browser gelesen, nichts wird gesendet: Zusammenfassung, Ergebnisse Bahn für Bahn,
              Zeitkontrolle (falsch gestellte Stationen, nicht gelöschte Chips) und alle Ansichten der Laufanalyse.</div>
            <div class="mx-step"><b>Die Veröffentlichung</b>„Veröffentlichen“ sendet sie: Der Lauf erscheint innerhalb weniger Minuten in Arena, als vom
              Veranstalter hochgeladen markiert, und wird nicht mehr anderswo gesucht. Ein neuer Upload ersetzt den vorherigen.</div>
          </div>`)}`,
      horaires: () => html`
        ${slide("Orga", "Die Startzeiten veröffentlichen", html`
          <p>${P("#/orga-horaires", "Orga › Startzeiten")} veröffentlicht die Startliste eines kommenden Wettkampfs deines Vereins, bis zum Wettkampftag.
            Gelesene Dateien: IOF XML „StartList“ (am besten), CSV, eine Tabelle mit einem Spaltenpaar pro Bahn, HTML, PDF von OE oder MeOS oder ein
            geteilter Google-Sheets-Link.</p>
          ${list([
            html`Die Datei wird zuerst in deinem Browser gelesen und geprüft: zwei Läufer desselben Vereins direkt nacheinander, eine geteilte Startminute,
              Läufer ohne Startzeit, ohne Chip oder ohne Bahn, die Intervalle und die freien Startplätze.`,
            html`„Prüfen und exportieren“ schreibt auch die Startdatei für die App O Checklist.`,
            html`Nach der Veröffentlichung erscheint die Liste in Arena (die Startliste des Wettkampfs), und jeder Läufer, der es gewünscht hat, erhält seine
              Startzeit per Push-Mitteilung oder per E-Mail.`,
          ])}`)}`,
      direct: () => html`
        ${slide("Orga", "Live übertragen", html`
          <p>${P("#/orga-direct", "Orga › Live-Übertragung")} lässt deine Ergebnisse live in Arena erscheinen, ohne Umweg über liveresultat. Eine Übertragung
            wird mit einem Namen, einem Datum und, wenn möglich, dem Wettkampf eröffnet, zu dem sie gehört. Dann, nach Wahl:</p>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--s1)"><h3>Aus MeOS</h3><p>Der MeOS-Dienst „Online-Ergebnisse“ sendet seine Ergebnisse selbst an
              die Adresse, die Nummer und das Passwort, die die Seite angibt; die Zwischenzeiten der Funkposten folgen.</p></div>
            <div class="mx-box" style="--c:var(--s3)"><h3>Aus einer Datei</h3><p>Deine Software exportiert die Ergebnisliste alle paar Sekunden
              (IOF XML, HTML von OE oder MeOS); die Seite, geöffnet auf dem Computer im Wettkampfzentrum in Chrome oder Edge, liest diese Datei erneut und sendet, was sich ändert.</p></div>
          </div>
          <p>Einem Wettkampf zugeordnet, bleibt eine Übertragung nach dem Lauf erhalten: Ihre Ergebnisse, Zwischenzeiten und Startliste bleiben
            in Arena. Es ist noch eine Testversion: zuerst bei einem Training ausprobieren oder parallel zum üblichen Live-Dienst.</p>`)}`,
      suivi: () => html`
        ${slide("Orga", "Das GPS-Tracking", html`
          <p>Ozimut verfolgt keinen Läufer per GPS. Wenn dein Wettkampf einen Tracking-Dienst nutzt (Loggator, GPSSeuranta, TracTrac, Livelox,
            Routechoices …), gib seinen Link in ${P("#/orga-direct", "Orga › Live-Übertragung")} an: Er erscheint beim Wettkampf in Arena, mit seinen Ergebnissen
            und seinem Live-Bereich. Nur der Link wird veröffentlicht.</p>`)}`,
      analyses: () => html`
        ${slide("Orga", "Eine Gruppenanalyse vorbereiten", html`
          <p>In ${P("#/orga-competitions", "Wettkämpfe")} (die Wettkämpfe deines Vereins der letzten 60 Tage) oder ${P("#/orga-entrainements", "Trainings")}
            („Neues Training“) wird eine Gruppenanalyse Bahn für Bahn vorbereitet:</p>
          ${list([
            html`<b>Die Karte</b>: ein Bild, ein PDF oder ein KMZ, unverändert gespeichert, ohne Qualitätsverlust.`,
            html`<b>Ihre Kalibrierung</b>: aus einem KMZ, einer Georeferenzierungsdatei, einem IOF XML mit Koordinaten oder deinem eigenen Track.`,
            html`<b>Die Bahn</b>: auf der Karte gelesen, die Reihenfolge der Posten aus dem IOF XML der Bahnen, aus deinem Track oder aus deinen Klicks.`,
            html`<b>Der Zugang</b>: alle Konten, die Mitglieder des Vereins oder ein Passwort. „Aus Läufersicht ansehen“ zeigt die Seite so, wie sie sie
              sehen werden.`,
          ])}
          <p>Die Läufer finden sie in Coach („Gruppenanalyse“). Die Bahnlegung kann ihre Bahnen auch samt Karte in eine Gruppenanalyse veröffentlichen (bei einem
            Wettkampf nach dem Lauf).</p>`)}`,
      declarer: () => html`
        ${slide("Orga", "Einen Wettkampf eintragen, außerhalb Frankreichs", html`
          <p>Die französischen Wettkämpfe kommen aus dem Kalender ${fr ? "der FFCO" : "des französischen Verbands"}. In den anderen Ländern trägt ein Konto, das Mitglied des Landes ist, seinen
            Wettkampf selbst ein, im Kasten „Meine eingetragenen Wettkämpfe“ der Seiten Ergebnisse, Startzeiten und Wettkämpfe: Land, Verein, Name, Datum, Ort,
            Disziplin, Format, Website. Er erscheint dann in Arena bei den Wettkämpfen seines Landes, und sein Veranstalter kann dort Startliste,
            Ergebnisse und Analysen hochladen. Wer ihn eingetragen hat, wird nicht veröffentlicht.</p>`)}`,
    });
  }

  const LABELS = { site: "Die Website", arena: "Die Wettkämpfe", coach: "Coach", orga: "Die Werkzeuge" };
  return { LABELS, LEDE, ARENA, COACH, ORGA, site, arena, coach, orga };
}
