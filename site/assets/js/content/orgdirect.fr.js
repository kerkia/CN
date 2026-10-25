// « Organisation › Direct » (pages/orgdirect.js): how it works, in French; orgdirect.en.js in step. One text per part of
// the page (owner, 2026-10-25: the MeOS and the file instructions were one block, « Le jour de la course » read as if it
// were MeOS's too): `meos` and `file` are shown only for the way the organiser chose in step 2, `after` with step 3.

// the page's three steps, at its top
export const overview = `
  <ol class="od-overview">
    <li><b>La course</b> : choisissez-la ou créez-la, une fois.</li>
    <li><b>L'envoi des résultats</b> : choisissez votre logiciel, <b>MeOS</b> ou <b>un autre</b>. Seules les instructions de votre
      choix s'affichent : les deux façons ne se combinent pas.</li>
    <li><b>Après la course</b> : liée à une compétition de votre club, la course reste dans « Résultats ».</li>
  </ol>`;

// what both ways share, under the choice
export const common = `Dans les deux cas, rien n'est à déclarer à l'avance : les circuits, les catégories, les postes et les coureurs
  viennent de votre logiciel, et un circuit qui apparaît en cours de course est ajouté. Les coureurs sont reconnus par leur nom
  et leur club, et reliés à leur page sur Ozimut.`;

export const meos = `
  <p class="od-what">MeOS envoie lui-même ses résultats, ses postes radio et ses temps intermédiaires à Ozimut.
    <b>Il n'y a rien à laisser ouvert sur Ozimut</b>, ni fichier à choisir : seul MeOS doit rester connecté à internet.</p>
  <h3>Dans MeOS</h3>
  <ol class="od-steps">
    <li>Onglet <b>Services</b>, ajoutez le service <b>Résultats en ligne</b>.</li>
    <li>Cochez « Envoyer sur le web » et recopiez les trois valeurs ci-dessous : l'adresse (URL), l'« Identifiant de la
      compétition » (le numéro) et le « Mot de passe ». Format d'export : « MeOS Online Protocol XML 2.0 ». Un intervalle de 10 à
      15 secondes convient.</li>
    <li>Sous « Postes », cochez les postes radio : leurs temps arrivent en direct. Cochez aussi <b>« Envoyer tous les poinçons
      après lecture de la puce »</b> : à chaque arrivée, tous les temps intermédiaires du coureur sont publiés.</li>
    <li>Cliquez sur « Démarrer » dans MeOS. Il envoie d'abord toute la course, puis seulement ce qui change ; la dernière
      réception s'affiche sous les valeurs.</li>
  </ol>
  <p class="od-tip">Faites un essai la veille, avec la course en préparation : les coureurs apparaissent dans « En direct » avant
    même le départ, et leurs heures de départ dans l'« Agenda ».</p>`;

export const file = `
  <p class="od-what">Pour OE (SportSoftware), un autre logiciel, ou MeOS sans son service « Résultats en ligne » : le logiciel
    exporte la liste des résultats dans un fichier, et <b>cette page, laissée ouverte sur l'ordinateur de l'arène, relit ce fichier</b>
    et l'envoie à Ozimut.</p>
  <h3>Avant la course</h3>
  <ol class="od-steps">
    <li>Dans votre logiciel de chronométrage, programmez un <b>export automatique de la liste des résultats</b> vers un fichier,
      toutes les 15 à 30 secondes, toujours au même endroit et sous le même nom.
      <ul>
        <li>Le format conseillé est l'<b>IOF XML 3.0</b> (liste de résultats) : il contient les heures de départ, les temps
          intermédiaires et les coureurs encore en course.</li>
        <li>Les listes de résultats HTML de MeOS et d'OE sont aussi lues, mais elles ne montrent que les coureurs arrivés ou
          sortis de course.</li>
        <li>Si votre logiciel ne sait pas exporter à intervalle régulier, exportez le fichier à la main de temps en temps, sous le
          même nom : la page reprend chaque nouvelle version.</li>
      </ul></li>
    <li>Faites un essai la veille, avec le fichier d'une course passée ou de la course en préparation.</li>
  </ol>
  <h3>Le jour de la course</h3>
  <ol class="od-steps">
    <li>Sur l'ordinateur de l'arène, relié à internet, ouvrez cette page dans <b>Chrome ou Edge</b> (Firefox et Safari ne
      permettent pas à une page de relire un fichier toute seule), connecté avec le compte qui a créé la course à l'étape 1 :
      seul ce compte peut l'alimenter.</li>
    <li>Choisissez le fichier exporté ci-dessous, <b>une seule fois</b>. Le navigateur demande l'autorisation de le lire.</li>
    <li>Cliquez sur « Démarrer ». La page relit le fichier toute seule, toutes les 15 secondes par défaut, et n'envoie que ce qui
      a changé.</li>
    <li>Laissez la page ouverte, de préférence dans sa propre fenêtre, et l'ordinateur allumé, sans mise en veille. Si la page est
      rechargée, un clic sur « Reprendre » suffit.</li>
  </ol>`;

export const after = `
  <ul class="od-steps">
    <li>Une course liée à une compétition de votre club est enregistrée toutes les quelques minutes et publiée dans
      <b>Courses › Résultats</b> : les résultats, les temps intermédiaires (dans « Analyse de course ») et, avant le départ, la liste
      de départ. Les coureurs reçoivent l'alerte « une de mes courses est en ligne » une fois la course finie.</li>
    <li>« Publier maintenant » l'enregistre tout de suite, sans attendre la mise à jour suivante.</li>
    <li>Un fichier de résultats déposé ensuite sous <b>Organisation › Résultats</b> passe avant la diffusion, de même que la liste de
      départ déposée sous « Horaires ».</li>
    <li>Une course créée sans compétition peut y être liée plus tard, ici même : seuls les membres du club organisateur le
      peuvent. Sans compétition, elle n'est visible que dans « En direct ».</li>
  </ul>`;
