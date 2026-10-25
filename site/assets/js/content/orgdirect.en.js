// "Organising › Live feed" (pages/orgdirect.js): how it works, in English; orgdirect.fr.js is the reference.

export const overview = `
  <ol class="od-overview">
    <li><b>The race</b>: choose it or create it, once.</li>
    <li><b>Sending the results</b>: choose your software, <b>MeOS</b> or <b>another one</b>. Only the instructions for your choice
      are shown: the two ways are not combined.</li>
    <li><b>After the race</b>: tied to a competition of your club, the race stays in “Results”.</li>
  </ol>`;

export const common = `Either way, nothing needs declaring beforehand: courses, classes, controls and runners come from your
  software, and a course that appears during the race is added. Runners are recognised by their name and club, and linked to
  their page on Ozimut.`;

export const meos = `
  <p class="od-what">MeOS itself sends its results, radio controls and split times to Ozimut. <b>Nothing needs to stay open on
    Ozimut</b> and there is no file to choose: only MeOS must stay connected to the internet.</p>
  <h3>In MeOS</h3>
  <ol class="od-steps">
    <li>In the <b>Services</b> tab, add the <b>Online Results</b> service.</li>
    <li>Tick “Send to the web” and copy the three values below: the address (URL), the “Competition ID number” (the number) and
      the “Password”. Export format: “MeOS Online Protocol XML 2.0”. An interval of 10 to 15 seconds is fine.</li>
    <li>Under “Controls”, tick the radio controls: their times arrive live. Also tick <b>“Send all punches after card
      readout”</b>: at each finish, all the runner's split times are published.</li>
    <li>Click “Start” in MeOS. It first sends the whole race, then only what changes; the last reception shows under the
      values.</li>
  </ol>
  <p class="od-tip">Test it the day before with the race being prepared: the runners appear in “Live” even before the start, and
    their start times in the “Agenda”.</p>`;

export const file = `
  <p class="od-what">For OE (SportSoftware), other software, or MeOS without its “Online Results” service: the software exports
    the results list to a file, and <b>this page, left open on the arena computer, re-reads that file</b> and sends it to
    Ozimut.</p>
  <h3>Before the race</h3>
  <ol class="od-steps">
    <li>In your timing software, set up an <b>automatic export of the results list</b> to a file, every 15 to 30 seconds,
      always to the same place and under the same name.
      <ul>
        <li>The recommended format is <b>IOF XML 3.0</b> (results list): it holds the start times, the split times and the
          runners still out.</li>
        <li>The HTML results lists of MeOS and OE are read too, but they only show the runners who have finished or
          retired.</li>
        <li>If your software can't export at regular intervals, export the file by hand from time to time, under the same name:
          the page picks up each new version.</li>
      </ul></li>
    <li>Do a test the day before, with the file of a past race or of the race being prepared.</li>
  </ol>
  <h3>On race day</h3>
  <ol class="od-steps">
    <li>On the arena computer, connected to the internet, open this page in <b>Chrome or Edge</b> (Firefox and Safari don't let a
      page re-read a file on its own), logged in with the account that created the race in step 1: only that account can feed
      it.</li>
    <li>Choose the exported file below, <b>once only</b>. The browser asks for permission to read it.</li>
    <li>Click “Start”. The page re-reads the file on its own, every 15 seconds by default, and only sends what has changed.</li>
    <li>Leave the page open, preferably in its own window, and the computer on, without sleep mode. If the page is reloaded,
      one click on “Resume” is enough.</li>
  </ol>`;

export const after = `
  <ul class="od-steps">
    <li>A race tied to a competition of your club is saved every few minutes and published in <b>Races › Results</b>: the
      results, the split times (in “Race analysis”) and, before the start, the start list. Runners get the “one of my races is
      online” alert once the race is over.</li>
    <li>“Publish now” saves it at once, without waiting for the next update.</li>
    <li>A results file deposited later under <b>Organising › Results</b> comes before the broadcast, as does a start list
      deposited under “Start times”.</li>
    <li>A race created without a competition can be tied to it later, here: only members of the organising club can. Without a
      competition, it only shows in “Live”.</li>
  </ul>`;
