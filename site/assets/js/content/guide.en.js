// The Documentation's guide to the site, in English (guide.fr.js is the reference: the same structure, the same chapters).
// build(X) receives the page's helpers and returns the four tabs' chapters and builders: « The site », « Races »,
// « Training », « Organising ». A page is named as the English menu names it, with a link.
export function build(X) {
  const { html, raw, subTabs, fr = true } = X;
  // a page of the site, as the menus name it
  const P = (href, label) => html`<a href="${href}">${label}</a>`;
  // another tab of the Documentation
  const D = (tab, label, goto) => html`<a href="#/documentation?onglet=${tab}${goto ? `&voir=${goto}` : ""}" data-tab-link="${tab}"${raw(goto ? ` data-goto="${goto}"` : "")}>${label}</a>`;
  const chapters = (list, CH) => raw(subTabs(list, list[0][0]).s.replace(/<div data-subpanel="([a-z]+)"( hidden)?><\/div>/g, (m0, k, hid) =>
    `<div data-subpanel="${k}"${hid || ""}>${CH[k]().s}</div>`));
  const slide = (kicker, title, body, id) => html`<section class="mx-slide"${raw(id ? ` id="${id}"` : "")}><p class="mx-kicker">${kicker}</p><h2>${title}</h2>${body}</section>`;
  const list = (items) => html`<ul class="mx-list">${items.filter(Boolean).map((i) => html`<li><span>${i}</span></li>`)}</ul>`;

  // ======================================================================================================
  // The site
  // ======================================================================================================
  const SITE = [["menus", "The menus"], ["pays", "Country and language"], ["compte", "Account and alerts"], ["telephone", "On your phone"]];
  function site() {
    return chapters(SITE, {
      menus: () => html`
        ${slide("The site", "Four parts", html`
          <p>The top menu has four parts; the row under it shows the pages of the part you are in. Each part reopens on the last page you saw
            there.</p>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--water)"><h3>Races</h3><p>Before, during and after the race: the ${P("#/agenda", "Calendar")}, the organisers'
              ${P("#/resultats", "Results")}, ${P("#/direct", "Live")}, the ${P("#/analyse-course", "Race analysis")} of split times and the GPS
              analyses.</p></div>
            <div class="mx-box" style="--c:var(--forest)"><h3>Ranking</h3><p>${fr ? html`Runners, rankings, classes, ranked races, comparisons, clubs and
              statistics, by the official CN or the Ozimut index.` : html`The rankings of the countries where Ozimut computes one, with their runners,
              their clubs and their statistics.`}</p></div>
            <div class="mx-box" style="--c:var(--course)"><h3>Training</h3><p>Map-reading ${P("#/jeux", "Games")}, the ${P("#/vma", "MAS")} (maximal aerobic
              speed), and the analysis of your own GPS tracks, alone or with others.</p></div>
            <div class="mx-box" style="--c:var(--flag)"><h3>Organising</h3><p>For the clubs that organise: uploading results and start times, broadcasting
              live, preparing the GPS analyses, setting courses.</p></div>
          </div>
          <p>Under your name: your runner page, this documentation, the ${P("#/reglages", "Settings")}, “Write to us” and signing out. The pages still
            being tried out carry the word “beta”; a notice says so the first time they open.</p>`)}`,
      pays: () => html`
        ${slide("The site", "The site's country", html`
          <p>The country button, at the top, chooses the country whose races you see: the calendar, the results and the live races are that country's,
            open to every account. You may race anywhere; only the chosen country's races are listed, but a search in “Live” looks in every
            country.</p>
          ${list([
            html`<b>The calendar</b> of some thirty countries comes from their federation (France, Spain, Switzerland, Germany, the United Kingdom,
              Italy…): it is read every morning, with each event's region and its département, canton or county.`,
            html`<b>Rankings</b> exist only where Ozimut has the federation's results: France (${fr ? "the official CN and " : ""}the Ozimut index) and
              Spain (the Ozimut index). Elsewhere, the pages of the “Ranking” part say so.`,
            html`<b>Outside France</b>, an organiser can declare their competitions (see ${D("orga", "Organising", "declarer")}): they appear in the
              calendar and the results of their country.`,
          ])}`)}
        ${slide("The site", "Language and theme", html`
          <p>The site exists in French and English: the language button, beside the country, changes it on this device and, signed in, for the
            account (the e-mails follow). The moon button chooses one of five themes, from the lightest to the darkest: Day, Clearing, Forest,
            Undergrowth and Night. By default, light on a computer, dark on a phone.</p>`)}`,
      compte: () => html`
        ${slide("The site", "The account", html`
          ${list([
            html`An account opens with an e-mail address and a password; you then give the countries where you race (${P("#/reglages?onglet=pays", "Settings › My countries")}).
              For France, your name and licence number are checked against the list of licensees: this is what opens ${fr ? "the rankings, your runner page and your results alerts" : "the French rankings"}.`,
            html`The account keeps only what it needs to work; the page ${P("#/compte/confidentialite", "Site rules and privacy")} says everything
              that is kept, where and for how long. It can be deleted from the Settings.`,
          ])}`)}
        ${slide("The site", "Alerts", html`
          <p>In the ${P("#/reglages", "Settings")}, each alert goes by e-mail, by notification, or both:</p>
          ${list([
            html`<b>One of my races is online</b>: as soon as results naming you appear, at the organiser's, on a platform or at the
              federation${fr ? "" : " (with a French licence)"}.`,
            html`<b>My start time is published</b>, and again if it changes.`,
            html`<b>A new race in my regions</b>, and <b>entries close soon</b> (8 days before), for the regions chosen.`,
          ])}
          <p>Notifications are set device by device (“Turn on for this device”, then “Send a test”); alert e-mails are opened account by account,
            as the site can only send a limited number.</p>`)}`,
      telephone: () => html`
        ${slide("The site", "Ozimut on your phone", html`
          ${list([
            html`<b>Installing the app</b>: the menu under your name offers “Install the app” (Chrome, Edge, Android); on an iPhone, Share › “Add to
              Home Screen”. Installed, it opens like an app, with shortcuts to the ranking, the results, the calendar and the solo analysis.`,
            html`<b>Notifications on an iPhone</b> only reach the app added to the home screen.`,
            html`<b>Sharing a track</b>: from your watch's or phone's app, “Share” to Ozimut opens the ${P("#/analyse-solo", "Solo analysis")} with
              the file; a GPX, FIT, TCX or KMZ file also opens directly with Ozimut. Nothing is sent: the file stays on the phone.`,
            html`<b>Offline</b>, a page says so instead of an error; course setting's field mode keeps its records until the network is back.`,
          ])}`)}`,
    });
  }

  // ======================================================================================================
  // Races
  // ======================================================================================================
  const COURSES = [["agenda", "Calendar"], ["resultats", "Results"], ["direct", "Live"], ["analyse", "Race analysis"], ["gps", "GPS analyses"]];
  function courses() {
    return chapters(COURSES, {
      agenda: () => html`
        ${slide("Races", "The calendar", html`
          <p>The ${P("#/agenda", "Calendar")} takes the chosen country's federation calendar every morning: races, and also training sessions, camps and
            courses. It can be filtered by date, discipline, region, département${fr ? ", and to the races that count for the CN" : ""}; an event of
            several days stays listed while it lasts.</p>
          <p>An event's details give the place and the way there, the race announcement, ${fr ? "the number of entries per course, " : ""}the entry
            deadlines, and, when they exist, boxes:</p>
          ${list([
            html`<b>Start list published</b>: the start times${fr ? ", with each runner's CN and the place it predicts" : ""}.`,
            html`<b>Live results</b>: on race day, a link to “Live”; “Live now” while runners are punching.`,
            html`<b>Live GPS tracking</b>: the link to the tracking site the organiser chose.`,
          ])}`)}`,
      resultats: () => html`
        ${slide("Races", "The organisers' results", html`
          <p>${P("#/resultats", "Results")} shows the races of the last 60 days as their organisers publish them, often the same evening, days before
            the federation. Ozimut looks for them itself several times a day, and every 20 minutes on Saturday and Sunday evenings:</p>
          ${list([
            html`on results <b>platforms</b>: liveresultat, WinSplits, Helga, O'Live, SPORTident Center, MeOSDjango sites (Orientation Data among them);`,
            html`on the organising <b>club's website</b>: its pages and files (OE or MeOS HTML, IOF XML, PDF);`,
            html`in the organisers' <b>uploads</b> and their <b>live broadcasts</b> (see ${D("orga", "Organising")}).`,
          ])}
          <p>A race under way says so (“under way”) while runners are out. When there are several documents, the organiser's comes before the
            platforms', and live results last (they are not corrected afterwards). Runners are recognised by their name and club;
            ${fr ? "“My races” shows yours. " : ""}A coming race whose start list is published opens from the calendar.</p>`)}
        ${!fr ? "" : html`
        <section class="mx-slide">
          <p class="mx-kicker">Results</p>
          <h2>Provisional scores and CNs</h2>
          <p>The site calculates provisional scores with each method's rules, for the runners it recognises.</p>
          ${list([
            html`<b>Official</b>: each recognised runner's official CN 15 days before the race, and FFCO's rule (an ordinary mean over the fastest
              two thirds).`,
            html`<b>Ozimut</b>: each recognised runner's usual level 15 days before the race, the course's Ozimut value (the
              mean of level × time over the fastest: 90% of the field in forest, two thirds in sprint), and the day's rescaling factor. The provisional
              Ozimut index after the race follows the rule of places.`,
            html`Only lists <b>by course</b> are scored. A list by class is scored course by course once it is known which classes
              ran on which course (from the same race's lists by course, FFCO's entry list or the race announcement). Runners
              who are not recognised stay without a CN.`,
            html`These values are provisional until FFCO publishes the results: the final values may differ if results are corrected
              or runners added.`,
          ])}
        </section>`}`,
      direct: () => html`
        ${slide("Races", "Live", html`
          <p>${P("#/direct", "Live")} relays the results published during the race on liveresultat, O'Live, SPORTident Center, a MeOSDjango site, or sent
            by the organiser from their timing software. “Live now” gathers at the top the races where a control or the finish recorded a
            punch in the last half hour.</p>
          ${list([
            html`<b>By course or by class</b>: place, time, gap, start time${fr ? ", each runner's CN and the place it predicts, and the score of their time" : ""}.
              A runner still out has an estimated finish time from their radio controls and the finishers' times.`,
            html`<b>Follow</b>: “My club” (your club's runners, every class), “Still on course”, “All punches” of the last 15 minutes, and your club's,
              which can make the phone vibrate and ring at each punch.`,
            html`<b>Recent punches</b> are green (under 3 minutes), then yellow (under 9); a search finds a runner or a club.`,
            html`As soon as a split time comes in, “Race analysis” analyses the race live.`,
          ])}`)}`,
      analyse: () => html`
        ${slide("Races", "Race analysis", html`
          <p>The ${P("#/analyse-course", "Race analysis")} lists the recent races whose split times are published, and the live ones that give them. A race
            is analysed course by course, in several views: Table, Gaps, Passings, Legs, Profile, Head-to-head, Groups, Autonomy, Regularity and
            Summary. An organiser can also look at their own file there before publishing it.</p>`)}
        <section class="mx-slide">
          <p class="mx-kicker">Splits</p>
          <h2>Time lost and mistakes</h2>
          ${list([
            html`On each leg between two controls, the <b>time lost</b> is the gap between the runner's time and the time their usual pace
              on this race would have predicted. It is negative when the runner goes faster than usual. A leg's reference time is the mean of the
              fastest times (the fastest sixth, the winner left out), and the usual pace the runner's time on the legs run without a mistake over their
              reference times: a long leg counts more than a short one, as in MeOS.`,
            html`A <b>mistake</b> is a leg on which the runner lost at least 20% of the leg's time <b>and</b> at least 10 seconds; both thresholds
              can be adjusted. The “Lost” and “Without time lost” columns count only the mistakes.`,
            html`The <b>gaps</b> are measured against the “superman”, an imaginary runner with the best time on every leg, among all the
              runners or among those being compared.`,
            html`The <b>groups</b> spot the runners who pass the same controls a few seconds apart, control after control.`,
          ])}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Splits</p>
          <h2>Passings, autonomy, regularity, timing check</h2>
          ${list([
            html`The <b>passing times chart</b> places each runner at the time of day they punched each control (their start time plus their
              cumulative time): lines that meet are runners together, a steeper line is a runner catching others up.`,
            html`<b>Autonomy</b>, who followed whom: on each leg, two runners of the course who left the same control less than 20 seconds apart are compared
              all along it, each assumed to move at a steady speed between the two controls. Less than 7 seconds apart, they run together; from 7 to 20
              seconds, less and less. The one who passes second follows the other. The follower index is the time run behind minus the time run in front,
              as a share of the race time: positive for a follower, negative for a leader. Following saves time (the other reads the map and opens the
              way), hence the interest in spotting it; both thresholds can be adjusted.`,
            html`<b>Regularity</b>: on each leg, the performance index is the reference time (the mean of the best quarter of times) divided by the
              runner's time, 100% for going as fast as the best. Irregularity is the standard deviation of these indices, each leg weighing its reference
              time, relative to the runner's mean index: a steady runner keeps the same pace from one leg to the next, an irregular one alternates good
              legs and hesitations. A leg's spread, with each runner's level set aside, shows the legs where everyone varied: the tricky legs. Only the
              runners who finished with all their times count.`,
            html`The <b>timing check</b> reads the split times themselves. A leg run in negative time at the same control for at least two runners
              betrays a unit set to the wrong time (this control's or the previous one's): it shifts everyone who punches it. An isolated negative leg
              betrays a card not cleared, which keeps the punches of an earlier race. A runner ranked without a control the others punched probably
              punched it before their start, and the software discarded that punch. The organiser sees it when depositing their results, before
              publishing them; readers see it above the analyses, and the cells concerned are framed in the table.`,
          ])}
        </section>`,
      gps: () => html`
        ${slide("Races", "Analysing your GPS track", html`
          <p>Two analyses, under “Races” for a competition and under “Training” for the rest (see ${D("entrainement", "Training", "solo")}):</p>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--s1)"><h3>${P("#/analyse", "Solo analysis")}</h3><p>Your track on your map, for a race of “Results”. The
              map and the track are read in your browser and never leave it. The course is read on the map, the track fitted to it by itself, and the
              published split times refine the fit; the race then plays back, leg by leg, with the time lost, the pace and the heart rate.</p></div>
            <div class="mx-box" style="--c:var(--s3)"><h3>${P("#/analyse-competition", "Group analysis")}</h3><p>The tracks of everyone who ran a competition,
              on the map its organiser prepared, beside the published results: mass start, waiting at controls, leg-by-leg comparison, as on Livelox.
              Each runner adds their own track, which keeps only positions and times.</p></div>
          </div>
          <p>Files read: the map (image, PDF or KMZ), the track (GPX, FIT or TCX) and, if you have them, the map's georeferencing (KMZ, world file)
            and the courses in IOF XML.</p>`)}`,
    });
  }

  // ======================================================================================================
  // Training
  // ======================================================================================================
  const TRAINING = [["jeux", "Games"], ["vma", "MAS"], ["solo", "Solo analysis"], ["multi", "Group analysis"]];
  function entrainement() {
    return chapters(TRAINING, {
      jeux: () => html`
        ${slide("Training", "Twelve map-reading games", html`
          <p>The ${P("#/jeux", "Games")} are played on maps the site draws for each game — a forest with its relief and vegetation, a town, a maze — and
            “photos” of the terrain drawn the same way. Nothing is sent; the best scores stay in the browser.</p>
          ${list([
            html`<b>Route choice</b>: Rapid route (draw the shortest), Course choice (20 seconds of map, 5 to choose), Fastest fork, Route choice
              between three or four routes.`,
            html`<b>Reading relief and terrain</b>: Contours, Uphill or downhill?, Matching maps, Spot the difference, Trail'O.`,
            html`<b>Memory</b>: Map memory, Photo memory, and the Maze, seen in the first person.`,
          ])}`)}`,
      vma: () => html`
        ${slide("Training", "Maximal aerobic speed", html`
          <p>The ${P("#/vma", "MAS")} page calculates the maximal aerobic speed from a half-Cooper (6 minutes) or a Cooper (12 minutes) on a track — the
            lane chosen counts, as does the last incomplete lap —, gives the training paces it implies, and presents the other tests (VAMEVAL,
            Léger-Boucher, 45-15…) and free apps to run them.</p>`)}`,
      solo: () => html`
        ${slide("Training", "Solo analysis", html`
          <p>The ${P("#/analyse-solo", "Solo analysis")} is the same analysis as for competitions (see ${D("courses", "Races", "gps")}), for any outing:
            drop the map and the track, the course is read on the map and the track fitted to it; if the reading goes wrong, a few clicks correct it.
            The race then plays back, full screen if you wish, with the watch's curves (pace, heart rate, cadence, altitude…).</p>
          <p>The files stay in the browser for the visit; only the controls' placing is kept, to find the analysis as you left it.</p>`)}`,
      multi: () => html`
        ${slide("Training", "Group analysis", html`
          <p>The ${P("#/analyse-club", "Group analysis")} of training sessions: those their organisers prepared, with the map and the courses. Choose yours,
            add your track, and compare it with the others'. A session can be open to all, to a club, or protected by a password. Your own file also
            shows your curves beside the map, for you alone.</p>`)}`,
    });
  }

  // ======================================================================================================
  // Organising
  // ======================================================================================================
  const ORGA = [["qui", "Who organises"], ["resultats", "Results"], ["horaires", "Start times"], ["direct", "Live feed"], ["suivi", "GPS tracking"],
    ["analyses", "Group analyses"], ["declarer", "Declared competitions"], ["trace", "Course setting"]];
  function orga() {
    return chapters(ORGA, {
      qui: () => html`
        ${slide("Organising", "The organisers' pages", html`
          <p>These pages serve the clubs that organise. A competition's organiser is ${fr ? "any member of its organising club — the club of their latest known race — or " : ""}
            the account that declared it, outside France. A training session can be created by any account.</p>
          ${list([
            html`${P("#/orga-competitions", "Competitions")} and ${P("#/orga-entrainements", "Training sessions")}: preparing the group analyses.`,
            html`${P("#/orga-resultats", "Results")} and ${P("#/orga-horaires", "Start times")}: uploading the results and the start list.`,
            html`${P("#/orga-direct", "Live feed")}: broadcasting the results live from the timing software, and giving the GPS tracking link.`,
            html`${P("#/orga-tracer", "Course setting")}: setting the courses, as with Purple Pen.`,
          ])}`)}`,
      resultats: () => html`
        ${slide("Organising", "Uploading the results", html`
          <p>For a competition of your club, ${P("#/orga-resultats", "Organising › Results")} shows what “Results” already has of it, and “Upload the
            results” adds your file, in three steps:</p>
          <div class="mx-steps">
            <div class="mx-step"><b>The file</b>An IOF XML export from your software (the best: it carries the courses and the split times), or OE or MeOS
              HTML, or a PDF; zipped or not, 30 MB at most.</div>
            <div class="mx-step"><b>The check</b>The file is read in your browser, nothing is sent: summary, results course by course, the timing check
              (units set wrong, cards not cleared), and every view of the race analysis.</div>
            <div class="mx-step"><b>Publishing</b>“Publish” sends it: the race appears in “Results” within minutes, marked as uploaded by the organiser, and
              is no longer looked for elsewhere. A new upload replaces the previous one.</div>
          </div>`)}`,
      horaires: () => html`
        ${slide("Organising", "Publishing the start times", html`
          <p>${P("#/orga-horaires", "Organising › Start times")} publishes the start list of a coming competition of your club, up to race day. Files
            read: IOF XML “StartList” (the best), CSV, a sheet with one pair of columns per course, HTML, OE or MeOS PDF, or a shared Google Sheets
            link.</p>
          ${list([
            html`The file is first read and checked in your browser: two runners of one club one after the other, a start minute shared, runners
              without a time, a card or a course, the intervals and the vacant places.`,
            html`“Check and export” also writes the start's file for the O Checklist app.`,
            html`Once published, the list appears in the calendar (“Start list published”), and every runner who asked for it gets their start time by
              notification or by e-mail.`,
          ])}`)}`,
      direct: () => html`
        ${slide("Organising", "Broadcasting live", html`
          <p>${P("#/orga-direct", "Organising › Live feed")} shows your results in “Live” without going through liveresultat. A broadcast opens with a name,
            a date and, if possible, the competition it belongs to. Then, either:</p>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--s1)"><h3>From the file</h3><p>Your software exports the results list every few seconds (IOF XML, OE or
              MeOS HTML); the page, open on the arena computer in Chrome or Edge, reads that file again and sends what changes.</p></div>
            <div class="mx-box" style="--c:var(--s3)"><h3>From MeOS</h3><p>MeOS's “Online Results” service sends its results itself to the address, number
              and password the page gives; the radio controls' split times follow.</p></div>
          </div>
          <p>Tied to its competition, a broadcast is kept after the race: its results, split times and start list stay in “Results”. It is still a
            trial version: try it first at a training session, or beside the usual live results.</p>`)}`,
      suivi: () => html`
        ${slide("Organising", "GPS tracking", html`
          <p>Ozimut tracks nobody by GPS. If your competition uses a tracking service (Loggator, GPSSeuranta, TracTrac, Livelox, Routechoices…), give
            its link in ${P("#/orga-direct", "Organising › Live feed")}: it appears in the calendar (“Live GPS tracking”), in the race's results and
            on its “Live” page. Only the link is published.</p>`)}`,
      analyses: () => html`
        ${slide("Organising", "Preparing a group analysis", html`
          <p>In ${P("#/orga-competitions", "Competitions")} (your club's competitions of the last 60 days) or ${P("#/orga-entrainements", "Training sessions")}
            (“New training session”), a group analysis is prepared course by course:</p>
          ${list([
            html`<b>The map</b>: an image, a PDF or a KMZ, kept as it is, with no loss of quality.`,
            html`<b>Its placing</b>: from a KMZ, a world file, an IOF XML with coordinates, or your own track.`,
            html`<b>The course</b>: read on the map, the controls' order from the courses' IOF XML, your track, or your clicks.`,
            html`<b>Access</b>: every account, the club's members, or a password. “View as runners see it” shows the page as they will.`,
          ])}
          <p>Course setting can also publish its courses, map included, to a group analysis (after the race for a competition).</p>`)}`,
      declarer: () => html`
        ${slide("Organising", "Declaring a competition, outside France", html`
          <p>French competitions come from ${fr ? "FFCO's" : "the French federation's"} calendar. In the other countries, an account that is a member of the country declares its competition
            itself, in the “My declared competitions” box of the Results, Start times and Competitions pages: country, club, name, date, place,
            discipline, format, website. It then appears in its country's calendar and results, and its organiser can upload its start list, results
            and analyses. Who declared it is not published.</p>`)}`,
      trace: () => html`
        ${slide("Organising", "Setting the courses", html`
          <p>${P("#/orga-tracer", "Course setting")} is a course-setting program in the browser, modelled on Purple Pen: controls, courses and variations,
            descriptions, printing maps and descriptions, IOF XML exports and OCAD or Mapper files, teamwork with optional encryption, a field mode on
            the phone. Its full guide is the ${D("tracer", "Course setting")} tab.</p>`)}`,
    });
  }

  const LABELS = { site: "The site", courses: "Races", entrainement: "Training", orga: "Organising" };
  return { LABELS, SITE, COURSES, TRAINING, ORGA, site, courses, entrainement, orga };
}
