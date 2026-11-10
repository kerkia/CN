// The Documentation's guide to the site, in English (guide.fr.js is the reference: the same structure, the same chapters).
// build(X) receives the page's helpers and returns « The site » (the documentation's home) and the guides of Arena, Coach and
// Orga. A page is named as the English menu names it, with a link.
export function build(X) {
  const { html, raw, subTabs, fr = true, admin = false, owner = false } = X;
  // a page of the site, as the menus name it
  const P = (href, label) => html`<a href="${href}">${label}</a>`;
  // a module's documentation
  const M = (mod, label) => html`<a href="#/documentation?module=${mod}">${label}</a>`;
  // a tab of the module's documentation shown (Orga: « Course setting »)
  const D = (tab, label, goto) => html`<a href="#/documentation?onglet=${tab}${goto ? `&voir=${goto}` : ""}" data-tab-link="${tab}"${raw(goto ? ` data-goto="${goto}"` : "")}>${label}</a>`;
  const chapters = (list, CH) => raw(subTabs(list, list[0][0]).s.replace(/<div data-subpanel="([a-z]+)"( hidden)?><\/div>/g, (m0, k, hid) =>
    `<div data-subpanel="${k}"${hid || ""}>${CH[k]().s}</div>`));
  const slide = (kicker, title, body, id) => html`<section class="mx-slide"${raw(id ? ` id="${id}"` : "")}><p class="mx-kicker">${kicker}</p><h2>${title}</h2>${body}</section>`;
  const list = (items) => html`<ul class="mx-list">${items.filter(Boolean).map((i) => html`<li><span>${i}</span></li>`)}</ul>`;

  // what each documentation says under its title
  const LEDE = {
    home: html`Ozimut in a few words, then each module's documentation: choose the one you want.`,
    arena: html`The competitions: the calendar, the organisers' results, live results and the split-time analysis.`,
    coach: owner ? html`Training: GPS track analyses, control descriptions, map symbols, games and the MAS.`
      : html`Training: GPS track analyses, games and the MAS.`,
    orga: html`The organisers' tools: results, start times, live feed, GPS tracking, analyses and course setting.`,
  };

  // ======================================================================================================
  // The site: the documentation's home, short
  // ======================================================================================================
  function site() {
    return html`
      ${slide("The site", "Modules and account", html`
        <p>Ozimut has four modules: the modules page, where you land, offers to pick one, and the top bar then shows its pages only. The Ozimut
          logo brings you back there at any time. Orga is turned on when registering, in Settings or on the modules page, and is used on a
          computer.</p>
        ${list([
          html`<b>Without an account</b>, Ozimut shows what is public: Arena, Coach except comparing with the other runners, and in Stats the runner, the ranking and the
            races over the period the federation publishes openly.`,
          html`<b>An account</b> opens with an e-mail address and a password, then the countries where you race (${P("#/reglages?onglet=pays", "Settings › My countries")}).
            For France, your name and licence number are checked against the list of licensees: this is what opens ${fr ? "the rankings and your runner page" : "the French rankings"}.
            The account keeps only what it needs; ${P("#/compte/confidentialite", "Site rules and privacy")} says what, where and for how long.`,
          html`Under your name: the modules page, this documentation, the ${P("#/reglages", "Settings")}, “Write to us” and signing out. The pages still
            in trial carry a “beta” mark.`,
        ])}`, "menus")}
      ${slide("The site", "Country, language and theme", html`
        ${list([
          html`<b>The country</b>, at the top, chooses the competitions you see: the calendar of some thirty countries, read every morning at their
            federation, their results and live races, open to all. Rankings exist only where Ozimut has the federation's results: France
            (${fr ? "the official CN and " : ""}the Ozimut index) and Spain (the Ozimut index).`,
          html`<b>The language</b>, French, English, German or Spanish, changes on this device and, signed in, for the account (the e-mails follow).`,
          html`<b>The theme</b>, under the moon: Day, Clearing, Forest, Undergrowth or Night; light on a computer, dark on a phone by default.`,
        ])}`, "pays")}
      ${slide("The site", "Alerts", html`
        <p>In the ${P("#/reglages", "Settings")}, each alert goes by e-mail, by notification, or both: <b>one of my races is online</b>${fr ? "" : " (with a French licence)"},
          <b>my start time is published</b>, <b>a new race in my regions</b> and <b>entries close soon</b>. Notifications are set device by device; alert
          e-mails are opened account by account, as the site can only send a limited number.</p>`, "compte")}
      ${slide("The site", "On your phone", html`
        ${list([
          html`<b>The app</b>: “Install the app” in the menu under your name (Chrome, Edge, Android); on an iPhone, Share › “Add to Home Screen” — also
            the only way to receive notifications there.`,
          html`<b>Sharing a track</b> from your watch or phone to Ozimut opens the ${P("#/analyse-solo", "Solo analysis")} with the file; nothing is
            sent.`,
        ])}`, "telephone")}`;
  }

  // ======================================================================================================
  // Arena
  // ======================================================================================================
  const ARENA = [["competitions", "The competitions"], ["resultats", "Results"], ["direct", "Live"], ["analyse", "Analysis"]];
  function arena() {
    return chapters(ARENA, {
      competitions: () => html`
        ${slide("Arena", "One page, every competition", html`
          <p>Arena is a single page, the chosen country's ${P("#/agenda", "Competitions")}: three boxes choose today's, the coming ones and those of the
            last 60 days. The calendar comes every morning from the federation's — races, and also training sessions, camps and courses. Filter by date,
            discipline, region${fr ? ", département, and the races that count for the CN" : ""}; on a computer, a map shows where they take place.${fr ? " The championships and nationales of the coming seasons also come from the national calendar, often provisional, before their organiser puts them on the agenda: they are marked “provisional”, and their date and organiser may still change." : ""}</p>
          ${list([
            html`<b>A coming competition</b> opens beside the list: the place and the way there, the announcement, ${fr ? "the number of entries per course, " : ""}the
              entry deadline, and buttons when they exist — the start list${fr ? " (with each runner's CN and the place it predicts)" : ""}, “Follow live”,
              GPS tracking.`,
            html`<b>A past competition</b> opens its page: the results as the first tab, then, when split times are published, each view of their analysis.
              “‹ Competitions” brings you back to the list where you left it.`,
          ])}`)}`,
      resultats: () => html`
        ${slide("Arena", "The organisers' results", html`
          <p>The results of the last 60 days appear as their organisers publish them, often the same evening, days before the federation. Ozimut looks for
            them itself several times a day, and every 20 minutes on Saturday and Sunday evenings:</p>
          ${list([
            html`on results <b>platforms</b>: liveresultat, WinSplits, Helga, O'Live, SPORTident Center, MeOSDjango sites (Orientation Data among them);`,
            html`on the organising <b>club's website</b>: its pages and files (OE or MeOS HTML, IOF XML, PDF);`,
            html`in the organisers' <b>uploads</b> and their <b>live broadcasts</b> (see ${M("orga", "Orga")}'s documentation).`,
          ])}
          <p>A race under way says so (“under way”) while runners are out. When there are several documents, Ozimut shows the best: the organiser's before
            the platforms', live results last (they are not corrected afterwards). Runners are recognised by their name and club.</p>`)}
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
        ${slide("Arena", "Live", html`
          <p>On race day, “Follow live” relays the results published during the race on liveresultat, O'Live, SPORTident Center, a MeOSDjango site, or sent
            by the organiser from their timing software. A competition where a control or the finish recorded a punch in the last half hour is marked
            “live”.</p>
          ${list([
            html`<b>By course or by class</b>: place, time, gap, start time${fr ? ", each runner's CN and the place it predicts, and the score of their time" : ""}.
              A runner still out has an estimated finish time from their radio controls and the finishers' times.`,
            html`<b>Follow</b>: “My club” (your club's runners, every class), “Still on course”, “All punches” of the last 15 minutes, and your club's,
              which can make the phone vibrate and ring at each punch.`,
            html`<b>Recent punches</b> are green (under 3 minutes), then yellow (under 9); a search finds a runner or a club.`,
            html`As soon as a split time comes in, “Analysis” analyses the race live.`,
          ])}`)}`,
      analyse: () => html`
        ${slide("Arena", "Analysis", html`
          <p>When split times are published, a race's page analyses them course by course, in several views: Table, Gaps, Passings, Legs, Profile,
            Head-to-head, Groups, Autonomy, Regularity and Summary.</p>`)}
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
    });
  }

  // ======================================================================================================
  // Coach
  // ======================================================================================================
  const COACH = [["carte", "Analysis"], ["solo", "Solo analysis"], ["multi", "Compare with the other runners"], ["cartes", "My maps"], ...(owner ? [["definitions", "Control descriptions"], ["symboles", "Map symbols"]] : []),     // (the accounts named Le Helloco only, auth.owner)
    ["jeux", "Games"], ["vma", "MAS"], ["routes", "Computed routes"]];     // (every account's since 2026-11-04)
  function coach() {
    return chapters(COACH, {
      carte: () => html`
        ${slide("Coach", "Analysis", html`
          <p>${P("#/analyses", "Analysis")} opens on the list of the competitions and training sessions whose organiser has published the map and courses.</p>
          ${list([
            html`<b>The list</b> is filtered by period, by country (above the list), by type (competitions or training sessions), by organising club and by name;
              on a computer, the country's map is beside it, and the event's map shows as a thumbnail under the mouse.`,
            html`<b>An event chosen</b> offers three ways in: <b>View with all runners</b> (the shared tracks, replayed together), <b>Add my track and compare</b>
              (your track joins the others', with your consent) or <b>Analyse my track alone on this map</b> (Solo analysis on the organiser's map: you only drop
              your track, it places itself, and nothing is sent). Adding a track needs an account, and the organiser can close either way.`,
            html`<b>Add my own event</b> opens Solo analysis on your map and your track, for a training session or any outing. If the track is from a race whose
              results are published, or from an event whose organiser has published the map, the page offers it.`,
          ])}`)}`,
      solo: () => html`
        ${slide("Coach", "Solo analysis", html`
          <p>${P("#/analyse-solo", "Solo analysis")} replays your race on your map with your GPS track. You reach it from ${P("#/analyses", "Analysis")}:
            “Add my own event” (a training session, any outing, or a competition whose map you have: the page offers its published split times when the track is
            from it), or the map the organiser has published, with no map to provide and no calibration to do.</p>
          ${list([
            html`<b>The files</b>: the map (image, PDF, KMZ, or the OCAD or Mapper file itself), the track (GPX, FIT or TCX) and, if you have them, the
              map's georeferencing (KMZ, world file) and the courses in IOF XML. On a phone, “Photograph the map”.`,
            html`<b>The fit</b> is automatic: the course is read on the map, the track laid on it; if the reading goes wrong, a few clicks correct it.`,
            html`<b>The race</b> then plays back, full screen if you wish, leg by leg, with the time lost, the pace and the watch's curves (heart rate,
              cadence, altitude…).`,
            html`<b>The track</b> can be coloured by pace, heart rate, altitude, slope, cadence or power (what the watch recorded), with its legend;
              its start and end can be cut off (the warm-up, the way back), and <b>a picture</b> of the map with the track, a title and the legend
              exported, saved on your device.`,
            html`<b>No GPS track?</b> « Draw my route »: click your route on the map, control after control; the published split times (or those you type,
              the finish's at least) make it run like a watch's track; « Snap to the paths » then lays each leg on the nearest way the map reads. A drawn
              route cannot be used to compare yourself with the other runners. <b>📏</b> measures a distance on the map, and « Map orientation » can turn the
              current leg up.`,
          ])}
          <p>The map and the track are read in your browser and never leave it; only the controls' placing is kept, to find the analysis as you left
            it.</p>`)}`,
      multi: () => html`
        ${slide("Coach", "Compare with the other runners", html`
          <p>“${P("#/analyses", "Compare with the other runners")}” shows side by side the tracks of everyone who ran a competition or a training session, on the
            map its organiser prepared (see ${M("orga", "Orga")}'s documentation). Choose the race, add your track — it keeps only positions and times —,
            and compare. It needs an account.</p>
          ${list([
            html`<b>The replay</b>, as on Livelox: real time, mass start, waiting at controls, one leg at a time.`,
            html`<b>Left of the map</b>, the “Legs” tab (open from the start) details one runner's legs, and the “Analyses” tab the split times (those published for a competition), the gaps, the route variants, and for a training
              session the organiser's exercises (corridor, compass leg).`,
            html`<b>Access</b>: every account, a club's members (and its invitees, with the code the organiser gives them), or a password. Your own file also shows your curves beside the map, for you alone.`,
            html`Everyone can <b>comment</b> on their race (« My comment »), read by all who see the
              traces. The organiser can open the analysis <b>to visitors without an account</b>: they see only the traces of the runners who agreed. A
              <b>score</b> course (controls in any order) shows everyone's order.`,
          ])}`)}`,
      cartes: () => html`
        ${slide("Coach", "My maps", html`
          <p>${P("#/mes-cartes", "My maps")} keeps your maps and the routes you ran on them, like a DOMA of your own: a gallery to search by title, place or
            year, and each map with its races drawn on it, one colour each or by pace. You need an account.</p>
          ${list([
            html`<b>Adding a race</b>: in Solo analysis, once the race is calibrated, “Save to My maps”. What is kept is the map as you gave it and the route as
              it is drawn (positions on the map and times, controls), never the GPS file. The same map is kept once: another race on it is added to it.`,
            html`<b>Importing</b>: the JPEGs QuickRoute exports (the ones DOMA keeps), Ozimut's files, one by one or in a zip, or dropped on the page. Importing
              straight from a DOMA is not open yet: its button sends the Ozimut team a ready-made request to turn it on.`,
            html`<b>Exporting</b>: each map becomes a JPEG anyone can open (the map with your routes), which also holds the original map and the races; Ozimut
              reads it back as it was. Several maps ticked are exported together in a zip, shared by one link or deleted at once.`,
            html`<b>Personal data</b>: heart rate, altitude and cadence are kept only if you tick the box (unticked by default).`,
            html`<b>Sharing</b>: your maps are private. A link to all your maps, or to one, shows them to whoever gets it, even without an account, without the
              personal data; deleting the link ends the sharing.`,
          ])}`)}`,
      definitions: () => html`
        ${slide("Coach", "Control descriptions", html`
          <p>The ${P("#/definitions", "Control descriptions")} present the IOF symbols column by column, each with its equivalent on the map, their names in
            23 languages and a search. “Reading a line of descriptions” goes through an example column by column. To revise, hide the names, guess the
            description from the map, or the map from the symbol.</p>`)}`,
      symboles: () => html`
        ${slide("Coach", "Map symbols", html`
          <p>The ${P("#/symboles", "Map symbols")} are the full legend of a forest map (ISOM 2017-2), colour by colour: each symbol with its number, name and
            meaning, those that must not be crossed marked. “What the colours say” explains how runnable the forest is by its green. To revise, hide the
            names or the drawings.</p>
          <p>These two pages are two tabs of ${P("#/apprendre", "Learning")}, with a third, “Test”: a photo of the terrain and four control circles on
            the map, which one is on the feature? Twenty questions of ten seconds by default; their number, their time and what the question shows
            (photo, name, description) can be set. When you are signed in, your games go into the “Leaderboard”.</p>`)}`,
      jeux: () => html`
        ${slide("Coach", "Thirteen map-reading games", html`
          <p>The ${P("#/jeux", "Games")} are played on maps the site draws for each game — a forest with its relief and vegetation, a town, a maze — and
            “photos” of the terrain drawn the same way. Nothing is sent; when you are signed in, your games go into each game's “Leaderboard” (your 20 best, everyone's 20 best).</p>
          ${list([
            html`<b>Route choice</b>: Rapid route (draw the shortest), Course choice (20 seconds of map, 5 to choose), Fastest fork, Route choice
              between three or four routes.`,
            html`<b>Reading relief and terrain</b>: Contours, Uphill or downhill?, Matching maps, Spot the difference, Trail'O.`,
            html`<b>Memory</b>: Map memory, Photo memory, and the Maze, seen in the first person.`,
            html`<b>Descriptions</b>: Which control?, the test of “Learning” (a photo of the terrain, the right control circle on the map).`,
          ])}`)}`,
      vma: () => html`
        ${slide("Coach", "Maximal aerobic speed", html`
          <p>The ${P("#/vma", "MAS")} page presents the tests (in a laboratory, VAMEVAL, Léger-Boucher, half-Cooper, Cooper, shuttle, 45-15), calculates
            the maximal aerobic speed from a half-Cooper (6 minutes) or a Cooper (12 minutes) — the track's lane counts, as does the last incomplete lap —,
            gives the training paces it implies, and suggests free apps to run the tests.</p>`)}`,
      routes: () => html`
        ${slide("Coach · trial", "Computed routes", html`
          <p>In both GPS analyses, Ozimut suggests, for each leg, the fastest routes on the map, with their length, climb and
            an estimated time — and measures each runner's own route on the same model. In ${P("#/analyse-solo", "Solo analysis")}, every leg is
            computed and the "Routes" tab, left of the map, lists them leg by leg (the settings are in the "Route computing" tab, on the right); in “${P("#/analyse-club", "Compare with the other runners")}”, the leg shown, with the list of runners.
            It is a prototype: the routes follow the map as Ozimut reads it, and that reading can be wrong. The computing starts by itself; it is stopped in
            the "Route computing" tab, and the organiser of an analysis can switch it off for their event.</p>`)}
        ${slide("Coach · trial", "1. Reading the map by its colours", html`
          <p>The map is an image: Ozimut knows only its colours. Each pixel is classed: white (runnable forest), yellow (open land, lighter or
            darker), the three greens by their depth, olive (out of bounds), and the "inks" printed over them — black, grey, brown, blue and the
            course's purple.</p>
          ${list([
            html`<b>The paper first</b>: on a photo it is grey, warmer or colder, darker in a corner. Ozimut finds its colour (the light, nearly grey
              pixels), measures it in squares of some fifty metres and brings it back to white everywhere; an exported map, white already, is left as
              it is. A shade lighter than bare rock's grey is not rock.`,
            html`<b>The north lines</b> — long, straight, parallel and evenly spaced — are taken out (cyan in "Show the terrain as read"): otherwise they
              made strips of water or marsh across the map.`,
            html`An ink is a <b>line</b> or an <b>area</b> by its thickness, measured in metres: what remains once lines narrower than 7 to 10 m are
              erased (4 to 5 m in sprint) is an area. Thick black is a building or a large cliff (impassable), dark grey a building in sprint or bare
              rock in forest, thick brown a paved area, thick blue water.`,
            html`<b>Paths</b>: the thin black lines (or dark grey ones, as on a scan) make a network. Ozimut follows each line, its two ends and its
              direction, and joins the dashes of a dashed path end to end when they face each other across their gap. A chain at least 30 m long is a
              path, of one of three kinds from its dashes against the map's other paths: road or track (solid and thicker, or long thick dashes),
              footpath, small path (short dashes). Dots, triangles and a short isolated line are not.`,
            html`<b>The organisers' overprint</b>: purple printed over yellow, orange or green comes out red on paper. Its hatched areas are out of
              bounds; its bands of crosses along a road are forbidden routes — crossed, not followed; near the course's controls (their circles and
              numbers) it is ignored. Impassable walls and fences cannot be told from a path on a photo: their tick marks are too fine.`,
            html`<b>Thin blue lines</b> are streams and, close together, marshes. Contours, the course, text and dots are erased: each pixel takes the
              colour of the nearest terrain underneath.`,
            html`The map is then cut into cells of about 1.5 m, each with its most frequent terrain. "Show the terrain as read" draws these cells over
              the map, with their legend: the first thing to check. Ozimut warns when the reading looks wrong (much bare rock or buildings in forest,
              one terrain nearly everywhere, no path at all).`,
          ])}
          <p>Known limits: out-of-bounds hatching in purple is erased with the course; thin impassable cliffs, walls and fences are black lines like
            paths (the "Thin black lines" setting says what they are).</p>`)}
        ${slide("Coach · trial", "1b. Better: the OCAD or Mapper map", html`
          <p>The map's own file — OCAD (.ocd) or OpenOrienteering Mapper (.omap, .xmap) — tells the terrain without guessing: Ozimut reads it in
            your browser with the course setter's engine and draws each symbol exactly where it is.</p>
          ${list([
            html`<b>Areas</b> by their fill colour (or hatching: blue for a marsh, olive or purple for out of bounds), layer by layer as on the map
              — a green over a yellow wins. The colour rather than the number: ISOM 2000, ISOM 2017 and ISSprOM number differently.`,
            html`<b>Lines</b> by their number: roads and vehicle tracks (501 to 504), footpaths (505), small paths and rides (506 to 508) are the three kinds of path, solid even where the map dashes them; impassable
              cliffs, walls and fences (201, 515, 518; 521 and 524 in ISOM 2000) stop the runner, except where a path crosses them; passable walls
              and fences and vegetation boundaries are handrails; blue lines are streams.`,
            html`Contours, point symbols, text and the course are left out.`,
          ])}
          <p>In Solo analysis, an OCAD or Mapper file dropped alone <b>is</b> the map: drawn here, the track placed by its georeferencing. Dropped
            with an image of the map — or chosen in the "Computed routes" box, in both analyses — it serves the routes, placed on the image by its
            georeferencing: it must have one, and cover the map shown.</p>
          <p>An analysis published from the course setting, or whose courses come from an OCAD project (Orga › Analyses), keeps what
            the organiser's OCAD map says of the terrain: its routes read its symbols with no file to drop, and the out-of-bounds areas and the
            boundaries not to be crossed that the setter drew on the course are part of it. Only that drawing of the terrain is sent with the
            course, never the OCAD file.</p>`)}
        ${slide("Coach · trial", "2. The time of a step", html`
          <p>The time from one cell to the next is the distance, multiplied by the terrain's slowness and the slope's:</p>
          ${list([
            html`<b>Terrain</b>: its speed as a share of runnable forest's — road or track 130%, footpath 125%, small path 110%, open land 110%, rough open land 100%, the three greens 75, 45
              and 20%, marsh 65%, paved area 120%. Water, buildings, out of bounds (and grey in sprint) are impassable. All set under "Speed by
              terrain".`,
            html`<b>Slope</b>, read on the map's contour lines — surveyed on the ground by its mapper —, each set at its height from IGN's model (RGE ALTI, in France) or the "Terrain Tiles" elsewhere, which also fills between them ("Relief: model only" does without them; a contour misread makes a step): uphill, each metre climbed costs as
              much as 8 m on the flat (the "1 m of climb is worth" setting); gently downhill one goes a little faster (up to 9% at a 15% slope),
              steeper one brakes (at 30%, 29% slower than on the flat).`,
            html`Steps go in 16 directions (the eight neighbours and the knight's moves), which follows a straight line within 3%.`,
          ])}
          <p>That time is for a reference pace in flat runnable forest: 6:00 min/km by default, or the one typed, or — when none is typed — the
            runner's own: in Solo analysis, the median over their legs of their actual time divided by the model's time on their own route; in “Compare with the other
            runners”, the runners' median on the leg.</p>`)}
        ${slide("Coach · trial", "3. Navigation caution", html`
          <p>The shortest is not always the safest: far from any feature, deep in the forest, one reads the map more often, slows down, makes
            mistakes. Ozimut calls <b>handrails</b> paths, streams, edges between different terrains and the banks of what stops (water,
            buildings). Caution adds to a step's cost a share of its time that grows with the distance to the nearest handrail, full at 50 m:</p>
          <p class="mx-eq">cost = time × (1 + caution × visibility × min(1, distance / 50 m))</p>
          <p>Visibility weighs 1 in runnable forest, 1.2 to 1.4 in the greens, 0.3 in open land, 0 on a path. At 20% (the default), crossing a
            forest with no feature costs up to a fifth more; at 0%, one runs straight like a runner who never makes a mistake. Caution chooses the
            route; the times shown remain running times, without it.</p>`)}
        ${slide("Coach · trial", "4. The variants and the decision map", html`
          <p>Ozimut grows two shortest-path trees over an ellipse around the leg (wide enough to go round a lake or to fetch a track some way off):
            one from the start, one from the control. Their sum at a point is the cost of the best route through that point; the lowest gives A, the
            fastest, exact on the grid. The choices are read on that sum:</p>
          ${list([
            html`the <b>plateaus</b>: the stretches both trees agree on — a path followed for long is one;`,
            html`the <b>valleys</b>: along lines across the leg, at every tenth of it, each dip of the sum parted from the others by a ridge (1.5% of
              A's time at least) is a way through of its own — where do the good routes cross the leg?`,
          ])}
          <p>A proposal is kept if it costs no more than A plus the margin chosen (25% by default), departs from the routes kept for at least a fifth
            of it, and either crosses the leg in a valley none of them takes (no stretch of 30% of its length can be shortened by over 1%) or departs
            from them for 30% and stays <b>locally optimal</b> over half of its length. An arc through uniform forest is not a choice; the straight
            way beside a track, a detour by a path or round a green area are. Each route is then pulled tight in straight lines, off the grid's 16
            directions, and measured as a runner's track is.</p>
          <p>The <b>decision map</b> colours each point by the time lost going through it: dark green on a best route, then light green, yellow and
            orange up to the variants' margin; nothing beyond. It shows at a glance the corridors of the good choices and what leaving them costs.</p>
          <p>Each variant says whether it goes left, right or straight against the line between the controls.</p>`)}
        ${slide("Coach · trial", "5. Your route", html`
          <p>A GPS track runs a few metres beside the path it follows (the GPS's error and the calibration's): measured as it is, it would go
            through the forest and cost more than the path. Ozimut therefore lays it on the map: the model's fastest way that keeps within its margin
            of error (12 to 25 m, from the calibration), on the path when the track runs along it. Then it measures the share of that route following
            each computed route. When it follows one for at least 80% of its length, that is the <b>route taken</b> and its time counts; otherwise
            the list shows the share of each ("A 60% · B 35%") and the laid track's own time counts.</p>
          ${list([
            html`<b>Choice</b>: the route taken's time minus route A's — zero when you took A;`,
            html`<b>Execution</b>: your actual time minus the route taken's time — what the running itself cost (hesitations, mistakes,
              terrain slower than the map says).`,
          ])}
          <p>With the automatic pace, execution is zero at the median: it shows which legs were slower or faster than usual.</p>`)}
        ${slide("Coach · trial", "6. The calibration on the legs run", html`
          <p>The default speeds are an average runner's. The legs whose route is known say what they are worth for this runner: we know how many
            metres they ran on a path, off it, uphill, and in how much time. Ozimut draws three numbers from them (the box "Calibrate the speeds on the
            legs run", ticked by default):</p>
          ${list([
            html`their <b>pace</b> in flat runnable forest;`,
            html`their <b>speed on paths</b> against the forest — only when at least two legs run mostly on paths and two mostly off them;`,
            html`the <b>climb's cost</b> — only when climbing is 4% of the time over at least six legs.`,
          ])}
          <p>With few legs these values move little: they leave the defaults only when the legs say so clearly. Legs over 25% off the model (a
            mistake, a stop, a misread map) are set aside before a second fit: the calibration must not absorb the mistakes the execution is there
            to show. The routes are then computed again with these speeds: A is the best route <i>for this runner</i>, the choice is measured against
            it, the execution against their usual speeds. In “Compare with the other runners”, the speed on paths and the climb are calibrated on the whole group
            (every leg of every runner), and each runner keeps their own pace.</p>`)}`,
    });
  }

  // ======================================================================================================
  // Orga (« Course setting », its other tab, is content/methods.*.js' tracerDoc)
  // ======================================================================================================
  const ORGA = [["qui", "Who organises"], ["resultats", "Results"], ["horaires", "Start times"], ["direct", "Live feed"], ["suivi", "GPS tracking"],
    ["analyses", "Analyses"], ["declarer", "Created competitions"]];
  function orga() {
    return chapters(ORGA, {
      qui: () => html`
        ${slide("Orga", "The organisers' pages", html`
          <p>Orga serves the clubs that organise; it is turned on when registering, in Settings or on the modules page, and is used on a computer. A
            competition's organiser is ${fr ? "any member of its organising club — the club of their latest known race — or " : ""}the account that
            declared it, outside France. A training session can be created by any account.</p>
          ${list([
            html`${P("#/orga-analyses", "Analyses")}: preparing the analysis of the club's competitions and of its training sessions.`,
            html`${P("#/orga-resultats", "Results")} and ${P("#/orga-horaires", "Start times")}: uploading the results and the start list.`,
            html`${P("#/orga-direct", "Live feed")}: broadcasting the results live from the timing software, and giving the GPS tracking link.`,
            html`${P("#/orga-tracer", "Course setting")}: setting the courses; its guide is the ${D("tracer", "Course setting")} tab.`,
          ])}`)}`,
      resultats: () => html`
        ${slide("Orga", "Uploading the results", html`
          <p>For a competition of your club, ${P("#/orga-resultats", "Orga › Results")} shows what Arena already has of it, and “Upload the
            results” adds your file, in three steps:</p>
          <div class="mx-steps">
            <div class="mx-step"><b>The file</b>An IOF XML export from your software (the best: it carries the courses and the split times), or OE or MeOS
              HTML, or a PDF; zipped or not, 30 MB at most.</div>
            <div class="mx-step"><b>The check</b>The file is read in your browser, nothing is sent: summary, results course by course, the timing check
              (units set wrong, cards not cleared), and every view of the analysis.</div>
            <div class="mx-step"><b>Publishing</b>“Publish” sends it: the race appears in Arena within minutes, marked as uploaded by the organiser, and
              is no longer looked for elsewhere. A new upload replaces the previous one.</div>
          </div>`)}`,
      horaires: () => html`
        ${slide("Orga", "Publishing the start times", html`
          <p>${P("#/orga-horaires", "Orga › Start times")} publishes the start list of a coming competition of your club, up to race day. Files
            read: IOF XML “StartList” (the best), CSV, a sheet with one pair of columns per course, HTML, OE or MeOS PDF, or a shared Google Sheets
            link.</p>
          ${list([
            html`The file is first read and checked in your browser: two runners of one club one after the other, a start minute shared, runners
              without a time, a card or a course, the intervals and the vacant places.`,
            html`“Check and export” also writes the start's file for the O Checklist app.`,
            html`“Open the booking” replaces the shared sheet where runners put their names down for a start time: you set the courses (first and
              last start, interval), the gap between two runners of the same club, the closing; each runner books on Ozimut with their account, for
              themselves and for others (their family, members of a club or not, of any club or none); a Google Sheet already filled in is imported
              with all its tabs. At the closing, the bookings become the published start list, and you download the CSV or the IOF XML for MeOS or OE.`,
            html`Once published, the list appears in Arena (the competition's start list), and every runner who asked for it gets their start time by
              notification or by e-mail.`,
          ])}`)}`,
      direct: () => html`
        ${slide("Orga", "Broadcasting live", html`
          <p>${P("#/orga-direct", "Orga › Live feed")} shows your results live in Arena without going through liveresultat. A broadcast opens with a name,
            a date and, if possible, the competition it belongs to. Then, either:</p>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--s1)"><h3>From MeOS</h3><p>MeOS's “Online Results” service sends its results itself to the address, number
              and password the page gives; the radio controls' split times follow.</p></div>
            <div class="mx-box" style="--c:var(--s3)"><h3>From a file</h3><p>Your software exports the results list every few seconds (IOF XML, OE or
              MeOS HTML); the page, open on the arena computer in Chrome or Edge, reads that file again and sends what changes.</p></div>
          </div>
          <p>Tied to its competition, a broadcast is kept after the race: its results, split times and start list stay in Arena. It is still a
            trial version: try it first at a training session, or beside the usual live results.</p>`)}`,
      suivi: () => html`
        ${slide("Orga", "GPS tracking", html`
          <p>Ozimut tracks nobody by GPS. If your competition uses a tracking service (Loggator, GPSSeuranta, TracTrac, Livelox, Routechoices…), give
            its link in ${P("#/orga-direct", "Orga › Live feed")}: it appears on the competition in Arena, with its results and live page. Only the link is
            published.</p>`)}`,
      analyses: () => html`
        ${slide("Orga", "Preparing an analysis", html`
          <p>${P("#/orga-analyses", "Analyses")} has four tabs: “Opened analyses” (those already opened, where the page opens: choose one,
            then “Manage the analysis”), “Open a competition” (your club's competitions of the last 60 days whose analysis is not opened yet: choose
            one, then “Open the analysis”), “New competition” (outside France) and “New training session”. An analysis is then prepared
            course by course:</p>
          ${list([
            html`<b>The map</b>: an image, a PDF or a KMZ, kept as it is, with no loss of quality.`,
            html`<b>Its placing</b>: from a KMZ, a world file, an IOF XML with coordinates, or your own track.`,
            html`<b>The course</b>: read on the map, the controls' order from the courses' IOF XML, your track, or your clicks.`,
            html`<b>Access</b>: every account, the club's members — and, if you wish, your invitees from other clubs or from none, with a code; the other accounts see the analysis in the list, with an invitation to ask you for that code —, or a password. “View as runners see it” shows the page as they will.`,
          ])}
          <p>The analysis's page is for managing it, not for analysing: the list of courses, the map of the one chosen with its course drawn to check
            it, the publication (a new analysis stays a draft only the organisers see, until “Publish”), what the runners can do (add their track,
            “Solo analysis” on your map, “My maps”, comments, route choices, 3D view, video, computed routes), and the attendance: the accounts that
            opened it, the tracks per course, those who replayed it alone without sharing a track — counts only, never who.</p>
          <p>Runners find it in Coach (“Analysis › Compare with the other runners”). Course setting can also publish its courses, map included, to an analysis (after the race for
            a competition).</p>`)}`,
      declarer: () => html`
        ${slide("Orga", "Creating a competition, outside France", html`
          <p>French competitions come from ${fr ? "FFCO's" : "the French federation's"} calendar. In the other countries, an account that is a member of the country creates its competition
            itself, in the “My created competitions” box of the Results and Start times pages, and in the “New competition” tab of Analyses: country, club, name, date, place,
            discipline, format, website. It then appears in Arena among its country's competitions, and its organiser can upload its start list, results
            and analyses. Who created it is not published.</p>`)}`,
    });
  }

  const LABELS = { site: "The site", arena: "The competitions", coach: "Coach", orga: "The tools" };
  return { LABELS, LEDE, ARENA, COACH, ORGA, site, arena, coach, orga };
}
