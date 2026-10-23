// Who may read each country's data (site/data/<cc>/; countries/base.py ACCESS — keep the two in step). A country the site
// has no data for is not listed: its folder is nobody's (the login gate, _middleware.js `needs`).
//   "members": the accounts that joined it (an accepted membership, the session's `cc`) — France: the FFCO's older seasons
//              are members-only on its own site;
//   "all":     every signed-in account — Spain: every result is public, so what is computed from them is too (owner,
//              2026-10-22).
// (Its own module: the login gate imports it, and countries.js imports api.js, which imports the gate.)
export const DATA_ACCESS = { FR: "members", ES: "all" };
// the countries whose agenda alone the site reads (countries/agenda.py, 2026-10-23): open to everyone, as their calendars are
for (const cc of ["AT", "BE", "BG", "BR", "BY", "CH", "CZ", "DE", "DK", "EE", "GB", "HK", "IL", "IT", "JP", "KR", "LT", "RO",
  "RS", "TR", "UA", "ZA"]) DATA_ACCESS[cc] = "all";
