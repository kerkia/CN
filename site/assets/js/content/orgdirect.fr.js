// « Organisation › Direct » (pages/orgdirect.js): how it works, in French; orgdirect.en.js in step.
export const steps = `
  <h3 style="margin:0 0 6px">Avec MeOS : les résultats en ligne</h3>
  <ol class="od-steps">
    <li>Choisissez la course ci-dessous, ou créez-la en choisissant la <b>compétition de votre club</b> : la diffusion est alors
      aussi publiée dans « Résultats » (voir « Après la course »). La carte « Depuis MeOS » donne trois valeurs : l'adresse, le
      numéro de la compétition et son mot de passe.</li>
    <li>Dans MeOS, onglet <b>Services</b>, ajoutez le service <b>Résultats en ligne</b>. Cochez « Envoyer sur le web » et recopiez
      l'adresse (URL), l'« Identifiant de la compétition » et le « Mot de passe ». Format d'export : « MeOS Online Protocol XML 2.0 ».
      Un intervalle de 10 à 15 secondes convient.</li>
    <li>Sous « Postes », cochez les postes radio : leurs temps arrivent en direct. Cochez aussi <b>« Envoyer tous les poinçons après
      lecture de la puce »</b> : à chaque arrivée, tous les temps intermédiaires du coureur sont publiés.</li>
    <li>Cliquez sur « Démarrer ». MeOS envoie d'abord toute la course, puis seulement ce qui change. La carte « Depuis MeOS » indique la
      dernière réception. Il n'y a rien à laisser ouvert sur Ozimut : seul MeOS doit rester connecté à internet.</li>
    <li>Faites un essai la veille, avec la course en préparation : les coureurs apparaissent dans « En direct » avant même le
      départ, et leurs heures de départ dans l'« Agenda ».</li>
  </ol>
  <h3 style="margin:14px 0 6px">Avec un autre logiciel : avant la course</h3>
  <ol class="od-steps">
    <li>Dans votre logiciel de chronométrage, programmez un <b>export automatique de la liste des résultats</b> vers un fichier,
      toutes les 15 à 30 secondes, toujours au même endroit et sous le même nom.
      <ul>
        <li>Le format conseillé est l'<b>IOF XML 3.0</b> (liste de résultats) : il contient les heures de départ, les temps
          intermédiaires et les coureurs encore en course.</li>
        <li>Les listes de résultats HTML de MeOS et d'OE (SportSoftware) sont aussi lues, mais elles ne montrent que les coureurs
          arrivés ou sortis de course.</li>
        <li>Si votre logiciel ne sait pas exporter à intervalle régulier, exportez le fichier à la main de temps en temps, sous le même
          nom : la page reprend chaque nouvelle version.</li>
      </ul></li>
    <li>Faites un essai la veille, avec le fichier d'une course passée ou de la course en préparation.</li>
  </ol>
  <h3 style="margin:14px 0 6px">Le jour de la course</h3>
  <ol class="od-steps" start="3">
    <li>Sur l'ordinateur de l'arène, relié à internet, ouvrez cette page dans <b>Chrome ou Edge</b>. Firefox et Safari ne permettent
      pas à une page de relire un fichier toute seule.</li>
    <li>Connectez-vous à Ozimut avec le compte qui crée la diffusion : seul ce compte peut ensuite l'alimenter. Vous pouvez la
      créer la veille, d'ici ou d'un autre ordinateur.</li>
    <li>Choisissez la course ci-dessous, ou créez-la : choisissez la compétition de votre club, ou donnez son nom, sa date et
      l'organisateur.</li>
    <li>Choisissez le fichier exporté, <b>une seule fois</b>. Le navigateur demande l'autorisation de le lire.</li>
    <li>Cliquez sur « Démarrer ». La page relit le fichier toute seule, toutes les 15 secondes par défaut, et n'envoie que ce qui a
      changé.</li>
    <li>Laissez la page ouverte, de préférence dans sa propre fenêtre, et l'ordinateur allumé, sans mise en veille. Si la page est
      rechargée, un clic sur « Reprendre » suffit.</li>
  </ol>
  <h3 style="margin:14px 0 6px">Après la course : « Résultats »</h3>
  <ul class="od-steps">
    <li>Une diffusion liée à une compétition de votre club est enregistrée toutes les quelques minutes et publiée dans
      <b>Courses › Résultats</b> : les résultats, les temps intermédiaires (dans « Analyse de course ») et, avant le départ, la liste
      de départ. Les coureurs reçoivent l'alerte « une de mes courses est en ligne » une fois la course finie.</li>
    <li>« Publier maintenant » enregistre la diffusion tout de suite, sans attendre la mise à jour suivante.</li>
    <li>Un fichier de résultats déposé ensuite sous <b>Organisation › Résultats</b> passe avant la diffusion, de même que la liste de
      départ déposée sous « Horaires ».</li>
    <li>Une diffusion créée sans compétition peut y être liée plus tard, ici même : seuls les membres du club organisateur le
      peuvent.</li>
  </ul>
  <h3 style="margin:14px 0 6px">Ce qu'il n'y a pas à faire</h3>
  <ul class="od-steps">
    <li>Les circuits, les catégories, les postes et les coureurs n'ont pas à être déclarés : ils viennent du fichier, et un circuit qui
      apparaît en cours de course est ajouté.</li>
    <li>Les coureurs sont reconnus par leur nom et leur club, et reliés à leur page sur Ozimut.</li>
  </ul>
  <p style="margin:12px 0 0">Les spectateurs suivent la course dans <b>Courses › En direct</b> : le lien apparaît plus bas une fois la
    course choisie.</p>`;
