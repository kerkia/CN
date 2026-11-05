// « Organisation › Direct » (pages/orgdirect.js): how it works, in German; orgdirect.fr.js is the reference. One text per
// part of the page (owner, 2026-10-25: the MeOS and the file instructions were one block, « Le jour de la course » read as if
// it were MeOS's too): `meos` and `file` are shown only for the way the organiser chose in step 2, `after` with step 3.

// the page's three steps, at its top
export const overview = `
  <ol class="od-overview">
    <li><b>Der Lauf</b>: Wähle ihn aus oder erstelle ihn, einmalig.</li>
    <li><b>Das Senden der Ergebnisse</b>: Wähle deine Software, <b>MeOS</b> oder <b>eine andere</b>. Nur die Anleitung für deine
      Wahl wird angezeigt: Die beiden Wege lassen sich nicht kombinieren.</li>
    <li><b>Nach dem Lauf</b>: Mit einem Wettkampf deines Vereins verknüpft, bleibt der Lauf unter „Ergebnisse“.</li>
  </ol>`;

// what both ways share, under the choice
export const common = `In beiden Fällen muss nichts im Voraus angegeben werden: Bahnen, Kategorien, Posten und Läufer
  kommen aus deiner Software, und eine Bahn, die während des Laufs auftaucht, wird hinzugefügt. Die Läufer werden an Name
  und Verein erkannt und mit ihrer Seite auf Ozimut verknüpft.`;

export const meos = `
  <p class="od-what">MeOS sendet seine Ergebnisse, Funkposten und Zwischenzeiten selbst an Ozimut.
    <b>Auf Ozimut muss nichts geöffnet bleiben</b>, und es ist keine Datei auszuwählen: Nur MeOS muss mit dem Internet verbunden bleiben.</p>
  <h3>In MeOS</h3>
  <ol class="od-steps">
    <li>Füge im Reiter <b>Dienste</b> (Services) den Dienst <b>Online-Ergebnisse</b> (Online Results) hinzu.</li>
    <li>Hake „Ins Web senden“ (Send to the web) an und übernimm die drei Werte unten: die Adresse (URL), die „Wettkampf-ID“
      (Competition ID number, die Nummer) und das „Passwort“ (Password). Exportformat: „MeOS Online Protocol XML 2.0“. Ein Intervall von 10 bis
      15 Sekunden passt.</li>
    <li>Hake unter „Posten“ (Controls) die Funkposten an: Ihre Zeiten kommen live an. Hake auch <b>„Alle Stempel nach dem Auslesen des Chips
      senden“</b> (Send all punches after card readout) an: Bei jedem Zieleinlauf werden alle Zwischenzeiten des Läufers veröffentlicht.</li>
    <li>Klicke in MeOS auf „Starten“ (Start). Es sendet zuerst den ganzen Lauf, dann nur noch die Änderungen; der letzte
      Empfang wird unter den Werten angezeigt.</li>
  </ol>
  <p class="od-tip">Mach am Vortag einen Test mit dem Lauf in Vorbereitung: Die Läufer erscheinen unter „Live“ schon
    vor dem Start und ihre Startzeiten im „Kalender“.</p>`;

export const file = `
  <p class="od-what">Für OE (SportSoftware), eine andere Software oder MeOS ohne seinen Dienst „Online-Ergebnisse“: Die Software
    exportiert die Ergebnisliste in eine Datei, und <b>diese Seite, auf dem Computer im Wettkampfzentrum geöffnet gelassen, liest diese Datei immer wieder neu</b>
    und sendet sie an Ozimut.</p>
  <h3>Vor dem Lauf</h3>
  <ol class="od-steps">
    <li>Richte in deiner Zeitmessungssoftware einen <b>automatischen Export der Ergebnisliste</b> in eine Datei ein,
      alle 15 bis 30 Sekunden, immer an denselben Ort und unter demselben Namen.
      <ul>
        <li>Das empfohlene Format ist <b>IOF XML 3.0</b> (Ergebnisliste): Es enthält die Startzeiten, die
          Zwischenzeiten und die Läufer, die noch unterwegs sind.</li>
        <li>Die HTML-Ergebnislisten von MeOS und OE werden ebenfalls gelesen, sie zeigen aber nur die Läufer, die im Ziel oder
          ausgeschieden sind.</li>
        <li>Wenn deine Software nicht in regelmäßigen Abständen exportieren kann, exportiere die Datei ab und zu von Hand, unter
          demselben Namen: Die Seite übernimmt jede neue Version.</li>
      </ul></li>
    <li>Mach am Vortag einen Test mit der Datei eines vergangenen Laufs oder des Laufs in Vorbereitung.</li>
  </ol>
  <h3>Am Wettkampftag</h3>
  <ol class="od-steps">
    <li>Öffne auf dem Computer im Wettkampfzentrum, mit dem Internet verbunden, diese Seite in <b>Chrome oder Edge</b> (Firefox und Safari
      erlauben einer Seite nicht, eine Datei selbstständig neu zu lesen), angemeldet mit dem Konto, das den Lauf in Schritt 1 erstellt hat:
      Nur dieses Konto kann ihn beliefern.</li>
    <li>Wähle unten die exportierte Datei aus, <b>ein einziges Mal</b>. Der Browser fragt nach der Erlaubnis, sie zu lesen.</li>
    <li>Klicke auf „Starten“. Die Seite liest die Datei selbstständig neu, standardmäßig alle 15 Sekunden, und sendet nur, was
      sich geändert hat.</li>
    <li>Lass die Seite geöffnet, am besten in einem eigenen Fenster, und den Computer eingeschaltet, ohne Ruhezustand. Wird die Seite
      neu geladen, genügt ein Klick auf „Fortsetzen“.</li>
  </ol>`;

export const after = `
  <ul class="od-steps">
    <li>Ein Lauf, der mit einem Wettkampf deines Vereins verknüpft ist, wird alle paar Minuten gespeichert und unter
      <b>Läufe › Ergebnisse</b> veröffentlicht: die Ergebnisse, die Zwischenzeiten (in der „Analyse“) und vor dem Start die
      Startliste. Die Läufer erhalten die Benachrichtigung „einer meiner Läufe ist online“, sobald der Lauf beendet ist.</li>
    <li>„Jetzt veröffentlichen“ speichert ihn sofort, ohne auf die nächste Aktualisierung zu warten.</li>
    <li>Eine danach unter <b>Organisation › Ergebnisse</b> hochgeladene Ergebnisdatei hat Vorrang vor der Übertragung, ebenso die unter
      „Startzeiten“ hochgeladene Startliste.</li>
    <li>Ein ohne Wettkampf erstellter Lauf kann später mit einem verknüpft werden, genau hier: Nur die Mitglieder des veranstaltenden Vereins
      können das. Ohne Wettkampf ist er nur unter „Live“ sichtbar.</li>
  </ul>`;
