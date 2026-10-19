/*
 * Mobile audit: paste into the browser console (or run through the browser tool) on any screen.
 * Resize to 320, 360, 375, 414 px portrait and 667x375 landscape first, then reload.
 * Returns a JSON string; a clean screen has overflowX=false and every list empty.
 */
(() => {
  const vw = window.innerWidth;
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const label = (el) =>
    (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.type || el.tagName)
      .trim()
      .slice(0, 24);

  const smallTargets = [...document.querySelectorAll("a, button, input:not([type=hidden]), select, textarea, [role=button], [role=tab]")]
    .filter(visible)
    .map((el) => {
      // A checkbox or radio inside a <label> is tapped through the whole label, so measure that.
      const target = el.matches("input[type=checkbox], input[type=radio]") ? el.closest("label") || el : el;
      const r = target.getBoundingClientRect();
      return { el: label(el), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((t) => t.w < 44 || t.h < 44);

  const tinyText = [...document.querySelectorAll("body *")]
    .filter((el) => el.children.length === 0 && el.textContent.trim() && visible(el))
    .map((el) => ({ el: el.textContent.trim().slice(0, 24), px: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((t) => t.px < 12);

  const smallInputText = [
    ...document.querySelectorAll(
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea",
    ),
  ]
    .filter(visible)
    .map((el) => ({ el: label(el), px: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((t) => t.px < 16);

  const clippedLabels = [...document.querySelectorAll(".tab span, .nav-link, .sheet-item, .btn")]
    .filter(visible)
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map(label);

  const offscreen = [...document.querySelectorAll("body *")]
    .filter(visible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > vw + 1 || r.left < -1;
    })
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`)
    .slice(0, 8);

  const wideCharts = [...document.querySelectorAll(".recharts-wrapper, svg.chart")]
    .filter(visible)
    .filter((el) => el.getBoundingClientRect().width > vw)
    .map((el) => el.className.baseVal || el.className);

  return JSON.stringify({
    path: location.pathname,
    vw,
    vh: window.innerHeight,
    scrollW: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth > vw,
    smallTargets,
    tinyText,
    smallInputText,
    clippedLabels,
    offscreen,
    wideCharts,
  });
})();
