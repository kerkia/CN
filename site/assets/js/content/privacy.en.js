// The privacy policy and legal notices, in English — a translation for information; the French version (privacy.fr.js)
// prevails. Keep the two in step.
export const body = (SITE) => `
      <p class="muted"><i>This English version is provided for information; the French version prevails.</i></p>
      <p>${SITE} is an independent site, not affiliated with the French orienteering federation (FFCO). It is published on a
        personal, non-commercial basis by <b>Yann Le Helloco</b>, controller of the personal data described below within the
        meaning of Regulation (EU) 2016/679 (GDPR). Contact: <b>ocn@kerkia.com</b>.</p>
      <h2 style="font-size:16px">Terms of use</h2>
      <p>${SITE} runs on free, limited resources shared by all its users. It is meant to be consulted personally by licence
        holders, with a web browser. Unless the publisher has agreed beforehand, the following are therefore forbidden: automated
        collection (robots, scripts, scraping of pages or data files), mass downloads, reuse of the data for other purposes, and any
        use likely to overload the site at the expense of other users. An account that breaks these rules may be suspended.</p>
      <p>For a particular need (a study, the needs of a club or a region, data meant for another tool), you can write to the
        publisher, through the “Contact us” page or at ocn@kerkia.com: the request will be considered.</p>
      <h2 style="font-size:16px">Results data, including that of licence holders without an account</h2>
      <p>The rankings, results and calculations shown come from the results published by the FFCO on cn.ffcorientation.fr: the
        name, club, class, licence number, time and place of each ranked licence holder, whether or not they have an account on
        ${SITE}, minors included. ${SITE} derives from them recomputed CNs, rankings, comparisons and statistics (clubs, territories,
        age pyramid, runners met in races). The “Results” page also shows, for the races of the last 60 days, the results published
        by the organisers themselves (on their website, liveresultat, WinSplits, Helga, etc.) or uploaded to ${SITE}, matched to
        licences by name and club.</p>
      <p>This processing is based on the publisher's legitimate interest in informing licence holders and analysing the national
        ranking from results already published. On ${SITE}, this data is only accessible to logged-in accounts, which are reserved
        for licence holders. Anyone concerned may ask for it to be corrected or ask no longer to be identified (see “Your rights”);
        the source remains the FFCO's website.</p>
      <h2 style="font-size:16px">Results and start-list uploads</h2>
      <p>When a results file is uploaded, the uploader's account, the race, the file's name and size and the date of the upload are
        recorded. The file is kept for 60 days in the site's storage (Cloudflare), then erased; the results it contains remain on
        display. The administrator sees who made each upload and can remove an upload. The start lists an organiser uploads before
        the race (“Organising › Start times”) follow the same rules; only the names, clubs, classes and start times are published,
        and the race's organisers can remove them.</p>
      <h2 style="font-size:16px">GPS track analyses</h2>
      <p>The “Solo analysis” page reads the map and the GPS track in your browser: no data is sent to the site, and these files are
        kept only for the duration of the visit.</p>
      <p>In a “Group analysis” (training or competition), the organiser uploads the maps and the courses, and each participant can
        add their own track. It is then sent to and kept in the site's storage (Cloudflare), with the participant's name and licence
        number, reduced to the positions and times within the map's area (without heart rate, cadence or any route off the map). It
        is visible to the people allowed to open the analysis, as the organiser chooses: all logged-in licence holders, the members
        of their club, or those who hold the password. Each participant can remove their track at any time; it is erased with the
        analysis and with their account. An analysis's maps are kept as long as it exists; if the organiser deletes their account,
        the analysis remains, without their name. In a “Group analysis”, your own graphs (pace, heart rate, cadence, etc.) come from
        your file, kept in your browser on this device: it is not sent, and only you have access to it.</p>
      <h2 style="font-size:16px">Course setting</h2>
      <p>An event of the “Course setting” page (its courses, its map, its versions, the team's comments and the states of the
        controls noted in field mode) is kept in the site's storage (Cloudflare) and is only accessible to its team: its creator and
        the licence holders they add, whose name and licence number are recorded with their role. Versions, comments and control
        states carry their author's name. In field mode, the state noted on a control also records the phone's position at that
        moment (to compare it with the map), visible to the team, and the team can attach photos of the controls (they may show
        people: avoid it), erased with the event; the position is only read during that mode, with the browser's permission. If the
        team encrypts the event, this data is encrypted in the browser and unreadable by the site. The event is kept until its
        creator deletes it; if the creator deletes their account, it passes to the team's first course setter (failing that,
        controller) who has an account, otherwise it is deleted. The climb calculation sends to IGN's elevation service
        (Géoplateforme, France) only the coordinates of the controls and of the courses' bends, with no name or code.</p>
      <h2 style="font-size:16px">Questions to the AI</h2>
      <p>On the “AI” page, your question is sent to the language model that writes the query, with the description of the site's
        tables, today's date, your licence number and the chosen method and discipline: by default O'CN's model, run by Cloudflare
        (Workers AI); neither the site nor Cloudflare keeps the questions. The query then runs in your browser, on the data the site
        publishes: that data is sent to no model. If you use your own API key (Anthropic, OpenAI, Google or OpenRouter), your browser
        sends these same elements directly to that provider, under your account and its terms (with a free key, Google may use the
        questions to improve its products); the key stays in your browser and is never sent to O'CN.</p>
      <h2 style="font-size:16px">Your account's data</h2>
      <ul>
        <li><b>Data kept:</b> the email address; the first name, surname and licence number entered, checked at registration against
          the results published by the FFCO; the password, in an irreversibly encrypted form; the dates of registration and last
          login; the language chosen for the site and the emails; the alert settings (regions chosen) and the list of races already announced by email; for the relay simulator, the
          runners added (name, class, estimated CN) and those marked unavailable, visible to you alone. Only add people who agree to
          it.</li>
        <li><b>Purposes and legal bases:</b> performing the service requested when the account is created (reserving access to FFCO
          licence holders, confirming the email address, resetting the password); the publisher's legitimate interest in detecting
          several accounts for the same licence; your consent for alerts by email or notification, which you can withdraw at any time in Settings.</li>
        <li><b>Retention period:</b> until the account is deleted, which you can do at any time in Settings. An email waiting to be
          sent is erased as soon as it is sent.</li>
        <li><b>Recipients:</b> the site's administrator and the technical providers listed below. No data is sold or used for
          advertising.</li>
      </ul>
      <p>A message sent through the “Contact us” page reaches the publisher by email, with your address, your name and the browser
        used; it is kept in their mailbox for as long as needed to handle the request.</p>
      <h2 style="font-size:16px">Notifications</h2>
      <p>If you allow O'CN's notifications on a device, the site keeps, for that device, the sending address given to it by your
        browser's notification service (Google for Chrome and Android, Apple for Safari, Mozilla for Firefox, Microsoft for Edge), the
        keys used to encrypt the messages and the kind of device (for example “Chrome · Android”). The messages (your start time,
        your results going online, the calendar's races, as you chose) are encrypted end to end: the notification service carries
        them without being able to read them. The site also keeps the last start time notified for each race, so that it is sent
        again only if it changes, and the notifications waiting to be sent, for a few days at most. Legal basis: your consent, given
        by allowing notifications and withdrawn at any time in Settings or in your browser's settings. These data are erased when you
        turn notifications off on the device, when you sign out on that device, and with the account.</p>
      <h2 style="font-size:16px">Usage statistics</h2>
      <p>To know how the site is used and to improve it (legitimate interest), the site records, for each account, the number of
        pages viewed per day and per section (Ranking, Runner, Network, etc.) and the number of visits. No other data is recorded for
        this purpose: neither the searches made nor the IP address. These statistics are only accessible to the administrator; they
        are kept for 13 months and deleted with the account.</p>
      <h2 style="font-size:16px">Security</h2>
      <p>To limit repeated attempts (login, registration, forgotten password), the site counts the attempts per IP address and per
        email address (legitimate interest); these counters are erased after about a day. The host may also process the IP address to
        deliver the pages and protect the site against attacks.</p>
      <h2 style="font-size:16px">Providers and transfers outside the European Union</h2>
      <p>The following providers process data on the publisher's behalf:</p>
      <ul>
        <li><b>Cloudflare, Inc.</b> (United States) hosts the site, its account database and its file storage, and runs the language
          model of the “AI” page. Transfers to the United States rely on the EU-US Data Privacy Framework, to which Cloudflare has
          signed up.</li>
        <li><b>Resend</b> (Plus Five Five, Inc., United States) sends the site's emails, which involves the recipient's address and
          the content of the message. Transfers are covered by the European Commission's standard contractual clauses.</li>
        <li><b>GitHub, Inc.</b> (United States) runs the site's automatic updates; the results and uploaded files are processed there,
          but not the account data. Transfers are covered by the standard contractual clauses.</li>
      </ul>
      <h2 style="font-size:16px">Cookies and local storage</h2>
      <p>The site sets a single cookie, strictly necessary for it to work: it keeps you logged in, for 30 days at most. The browser
        also keeps, on your device, your display preferences (language, theme, chosen discipline and method), what you enter in the MAS
        calculator or the relay simulator and, for course setting, its display settings, the key of an encrypted event, derived from
        its passphrase (for the duration of the tab), the field-mode states waiting for the network and, if you keep an event to work
        offline, its copy (courses and map, encrypted if it is) and the site's files, erased when you log out; if you use your own API
        key on the “AI” page, that key (for the duration of the tab, or on the device if you ask; erased when you log out). The site
        uses no advertising tracker and no third-party audience measurement tool; no consent is therefore required.</p>
      <h2 style="font-size:16px">Your rights</h2>
      <p>Under the GDPR, you have a right of access, rectification, erasure and portability of your data, a right to restrict its
        processing and a right to object to processing based on the publisher's legitimate interest.</p>
      <p>In particular, you can ask no longer to be identified on ${SITE}, unless there are compelling legitimate grounds: your name
        and licence number are then replaced, throughout the site, by an anonymous mention (“Anonymous runner”). Your times and places
        are still taken into account, without your name or licence number, so that the other licence holders' rankings are not
        changed; the measure can be reversed at your request. A request to erase results data is handled in the same way; an
        account, on the other hand, is deleted entirely. The data of a minor licence holder is anonymised, and their account deleted
        if they have one, on simple request by their legal representative, who exercises these rights on their behalf.</p>
      <p>You can delete your account yourself, in Settings. Other requests should be sent to ocn@kerkia.com; they are answered within
        one month. If there is reasonable doubt about the requester's identity, proof may be requested. If you consider that your
        rights are not respected, you can lodge a complaint with the CNIL
        (<a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">cnil.fr/fr/plaintes</a>), the French data
        protection authority.</p>
      <h2 style="font-size:16px">Legal notices</h2>
      <p><b>Publisher and publication director:</b> Yann Le Helloco, private individual, non-professional publication;
        contact: ocn@kerkia.com.<br>
        <b>Host:</b> Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, United States; telephone: +1 888 993 5273.</p>
      <p class="muted">Last updated: 18 October 2026.</p>
`;
