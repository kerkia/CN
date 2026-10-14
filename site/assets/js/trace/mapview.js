// A map on a canvas, for the shared analyses (the organiser's editor, the replay): drag to pan, wheel, double-click,
// pinch or buttons to zoom, a click callback in the image's pixels, a draw callback over the image (in its pixels;
// lw(px) gives a line width in screen pixels). The view keeps its centre when the canvas's box changes.

export function mapView(canvas, { onDraw = null, onClick = null, onUserMove = null, background = "#e9e6dc" } = {}) {
  const ctx = canvas.getContext("2d");
  let image = null, view = { k: 1, ox: 0, oy: 0 }, lastBox = null, alpha = 1;
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
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.ox, dpr * view.oy);
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
    const k = Math.min((w - 2 * pad) / Math.max(20, x1 - x0), (h - 2 * pad) / Math.max(20, y1 - y0), maxK);
    view = { k, ox: w / 2 - ((x0 + x1) / 2) * k, oy: h / 2 - ((y0 + y1) / 2) * k };
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
  function centerOn(x, y) { const { w, h } = box(); view = { ...view, ox: w / 2 - x * view.k, oy: h / 2 - y * view.k }; }
  const toImg = (sx, sy) => [(sx - view.ox) / view.k, (sy - view.oy) / view.k];

  let drag = null, pinch = null;
  const pointers = new Map();
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
    if (pointers.size === 1) drag = { x: e.offsetX, y: e.offsetY, ox: view.ox, oy: view.oy, moved: false };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k }; drag = null; }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, k = Math.max(0.02, Math.min(12, (pinch.k * d) / pinch.d));
      view = { k, ox: cx - ((cx - view.ox) / view.k) * k, oy: cy - ((cy - view.oy) / view.k) * k };
      onUserMove?.(); draw();
    } else if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
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
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); onUserMove?.(); zoomBy(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
  canvas.addEventListener("dblclick", (e) => { onUserMove?.(); zoomBy(1.6, e.offsetX, e.offsetY); });
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
    box, draw, fitBox, fitAll, zoomBy, centerOn, toImg,
    destroy() { ro.disconnect(); },
  };
}
