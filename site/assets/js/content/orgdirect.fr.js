// « Organisation › Direct » (pages/orgdirect.js): how it works, in French; orgdirect.en.js in step.
export const steps = `
  <h3 style="margin:0 0 6px">Avant la course</h3>
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
    <li>Connectez-vous à O'CN avec le compte qui crée la diffusion : seul ce compte peut ensuite l'alimenter. Vous pouvez la
      créer la veille, d'ici ou d'un autre ordinateur.</li>
    <li>Choisissez la course ci-dessous, ou créez-la : son nom, sa date et l'organisateur suffisent.</li>
    <li>Choisissez le fichier exporté, <b>une seule fois</b>. Le navigateur demande l'autorisation de le lire.</li>
    <li>Cliquez sur « Démarrer ». La page relit le fichier toute seule, toutes les 15 secondes par défaut, et n'envoie que ce qui a
      changé.</li>
    <li>Laissez la page ouverte, de préférence dans sa propre fenêtre, et l'ordinateur allumé, sans mise en veille. Si la page est
      rechargée, un clic sur « Reprendre » suffit.</li>
  </ol>
  <h3 style="margin:14px 0 6px">Ce qu'il n'y a pas à faire</h3>
  <ul class="od-steps">
    <li>Les circuits, les catégories, les postes et les coureurs n'ont pas à être déclarés : ils viennent du fichier, et un circuit qui
      apparaît en cours de course est ajouté.</li>
    <li>Les coureurs sont reconnus par leur nom et leur club, et reliés à leur page sur O'CN.</li>
  </ul>
  <p style="margin:12px 0 0">Les spectateurs suivent la course dans <b>Courses › En direct</b> : le lien apparaît plus bas une fois la
    course choisie.</p>`;
