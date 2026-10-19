// The Tracer's ribbon, as data (owner, 2026-10-17: the « Ozimut mode », by default; the menus of icons.js stay as the « Purple Pen
// mode »). Shared by the editor (ribbon.js draws it), the guide (pages/methods.js: « L'écran », « Le ruban ») and the messages
// that name where a command is (where()). Tabs follow the setter's work; contextual tabs (CONTEXT) come with the selection.
// An item: { t: "big" | "small", act (an action of dialogs.js, or one of ribbon.js) | tool (an editor tool), label, icon, key,
// tip, need, split }. need: "edit" (not read-only), "course" (a course chosen), "vector" (an OCAD or Mapper map), "after" (from
// the race day, for a competition). { t: "stack", items } piles up to three small ones; { t: "gallery" } the special objects;
// { t: "field", id } a setting drawn by ribbon.js; { t: "chip", id } live figures; { t: "modes", id } choices with a preview.

import { MENUS } from "./icons.js";
import { t } from "./lang.js";

const B = (act, label, icon, o = {}) => ({ t: "big", act, label, icon, ...o });
const S = (act, label, icon, o = {}) => ({ t: "small", act, label, icon, ...o });
const T = (tool, label, icon, o = {}) => ({ t: o.small ? "small" : "big", tool, label, icon, need: "edit", ...o });
const stack = (...items) => ({ t: "stack", items });

/** The special objects of the gallery, the most used first (the rest under ▾). */
export const GALLERY = ["water", "first-aid", "out-of-bounds", "boundary", "dangerous-area", "forbidden-route", "text", "image"];

export const TABS = [
  { id: "file", label: t("trc.rd.tabFile"), key: "F", backstage: true },
  { id: "home", label: t("trc.rd.tabHome"), key: "T", icon: "control", guide: "postes", groups: [
    { id: "select", title: t("trc.rd.gSelect"), items: [T("select", t("trc.rd.select"), "select", { key: "S", need: null,
      tip: t("trc.rd.selectTip") })] },
    { id: "controls", title: t("trc.rd.gControls"), items: [
      T("control", t("trc.rd.control"), "control", { key: "P", tip: t("trc.rd.controlTip") }),
      T("start", t("trc.rd.start"), "start", { key: "D", tip: t("trc.rd.startTip") }),
      T("finish", t("trc.rd.finish"), "finish", { key: "A", tip: t("trc.rd.finishTip") }),
      stack(T("crossing", t("trc.rd.crossing"), "crossing", { small: true, key: "O", tip: t("trc.rd.crossingTip") }),
        T("issue", t("trc.rd.issue"), "issue", { small: true, tip: t("trc.rd.issueTip") }),
        T("exchange", t("trc.rd.exchange"), "exchange", { small: true, tip: t("trc.rd.exchangeTip") }))] },
    { id: "legs", title: t("trc.rd.gLegs"), items: [stack(
      T("bend", t("trc.rd.bend"), "bend", { small: true, key: "C", tip: t("trc.rd.bendTip") }),
      T("gap", t("trc.rd.gap"), "gap", { small: true, key: "X", tip: t("trc.rd.gapTip") }),
      T("route", t("trc.rd.route"), "route", { small: true, tip: t("trc.rd.routeTip") }))] },
    { id: "specials", title: t("trc.rd.gSpecials"), launcher: "special-more", items: [{ t: "gallery" }] },
    { id: "descr", title: t("trc.rd.gDescr"), guide: "definitions", launcher: "standards", items: [
      T("descr", t("trc.rd.descr"), "descr", { tip: t("trc.rd.descrTip") }),
      stack({ t: "field", id: "descStandard" }, { t: "field", id: "lang" }, S("custom-text", t("trc.rd.customText"), "text", { need: "edit", tip: t("trc.rd.customTextTip") }))] },
  ] },
  { id: "courses", label: t("trc.rd.tabCourses"), key: "C", icon: "course", guide: "circuits", groups: [
    { id: "course", title: t("trc.rd.gCourse"), launcher: "course-props", items: [
      B("course-new", t("trc.rd.courseNew"), "addcircle", { need: "edit", tip: t("trc.rd.courseNewTip") }),
      B("course-props", t("trc.rd.courseProps"), "pencil", { need: "course", tip: t("trc.rd.coursePropsTip") }),
      stack(S("course-dup", t("trc.rd.courseDup"), "copy", { need: "course", tip: t("trc.rd.courseDupTip") }),
        S("course-order", t("trc.rd.courseOrder"), "sort", { need: "edit", tip: t("trc.rd.courseOrderTip") }),
        S("course-delete", t("trc.rd.courseDelete"), "trash", { need: "course", tip: t("trc.rd.courseDeleteTip") }))] },
    { id: "variations", title: t("trc.rd.gVariations"), items: [
      B("var-fork", t("trc.rd.varFork"), "fork", { need: "course", tip: t("trc.rd.varForkTip") }),
      B("var-loop", t("trc.rd.varLoop"), "loop", { need: "course", tip: t("trc.rd.varLoopTip") }),
      stack(S("relay", t("trc.rd.relay"), "relay", { need: "course", tip: t("trc.rd.relayTip") }),
        S("var-delete", t("trc.rd.varDelete"), "removecircle", { need: "course", tip: t("trc.rd.varDeleteTip") }),
        S("part-options", t("trc.rd.partOptions"), "parts", { need: "course", tip: t("trc.rd.partOptionsTip") }))] },
    { id: "print", title: t("trc.rd.gPrint"), guide: "sorties", launcher: "print-area", items: [
      B("print-area", t("trc.rd.printArea"), "frame", { tip: t("trc.rd.printAreaTip") }),
      stack({ t: "field", id: "printScale" }, { t: "field", id: "paper" }, S("view-printarea", t("trc.rd.viewPrintarea"), "frame", { toggle: "printArea", tip: t("trc.rd.viewPrintareaTip") }))] },
    { id: "numbers", title: t("trc.rd.gNumbers"), items: [
      stack(S("numbering", t("trc.rd.numbering"), "hash", { need: "edit", tip: t("trc.rd.numberingTip") }),
        S("codes", t("trc.rd.codes"), "tag", { need: "edit", tip: t("trc.rd.codesTip") }),
        S("renumber", t("trc.rd.renumber"), "renumber", { need: "edit", tip: t("trc.rd.renumberTip") })),
      stack(S("remove-unused", t("trc.rd.removeUnused"), "trash", { need: "edit", count: "unused", tip: t("trc.rd.removeUnusedTip") }),
        S("punch", t("trc.rd.punch"), "dots", { need: "edit", tip: t("trc.rd.punchTip") }))] },
  ] },
  { id: "map", label: t("trc.rd.tabMap"), key: "A", icon: "map", guide: "carte", groups: [
    { id: "mapfile", title: t("trc.rd.gMapfile"), items: [
      B("map-change", t("trc.rd.mapChange"), "swap", { need: "edit", tip: t("trc.rd.mapChangeTip") }),
      stack({ t: "chip", id: "mapInfo" }, S("event-props", t("trc.rd.eventProps"), "sliders", { need: "edit", tip: t("trc.rd.eventPropsTip") }),
        S("import-course", t("trc.rd.importCourse"), "scan", { need: "edit", tip: t("trc.rd.importCourseTip") }))] },
    { id: "position", title: t("trc.rd.gPosition"), items: [
      B("calage", t("trc.rd.calage"), "target", { need: "edit", tip: t("trc.rd.calageTip") }),
      stack(S("georef", t("trc.rd.georef"), "globe", { tip: t("trc.rd.georefTip") }),
        S("move-all", t("trc.rd.moveAll"), "move", { need: "edit", tip: t("trc.rd.moveAllTip") }), { t: "chip", id: "geoInfo" })] },
    { id: "purple", title: t("trc.rd.gPurple"), launcher: "appearance", items: [{ t: "modes", id: "blend" },
      stack(S("appearance", t("trc.rd.appearance"), "palette", { need: "edit", tip: t("trc.rd.appearanceTip") }),
        S("overprint", t("trc.rd.overprint"), "layers", { need: "vector", toggle: "overprint", tip: t("trc.rd.overprintTip") }))] },
    { id: "symbols", title: t("trc.rd.gSymbols"), launcher: "appearance", items: [stack({ t: "field", id: "circle" }, { t: "field", id: "line" }, { t: "field", id: "number" }),
      stack({ t: "field", id: "mapStandard" })] },
    { id: "view", title: t("trc.rd.gView"), items: [
      stack(S("view-course", t("trc.rd.viewCourse"), "fit", { tip: t("trc.rd.viewCourseTip") }), S("view-map", t("trc.rd.viewMap"), "map", { tip: t("trc.rd.viewMapTip") }),
        S("view-all", t("trc.rd.viewAll"), "view", { toggle: "allControls", tip: t("trc.rd.viewAllTip") })),
      stack(S("view-others", t("trc.rd.viewOthers"), "layers", { tip: t("trc.rd.viewOthersTip") }), { t: "field", id: "intensity" })] },
  ] },
  { id: "check", label: t("trc.rd.tabCheck"), key: "V", icon: "shield", guide: "verifier", badge: "issues", groups: [
    { id: "audit", title: t("trc.rd.gAudit"), items: [B("rep-audit", t("trc.rd.repAudit"), "shield", { badge: "issues",
      tip: t("trc.rd.repAuditTip") }), { t: "chip", id: "issues" }] },
    { id: "reports", title: t("trc.rd.gReports"), items: [
      B("rep-summary", t("trc.rd.repSummary"), "list", { tip: t("trc.rd.repSummaryTip") }),
      B("rep-legs", t("trc.rd.repLegs"), "ruler", { tip: t("trc.rd.repLegsTip") }),
      stack(S("rep-cross", t("trc.rd.repCross"), "table", { tip: t("trc.rd.repCrossTip") }),
        S("rep-load", t("trc.rd.repLoad"), "bars", { tip: t("trc.rd.repLoadTip") }),
        S("export-csv", t("trc.rd.exportCsv"), "table", { tip: t("trc.rd.exportCsvTip") }))] },
    { id: "calc", title: t("trc.rd.gCalc"), guide: "calculs", items: [
      B("rep-climb", t("trc.rd.repClimb"), "mountain", { tip: t("trc.rd.repClimbTip") }),
      B("rep-times", t("trc.rd.repTimes"), "stopwatch", { tip: t("trc.rd.repTimesTip") }),
      stack(S("load", t("trc.rd.load"), "bars", { need: "edit", tip: t("trc.rd.loadTip") }))] },
    { id: "figures", title: t("trc.rd.gFigures"), items: [{ t: "chip", id: "course" }] },
  ] },
  { id: "out", label: t("trc.rd.tabOut"), key: "I", icon: "printer", guide: "sorties", groups: [
    { id: "pdf", title: "PDF", items: [
      B("pdf-courses", t("trc.rd.pdfCourses"), "printer", { split: [["pdf-course", t("trc.rd.pdfThisCourse")], ["pdf-courses", t("trc.rd.pdfAllCourses")]],
        tip: t("trc.rd.pdfCoursesTip") }),
      B("pdf-descriptions", t("trc.rd.pdfDescriptions"), "descr", { tip: t("trc.rd.pdfDescriptionsTip") }),
      B("pdf-punch", t("trc.rd.pdfPunch"), "punch", { tip: t("trc.rd.pdfPunchTip") })] },
    { id: "timing", title: t("trc.rd.gTiming"), items: [
      B("export-iof3", "IOF XML", "stopwatch", { split: [["export-iof3", "IOF XML 3.0"], ["export-iof2", "IOF XML 2.0.3"]],
        tip: t("trc.rd.exportIofTip") })] },
    { id: "gps", title: t("trc.rd.gGps"), items: [
      stack(S("export-gpx", t("trc.rd.exportGpx"), "pin", { tip: t("trc.rd.exportGpxTip") }),
        S("export-kml", t("trc.rd.exportKml"), "globe", { tip: t("trc.rd.exportKmlTip") }),
        S("export-images", t("trc.rd.exportImages"), "image", { tip: t("trc.rd.exportImagesTip") })),
      stack(S("export-routegadget", "RouteGadget", "route", { tip: t("trc.rd.exportRoutegadgetTip") }))] },
    { id: "software", title: t("trc.rd.gSoftware"), items: [stack(
      S("export-ocad", t("trc.rd.exportOcad"), "layers", { tip: t("trc.rd.exportOcadTip") }),
      S("export-ocn", t("trc.rd.exportOcn"), "export", { tip: t("trc.rd.exportOcnTip") }),
      S("export-ppen", "Purple Pen (.ppen)", "export", { tip: t("trc.rd.exportPpenTip") }))] },
    { id: "files", title: t("trc.rd.gFiles"), items: [stack(S("save-to", t("trc.rd.saveTo"), "folder",
      { tip: t("trc.rd.saveToTip") }))] },
  ] },
  { id: "team", label: t("trc.rd.tabTeam"), key: "E", icon: "team", guide: "outils", badge: "comments", groups: [
    { id: "teamwork", title: t("trc.rd.gTeamwork"), items: [
      B("team", t("trc.rd.team"), "team", { tip: t("trc.rd.teamTip") }),
      B("comments", t("trc.rd.comments"), "comment", { badge: "comments", tip: t("trc.rd.commentsTip") }),
      stack(S("versions", t("trc.rd.versions"), "history", { tip: t("trc.rd.versionsTip") }),
        S("version-save", t("trc.rd.versionSave"), "bookmark", { need: "edit", tip: t("trc.rd.versionSaveTip") }),
        S("save", t("trc.rd.save"), "save", { key: "Ctrl+S", tip: t("trc.rd.saveTip") }))] },
    { id: "terrain", title: t("trc.rd.gTerrain"), items: [
      B("field", t("trc.rd.field"), "phone", { tip: t("trc.rd.fieldTip") }),
      stack(S("rep-pickup", t("trc.rd.repPickup"), "box", { tip: t("trc.rd.repPickupTip") }),
        S("offline", t("trc.rd.offline"), "offline", { tip: t("trc.rd.offlineTip") }))] },
    { id: "after", title: t("trc.rd.gAfter"), guide: "apres", items: [
      B("publish", t("trc.rd.publish"), "share", { need: "after", tip: t("trc.rd.publishTip") }),
      B("send-results", t("trc.rd.sendResults"), "send", { need: "after", tip: t("trc.rd.sendResultsTip") }),
      B("rep-after", t("trc.rd.repAfter"), "chart", { need: "after", tip: t("trc.rd.repAfterTip") })] },
    { id: "security", title: t("trc.rd.gSecurity"), items: [stack(S("encryption", t("trc.rd.encryption"), "lock", { tip: t("trc.rd.encryptionTip") }))] },
  ] },
];

/** What the settings, figures and galleries of the ribbon are (the tooltips, the guide's « Le ruban »). */
export const INFO = {
  field: {
    descStandard: [t("trc.rd.fDescStandard"), t("trc.rd.fDescStandardTip")],
    lang: [t("trc.rd.fLang"), t("trc.rd.fLangTip")],
    mapStandard: [t("trc.rd.fMapStandard"), t("trc.rd.fMapStandardTip")],
    printScale: [t("trc.rd.fPrintScale"), t("trc.rd.fPrintScaleTip")],
    paper: [t("trc.rd.fPaper"), t("trc.rd.fPaperTip")],
    circle: [t("trc.rd.fCircle"), t("trc.rd.fCircleTip")],
    line: [t("trc.rd.fLine"), t("trc.rd.fLineTip")],
    number: [t("trc.rd.fNumber"), t("trc.rd.fNumberTip")],
    intensity: [t("trc.rd.fIntensity"), t("trc.rd.fIntensityTip")],
    code: [t("trc.rd.fCode"), t("trc.rd.fCodeTip")],
  },
  chip: {
    issues: t("trc.rd.chipIssues"),
    course: t("trc.rd.chipCourse"),
    mapInfo: t("trc.rd.chipMapInfo"), geoInfo: t("trc.rd.chipGeoInfo"),
    control: t("trc.rd.chipControl"), leg: t("trc.rd.chipLeg"),
    special: t("trc.rd.chipSpecial"), drawing: t("trc.rd.chipDrawing"),
  },
  modes: {
    blend: t("trc.rd.modesBlend"),
    flag: t("trc.rd.modesFlag"),
  },
  gallery: t("trc.rd.gallery"),
};

/** The quick-access bar (the title bar, the Ozimut mode): what a setter is likely to use most, whatever the tab — undo and redo, the
 *  PDF of the course in hand to print a proof, the event audit, the course's properties (name, climb, scale) —; each user changes it
 *  (its ▾, or a right-click on any button of the ribbon), kept in ocn.tr.prefs « qat ». QAT_CHOICES: offered in its ▾ menu. */
export const QAT_DEFAULT = ["undo", "redo", "pdf-course", "rep-audit", "course-props"];
export const QAT_CHOICES = ["undo", "redo", "save", "pdf-course", "pdf-courses", "rep-audit", "course-props", "course-new", "print-area", "view-course",
  "export-iof3", "versions", "comments", "field"];

/** The contextual tabs, by the selection's kind (ribbon.js fills in titles and figures). */
export const CONTEXT = {
  control: { label: t("trc.rd.ctxControl"), head: t("trc.rd.ctxControlHead"), guide: "postes", groups: [
    { id: "ctl", title: t("trc.rd.gCtl"), items: [stack({ t: "field", id: "code" }, S("control-props", t("trc.rd.controlProps"), "descr", { need: "edit", tip: t("trc.rd.controlPropsTip") }),
      S("toggle-exchange", t("trc.rd.toggleExchange"), "exchange", { need: "edit", toggle: "exchange", tip: t("trc.rd.toggleExchangeTip") }))] },
    { id: "vars", title: t("trc.rd.gVars"), items: [B("var-fork", t("trc.rd.ctlVarFork"), "fork", { need: "edit", tip: t("trc.rd.ctlVarForkTip") }),
      B("var-loop", t("trc.rd.ctlVarLoop"), "loop", { need: "edit", tip: t("trc.rd.ctlVarLoopTip") }),
      stack(S("var-delete", t("trc.rd.varDelete"), "removecircle", { need: "edit", tip: t("trc.rd.ctlVarDeleteTip") }),
        S("points", t("trc.rd.points"), "hash", { need: "edit", tip: t("trc.rd.pointsTip") }))] },
    { id: "lines", title: t("trc.rd.gLines"), items: [stack(S("text-before", t("trc.rd.textBefore"), "text", { need: "edit", tip: t("trc.rd.textBeforeTip") }),
      S("text-after", t("trc.rd.textAfter"), "text", { need: "edit", tip: t("trc.rd.textAfterTip") }))] },
    { id: "drawing", title: t("trc.rd.gDrawing"), items: [stack(S("gap-add-circle", t("trc.rd.gapAddCircle"), "gap", { need: "edit", tip: t("trc.rd.gapAddCircleTip") }),
      S("number-auto", t("trc.rd.numberAuto"), "number", { need: "edit", tip: t("trc.rd.numberAutoTip") })),
      stack(S("rotate", t("trc.rd.rotate"), "rotate", { need: "edit", tip: t("trc.rd.ctlRotateTip") }),
        S("stretch", t("trc.rd.stretch"), "stretch", { need: "edit", tip: t("trc.rd.ctlStretchTip") }))] },
    { id: "where", title: t("trc.rd.gWhereControl"), items: [{ t: "chip", id: "control" }] },
    { id: "remove", title: "", items: [B("delete", t("trc.rd.ctlDelete"), "trash", { need: "edit", key: t("trc.rd.keyDel"), tip: t("trc.rd.ctlDeleteTip") })] },
  ] },
  leg: { label: t("trc.rd.ctxLeg"), head: t("trc.rd.ctxLegHead"), guide: "circuits", groups: [
    { id: "shape", title: t("trc.rd.gShape"), items: [B("bend-add", t("trc.rd.bendAdd"), "bend", { need: "edit", tip: t("trc.rd.bendAddTip") }),
      B("gap-add-leg", t("trc.rd.gapAddLeg"), "gap", { need: "edit", tip: t("trc.rd.gapAddLegTip") }),
      stack(S("bend-remove", t("trc.rd.bendRemove"), "bend", { need: "edit", tip: t("trc.rd.bendRemoveTip") }),
        S("gap-remove-leg", t("trc.rd.gapRemoveLeg"), "gap", { need: "edit", tip: t("trc.rd.gapRemoveLegTip") })),
      stack(S("route-draw", t("trc.rd.routeDraw"), "route", { need: "edit", tip: t("trc.rd.routeDrawTip") }),
        S("route-clear", t("trc.rd.routeClear"), "trash", { need: "edit", tip: t("trc.rd.routeClearTip") }))] },
    { id: "flagging", title: t("trc.rd.gFlagging"), items: [{ t: "modes", id: "flag" }] },
    { id: "where", title: t("trc.rd.gWhereLeg"), items: [{ t: "chip", id: "leg" }] },
  ] },
  special: { label: t("trc.rd.ctxSpecial"), head: t("trc.rd.ctxSpecialHead"), guide: "speciaux", groups: [
    { id: "obj", title: t("trc.rd.gObj"), items: [B("special-props", t("trc.rd.specialProps"), "pencil", { need: "edit", tip: t("trc.rd.specialPropsTip") }),
      B("displayed-courses", t("trc.rd.displayedCourses"), "layers", { need: "edit", tip: t("trc.rd.displayedCoursesTip") }),
      stack(S("corner-add", t("trc.rd.cornerAdd"), "vertex", { need: "edit", tip: t("trc.rd.cornerAddTip") }),
        S("corner-remove", t("trc.rd.cornerRemove"), "vertex", { need: "edit", tip: t("trc.rd.cornerRemoveTip") })),
      stack(S("rotate", t("trc.rd.rotate"), "rotate", { need: "edit", tip: t("trc.rd.spRotateTip") }), S("stretch", t("trc.rd.stretch"), "stretch", { need: "edit", tip: t("trc.rd.spStretchTip") }))] },
    { id: "where", title: "", items: [{ t: "chip", id: "special" }] },
    { id: "remove", title: "", items: [B("delete", t("trc.rd.spDelete"), "trash", { need: "edit", key: t("trc.rd.keyDel"), tip: t("trc.rd.spDeleteTip") })] },
  ] },
  drawing: { label: t("trc.rd.ctxDrawing"), head: t("trc.rd.ctxDrawing"), guide: "speciaux", groups: [
    { id: "draw", title: "", items: [B("finish-draw", t("trc.rd.finishDraw"), "check", { key: t("trc.rd.keyEnter"), tip: t("trc.rd.finishDrawTip") }),
      B("cancel-draw", t("trc.rd.cancelDraw"), "close", { key: t("trc.rd.keyEsc"), tip: t("trc.rd.cancelDrawTip") }), { t: "chip", id: "drawing" }] },
  ] },
};

/** The « Fichier » page (the ribbon's backstage): its sections, each a list of commands with what they are for. */
export const BACKSTAGE = [
  { id: "info", label: t("trc.rd.bsInfo"), icon: "sliders" },
  { id: "new", label: t("trc.rd.bsNew"), icon: "file", act: "start-new" },
  { id: "open", label: t("trc.rd.bsOpen"), icon: "folder", act: "start-open" },
  { id: "import", label: t("trc.rd.bsImport"), icon: "import", items: [
    ["start-import", t("trc.rd.bsStartImport"), t("trc.rd.bsStartImportDesc")],
    ["import-ppen", t("trc.rd.bsImportPpen"), t("trc.rd.bsImportPpenDesc")],
    ["map-change", t("trc.rd.bsMapChange"), t("trc.rd.bsMapChangeDesc")],
    ["import-course", t("trc.rd.bsImportCourse"), t("trc.rd.bsImportCourseDesc")],
    ["georef", t("trc.rd.bsGeoref"), t("trc.rd.bsGeorefDesc")]] },
  { id: "save", label: t("trc.rd.bsSave"), icon: "save", items: [
    ["save", t("trc.rd.save"), t("trc.rd.saveTip")],
    ["version-save", t("trc.rd.bsVersionSave"), t("trc.rd.bsVersionSaveDesc")],
    ["versions", t("trc.rd.bsVersions"), t("trc.rd.bsVersionsDesc")]] },
  { id: "export", label: t("trc.rd.bsExport"), icon: "export", groups: [
    [t("trc.rd.bsForPrint"), [["pdf-courses", t("trc.rd.bsPdfCourses"), t("trc.rd.bsPdfCoursesDesc")],
      ["pdf-descriptions", t("trc.rd.bsPdfDescriptions"), t("trc.rd.bsPdfDescriptionsDesc")], ["pdf-punch", t("trc.rd.pdfPunch"), t("trc.rd.bsPdfPunchDesc")]]],
    [t("trc.rd.bsForTiming"), [["export-iof3", "IOF XML 3.0", t("trc.rd.bsIof3Desc")],
      ["export-iof2", "IOF XML 2.0.3", t("trc.rd.bsIof2Desc")]]],
    [t("trc.rd.bsForGps"), [["export-gpx", t("trc.rd.exportGpx"), t("trc.rd.exportGpxTip")], ["export-kml", t("trc.rd.exportKml"), t("trc.rd.bsKmlDesc")],
      ["export-images", t("trc.rd.bsImages"), t("trc.rd.bsImagesDesc")], ["export-routegadget", "RouteGadget", t("trc.rd.bsRoutegadgetDesc")]]],
    [t("trc.rd.bsForSoftware"), [["export-ocn", t("trc.rd.bsOcn"), t("trc.rd.bsOcnDesc")],
      ["export-ocad", t("trc.rd.bsOcad"), t("trc.rd.bsOcadDesc")], ["export-ppen", "Purple Pen (.ppen)", t("trc.rd.bsPpenDesc")],
      ["export-csv", t("trc.rd.exportCsv"), t("trc.rd.bsCsvDesc")]]]] },
  { id: "share", label: t("trc.rd.bsShare"), icon: "team", items: [
    ["team", t("trc.rd.bsTeam"), t("trc.rd.bsTeamDesc")],
    ["encryption", t("trc.rd.bsEncryption"), t("trc.rd.bsEncryptionDesc")],
    ["publish", t("trc.rd.bsPublish"), t("trc.rd.bsPublishDesc")],
    ["send-results", t("trc.rd.sendResults"), t("trc.rd.bsSendResultsDesc")]] },
  { id: "offline", label: t("trc.rd.bsOffline"), icon: "offline", items: [
    ["offline", t("trc.rd.bsWorkOffline"), t("trc.rd.bsWorkOfflineDesc")]] },
  { id: "options", label: t("trc.rd.bsOptions"), icon: "sliders" },
];

// ---- where a command is: the messages name it in the interface the user has (ribbon or menus) ---------------------------------
const PREF = "ocn.tr.prefs";
/** The interface chosen on this browser: "ocn" (the ribbon, by default) or "pp" (Purple Pen's menus). */
export function uiMode() { try { return JSON.parse(localStorage.getItem(PREF) || "{}").ui === "pp" ? "pp" : "ocn"; } catch (e) { return "ocn"; } }
export function setUiMode(m) { try { const o = JSON.parse(localStorage.getItem(PREF) || "{}"); o.ui = m === "pp" ? "pp" : "ocn"; localStorage.setItem(PREF, JSON.stringify(o)); } catch (e) { /* this visit */ } }

/** Every command of the ribbon: { act | tool, label, icon, tip, tab, group, ctx }. */
export function commands() {
  const out = [];
  const walk = (tab, group, items, ctx) => items.forEach((it) => {
    if (it.t === "stack") walk(tab, group, it.items, ctx);
    else if (it.act || it.tool) out.push({ ...it, tab, group, ctx });
  });
  for (const tab of TABS) for (const g of tab.groups || []) walk(tab, g, g.items, null);
  for (const [k, c] of Object.entries(CONTEXT)) for (const g of c.groups) walk({ id: `ctx:${k}`, label: c.label }, g, g.items, k);
  return out;
}
const RIBBON_AT = {};
for (const c of commands()) if (c.act && !RIBBON_AT[c.act]) RIBBON_AT[c.act] = `${c.tab.label}${c.group.title ? ` › ${c.group.title}` : ""} › ${c.label.replace(/…$/, "")}`;
for (const s of BACKSTAGE) for (const [a, l] of [...(s.items || []), ...(s.groups || []).flatMap((g) => g[1])]) if (!RIBBON_AT[a]) RIBBON_AT[a] = `${TABS[0].label} › ${s.label} › ${l}`;
const MENU_AT = {};
for (const m of MENUS) for (const it of m.items) if (it !== "-" && !MENU_AT[it[0]]) MENU_AT[it[0]] = `${m.label} › ${it[1].replace(/…$/, "")}`;
/** Where a command is, in the interface in use: « Carte › Position › Caler les postes », or « Événement › Caler les postes sur la carte ». */
export const where = (act, mode = uiMode()) => (mode === "pp" ? MENU_AT[act] || RIBBON_AT[act] : RIBBON_AT[act] || MENU_AT[act]) || "";
export const ribbonAt = (act) => RIBBON_AT[act] || "";
export const menuAt = (act) => MENU_AT[act] || "";
