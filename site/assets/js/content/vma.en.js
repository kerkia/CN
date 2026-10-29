// The MAS (VMA) page's long texts in English (pages/vma.js); vma.fr.js is the reference.
const ext = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const row = (name, where, how, result) => `<tr><td><b>${name}</b></td><td>${where}</td><td>${how}</td><td>${result}</td></tr>`;

export const howTo = `
  <section class="card"><div class="card-head"><h2>How to run the test</h2></div>
    <div class="card-body vma-text">
      <ul>
        <li><b>Warm up</b> for 15 to 20 minutes, with a few strides.</li>
        <li><b>Run at an even pace</b>: starting too fast costs more than it gains. Aim for a time per lap, and speed up in the last minute if you have something left.</li>
        <li><b>Count your laps</b> (or have someone count them) and note where you are at the final signal: the track's marks every 100 m, or cones every 20 or 50 m, give the metres of the last lap.</li>
        <li><b>Stay in the same lane</b>: the first, along the kerb, is the shortest. A lap in lane 2 is already 7 m longer.</li>
        <li><b>The phone's timer</b>, set to 6 or 12 minutes, is enough: it sounds the end.</li>
        <li><b>Repeat it in the same conditions</b> (track, weather, form) every two or three months to follow your progress.</li>
      </ul>
      <p class="muted">A maximal test requires good health: if in doubt, ask a doctor.</p>
    </div></section>`;

export const methods = `
  <section class="card" style="margin-bottom:16px"><div class="card-body vma-text">
    <p><b>MAS</b> (maximal aerobic speed, « VMA » in French) is the lowest running speed at which one reaches one's maximal
      oxygen uptake (VO2max). It can be held for about 4 to 8 minutes. It is mostly used to set one's training paces, as a
      percentage of MAS. Three families of tests estimate it:</p>
    <ul>
      <li><b>In the laboratory</b>, on a treadmill with analysis of the gases breathed: the reference, which also measures VO2max.</li>
      <li><b>In the field, guided by beeps</b> (“incremental” tests): the speed increases in stages and beeps set the pace; MAS is
        the speed of the last stage held. No need to know how to pace yourself.</li>
      <li><b>In the field, over a fixed time</b> (6 or 12 minutes): the longest distance possible; MAS follows from the average
        speed. Nothing but a track and a stopwatch, but you must be able to run evenly.</li>
    </ul>
  </div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>The main tests</h2></div>
    <div class="table-wrap"><table class="data compact vma-methods"><thead><tr><th>Test</th><th>Where</th><th>How it runs</th><th>Result</th></tr></thead>
      <tbody>
        ${row("VAMEVAL (Cazorla and Léger)", "200 or 400 m track, cones every 20 m",
          "Start at 8 km/h, +0.5 km/h every minute; you must be at a cone at each beep. Stop when you fall too far behind on two cones in a row.",
          "MAS = speed of the last stage completed. The most accurate and most widespread field test.")}
        ${row("Léger-Boucher (Université de Montréal, 1980)", "400 m track, cones every 50 m",
          "2-minute stages, the speed rising at each stage (1 km/h in the usual French versions, starting at about 8 km/h; 0.5 km/h in the original version).",
          "MAS = speed of the last stage. Long stages: harder than the VAMEVAL.")}
        ${row("Half Cooper (6 minutes)", "Track",
          "The longest distance possible in 6 minutes, at an even pace.",
          "MAS ≈ distance (m) ÷ 100. Simple and close to MAS; requires good pacing.")}
        ${row("Cooper (12 minutes, 1968)", "Track",
          "The longest distance possible in 12 minutes.",
          "It is run below MAS: MAS ≈ distance ÷ 200 ÷ 0.95 (well trained), ÷ 0.90 (moderately) or ÷ 0.85 (little trained). The rule “distance ÷ 200” alone underestimates it; Cooper's formula for VO2max, (distance − 504.9) ÷ 44.73, underestimates trained runners.")}
        ${row("Luc Léger shuttle (20 m)", "Gym or field, two lines 20 m apart",
          "Back and forth, starting at 8.5 km/h, +0.5 km/h every minute.",
          "The turns slow you down: the speed reached is below track MAS. Good for VO2max, to be converted for paces.")}
        ${row("45-15 (Gacon)", "Track, cones every 6.25 m",
          "45 s running, 15 s recovery; 100 m in 45 s at the start (8 km/h), then one cone further at each stage (+0.5 km/h).",
          "An “intermittent” MAS, higher than continuous MAS: it is used to set short interval sessions.")}
      </tbody></table></div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Which one to choose?</h2></div><div class="card-body vma-text">
    <ul>
      <li><b>Alone on a track, with no equipment</b>: the half Cooper, and this page's calculator.</li>
      <li><b>Alone or in a group, with a phone and cones</b>: the VAMEVAL, with an app that plays the beeps (see the Apps tab);
        no pacing to manage.</li>
      <li><b>In a gym</b>: the Luc Léger shuttle, bearing in mind that it underestimates track MAS.</li>
      <li>MAS can also be estimated from a race time (a 10 km is run at about 85 to 90% of MAS), but it is approximate: nothing
        beats a test.</li>
    </ul>
    <p class="muted">Sources: ${ext("https://www.topendsports.com/testing/tests/vameval.htm", "VAMEVAL")},
      ${ext("https://www.topendsports.com/testing/tests/track-test.htm", "Université de Montréal Track Test")},
      ${ext("https://www.topendsports.com/testing/tests/gacon.htm", "Gacon test")} (Topend Sports);
      ${ext("https://www.aeeps.org/ajouter-un-fichier/doc_download/3071-.html", "MAS tests sheet")} by AEEPS (in French).</p>
  </div></section>`;

const APPS = [
  { name: "EZ BIPsVMA", test: "VAMEVAL (cones every 20 m) and Luc Léger shuttle",
    where: "Web app: opens in any phone's browser, installs on the home screen and works offline.",
    links: [["https://bips.ezapps.be/", "bips.ezapps.be"]],
    note: "The simplest for a VAMEVAL on a track: place cones every 20 m, start the beeps." },
  { name: "EPS Test VMA", test: "Léger-Boucher (cones every 50 m, 2-minute stages)",
    where: "Android and iPhone / iPad, free, no in-app purchase.",
    links: [["https://play.google.com/store/apps/details?id=com.GrangerM.testvma", "Google Play"],
      ["https://apps.apple.com/fr/app/eps-test-vma/id6466824820", "App Store"]],
    note: "Designed for PE teachers; also works for a runner alone. In French." },
];
const SHUTTLE = [
  { name: "VMA Test (Beep test, PACER)", links: [["https://play.google.com/store/apps/details?id=com.victormeunier.vmatest", "Google Play"]] },
  { name: "BeepRun: Luc Léger test & MAS", links: [["https://apps.apple.com/fr/app/beeprun-test-luc-l%C3%A9ger-vma/id1411308819", "App Store"]] },
];
export const apps = `
  <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>For a track test</h2>
    <div class="hint">Free; the phone plays the beeps that set the pace at each cone</div></div></div>
    <div class="card-body vma-apps">${APPS.map((a) => `<div class="vma-app">
      <h3>${a.name}</h3>
      <div><b>Test:</b> ${a.test}</div>
      <div>${a.where}</div>
      <div class="muted">${a.note}</div>
      <div class="row">${a.links.map(([u, l]) => `<a class="btn btn-sm" href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`).join("")}</div>
    </div>`).join("")}</div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Without an app</h2></div><div class="card-body vma-text">
    <p>The <b>half Cooper</b> and the <b>Cooper</b> need none: the phone's timer set to 6 or 12 minutes, the number of laps and
      the metres of the last lap are enough, then this page's calculator. A GPS watch measures a track badly (1 to 3% error):
      count the laps.</p>
    <p><b>Tips</b>: a Bluetooth speaker if there are several of you; the volume at maximum and the screen kept awake; cones placed
      with a tape measure, the track's finish line as the mark for the first.</p>
  </div></section>
  <section class="card"><div class="card-head"><div><h2>In a gym: the 20 m shuttle</h2>
    <div class="hint">Not a track test: the speed reached is below MAS (see the Methods tab)</div></div></div>
    <div class="card-body vma-text"><ul>${SHUTTLE.map((a) => `<li><b>${a.name}</b> — ${a.links.map(([u, l]) => ext(u, l)).join(", ")}</li>`).join("")}</ul></div></section>`;
