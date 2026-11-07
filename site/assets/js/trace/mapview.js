// A map on a canvas, for the shared analyses (the organiser's editor, the replay): drag to pan, wheel, double-click,
// pinch or buttons to zoom, a click callback in the image's pixels, a draw callback over the image (in its pixels;
// lw(px) gives a line width in screen pixels). The view keeps its centre when the canvas's box changes.

export function mapView(canvas, { onDraw = null, onClick = null, onUserMove = null, background = "#e9e6dc" } = {}) {
  const ctx = canvas.getContext("2d");
  let image = null, view = { k: 1, ox: 0, oy: 0 }, lastBox = null, alpha = 1;
  // the map turned (radians, clockwise on the screen) about the canvas's centre, after the view: the view itself stays north up,
  // so that zooming, centring and fitting need not know (owner, 2026-11-02: the map turned to the leg)
  let rot = 0;
  // a band at the canvas's top the page's control bar covers (owner, 2026-11-07: the bar laid over the map): the views fitted and
  // centred keep their content in the part below it
  let inset = 0;
  /** Where the view puts image point (X, Y) of the map north up so that it shows at the middle of the free part. */
  const place = (X, Y, k) => { const { w, h } = box(), [px, py] = un(w / 2, inset + (h - inset) / 2); return { k, ox: px - X * k, oy: py - Y * k }; };
  /** A point of the canvas as it would be with the map north up. */
  const un = (sx, sy) => { if (!rot) return [sx, sy]; const { w, h } = box(), c = Math.cos(rot), s = Math.sin(rot), x = sx - w / 2, y = sy - h / 2; return [c * x + s * y + w / 2, -s * x + c * y + h / 2]; };
  const box = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  function size() {
    const dpr = window.devicePixelRatio || 1, { w, h } = box();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1, { w, h } = box();
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
    if (!image) return;
    const c = Math.cos(rot), s = Math.sin(rot), X = view.ox - w / 2, Y = view.oy - h / 2;
    ctx.setTransform(dpr * view.k * c, dpr * view.k * s, -dpr * view.k * s, dpr * view.k * c, dpr * (c * X - s * Y + w / 2), dpr * (s * X + c * Y + h / 2));
    ctx.imageSmoothingEnabled = view.k < 1;
    ctx.globalAlpha = alpha; ctx.drawImage(image, 0, 0); ctx.globalAlpha = 1;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    onDraw?.(ctx, view, (px) => px / view.k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  /** The view on a box of the image (its pixels), with a margin in screen pixels. */
  function fitBox(x0, y0, x1, y1, pad = 30, maxK = 5) {
    const { w, h } = box();
    if (!w || !h) return;
    const k = Math.min((w - 2 * pad) / Math.max(20, x1 - x0), (h - inset - 2 * pad) / Math.max(20, y1 - y0), maxK);
    view = place((x0 + x1) / 2, (y0 + y1) / 2, k);
    lastBox = { w, h };
  }
  /** The view on points of the image (its pixels) as the turned map shows them, with a margin in screen pixels. */
  function fitPoints(xs, ys, pad = 30, maxK = 5) {
    const { w, h } = box();
    if (!w || !h || !xs.length) return;
    const c = Math.cos(rot), s = Math.sin(rot);
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (let i = 0; i < xs.length; i++) { const u = c * xs[i] - s * ys[i], v = s * xs[i] + c * ys[i]; u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
    const k = Math.min((w - 2 * pad) / Math.max(20, u1 - u0), (h - inset - 2 * pad) / Math.max(20, v1 - v0), maxK);
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    view = place(c * uc + s * vc, -s * uc + c * vc, k);
    lastBox = { w, h };
  }
  const fitAll = () => { if (image) fitBox(0, 0, image.width, image.height, 4, 8); };
  function zoomBy(f, cx, cy) {
    const { w, h } = box();
    if (cx == null) { cx = w / 2; cy = h / 2; }
    const k = Math.max(0.02, Math.min(12, view.k * f));
    view = { k, ox: cx - ((cx - view.ox) / view.k) * k, oy: cy - ((cy - view.oy) / view.k) * k };
    draw();
  }
  function centerOn(x, y) { view = place(x, y, view.k); }
  const toImg = (sx0, sy0) => { const [sx, sy] = un(sx0, sy0); return [(sx - view.ox) / view.k, (sy - view.oy) / view.k]; };

  let drag = null, pinch = null;
  const pointers = new Map();
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, un(e.offsetX, e.offsetY));
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
    if (pointers.size === 1) { const [x, y] = un(e.offsetX, e.offsetY); drag = { x, y, ox: view.ox, oy: view.oy, moved: false }; }
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k }; drag = null; }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, un(e.offsetX, e.offsetY));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, k = Math.max(0.02, Math.min(12, (pinch.k * d) / pinch.d));
      view = { k, ox: cx - ((cx - view.ox) / view.k) * k, oy: cy - ((cy - view.oy) / view.k) * k };
      onUserMove?.(); draw();
    } else if (drag) {
      const [ux, uy] = un(e.offsetX, e.offsetY), dx = ux - drag.x, dy = uy - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) { view = { ...view, ox: drag.ox + dx, oy: drag.oy + dy }; onUserMove?.(); draw(); }
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && e.type === "pointerup") onClick?.(...toImg(e.offsetX, e.offsetY), e);
    if (!pointers.size) drag = null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); onUserMove?.(); zoomBy(Math.exp(-e.deltaY * 0.0015), ...un(e.offsetX, e.offsetY)); }, { passive: false });
  canvas.addEventListener("dblclick", (e) => { onUserMove?.(); zoomBy(1.6, ...un(e.offsetX, e.offsetY)); });
  const ro = new ResizeObserver(() => {
    const b = box();
    if (lastBox && b.w && b.h && (b.w !== lastBox.w || b.h !== lastBox.h)) view = { ...view, ox: view.ox + (b.w - lastBox.w) / 2, oy: view.oy + (b.h - lastBox.h) / 2 };
    if (b.w && b.h) lastBox = b;
    size(); draw();
  });
  ro.observe(canvas);

  return {
    setImage(img) { image = img; fitAll(); draw(); },
    get image() { return image; },
    get view() { return view; },
    set view(v) { view = v; },
    setAlpha(a) { alpha = a; },
    /** The map turned by r radians (clockwise on the screen), 0: north up. */
    setRotation(r) { rot = Number.isFinite(r) ? r : 0; },
    /** The band (screen pixels) at the canvas's top that the page's controls cover. */
    setInset(px) { inset = Math.max(0, px || 0); },
    get inset() { return inset; },
    get rotation() { return rot; },
    box, draw, fitBox, fitPoints, fitAll, zoomBy, centerOn, toImg,
    destroy() { ro.disconnect(); },
  };
}
