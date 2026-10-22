// "Organising › Live feed" (pages/orgdirect.js): how it works, in English; orgdirect.fr.js is the reference.
export const steps = `
  <h3 style="margin:0 0 6px">With MeOS: online results</h3>
  <ol class="od-steps">
    <li>Choose the race below, or create it. The “From MeOS” card then gives three values: the address, the competition number and
      its password.</li>
    <li>In MeOS, <b>Services</b> tab, add the <b>Online Results</b> service. Tick “Send to the web” and copy the address (URL), the
      “Competition ID number” and the “Password”. Export format: “MeOS Online Protocol XML 2.0”. An interval of 10 to 15 seconds
      is fine.</li>
    <li>Under “Controls”, tick the radio controls: their times arrive live. Also tick <b>“Send all punches after card
      readout”</b>: at each finish, all the runner's split times are published.</li>
    <li>Click “Start”. MeOS first sends the whole race, then only what changes. The “From MeOS” card shows when it last received
      something. Nothing needs to stay open on Ozimut: only MeOS must stay connected to the internet.</li>
    <li>Test it the day before with the race being prepared: the runners appear in “Live” even before the start.</li>
  </ol>
  <h3 style="margin:14px 0 6px">With other software: before the race</h3>
  <ol class="od-steps">
    <li>In your timing software, set up an <b>automatic export of the results list</b> to a file, every 15 to 30 seconds,
      always to the same place and under the same name.
      <ul>
        <li>The recommended format is <b>IOF XML 3.0</b> (results list): it holds the start times, the split times and the
          runners still out.</li>
        <li>The HTML results lists of MeOS and OE (SportSoftware) are read too, but they only show the runners who have
          finished or retired.</li>
        <li>If your software can't export at regular intervals, export the file by hand from time to time, under the same name:
          the page picks up each new version.</li>
      </ul></li>
    <li>Do a test the day before, with the file of a past race or of the race being prepared.</li>
  </ol>
  <h3 style="margin:14px 0 6px">On race day</h3>
  <ol class="od-steps" start="3">
    <li>On the arena computer, connected to the internet, open this page in <b>Chrome or Edge</b>. Firefox and Safari don't let a
      page re-read a file on its own.</li>
    <li>Log in to Ozimut with the account that creates the broadcast: only that account can feed it afterwards. You can create it
      the day before, from here or from another computer.</li>
    <li>Choose the race below, or create it: its name, its date and the organiser are enough.</li>
    <li>Choose the exported file, <b>once only</b>. The browser asks for permission to read it.</li>
    <li>Click “Start”. The page re-reads the file on its own, every 15 seconds by default, and only sends what has changed.</li>
    <li>Leave the page open, preferably in its own window, and the computer on, without sleep mode. If the page is reloaded,
      one click on “Resume” is enough.</li>
  </ol>
  <h3 style="margin:14px 0 6px">What you don't need to do</h3>
  <ul class="od-steps">
    <li>Courses, classes, controls and runners don't need to be declared: they come from the file, and a course that appears during
      the race is added.</li>
    <li>Runners are recognised by their name and club, and linked to their page on Ozimut.</li>
  </ul>
  <p style="margin:12px 0 0">Spectators follow the race in <b>Races › Live</b>: the link appears below once the race is chosen.</p>`;
