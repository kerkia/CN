// xmldom's elements have no `children` (oom.js reads it): a getter over childNodes, for the Node tests of Cartographier.
const probe = new DOMParser().parseFromString("<a><b/></a>", "application/xml").documentElement;
const proto = Object.getPrototypeOf(probe);
if (!("children" in probe)) {
  Object.defineProperty(proto, "children", { get() { return Array.prototype.filter.call(this.childNodes, (n) => n.nodeType === 1); } });
}
