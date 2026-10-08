#!/usr/bin/env python3
"""Browser smoke test (Playwright + Chromium). Loads every page at desktop and phone width in light and dark
mode and checks:
  - no uncaught exceptions, no console errors, no failed requests (CDN/tile hosts are tolerated: the map has a
    built-in fallback when they are unreachable)
  - no page-level horizontal scroll
  - no stray "null" / "undefined" / "NaN" text anywhere in the rendered page
  - key interactions work: search, status toggle, row selection, URL-hash state, invalid year range, empty state

Usage:
    python3 -m http.server 8000 --directory site &
    python3 tests/browser/smoke.py [--base http://localhost:8000/] [--shots DIR]
Requires: pip install playwright && playwright install chromium
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

PAGES = ["index.html", "plan.html", "legislation.html", "map.html"]
TOLERATED_HOSTS = ("cdnjs.cloudflare.com", "tile.openstreetmap.org")
BAD_TEXT = re.compile(r"\b(null|undefined|NaN)\b")

LEAFLET_STUB = """
window.__lf = { markers: 0, squares: 0, setView: [], fitBounds: [], tilesUrl: null, all: [] };
window.L = {
  map(el) {
    const m = {
      setView(c, z) { window.__lf.setView.push([c, z]); return m; },
      fitBounds(b, o) { window.__lf.fitBounds.push([b, o]); return m; },
      invalidateSize() { return m; },
      remove() {},
    };
    return m;
  },
  tileLayer(url) { const t = { on() { return t; }, addTo() { window.__lf.tilesUrl = url; return t; } }; return t; },
  layerGroup() { const g = { layers: [], clearLayers() { g.layers = []; window.__lf.markers = 0; window.__lf.squares = 0; return g; }, addTo() { return g; } }; return g; },
  divIcon(o) { return { div: true, o }; },
  marker(ll, o) {
    const mk = { ll, o, square: true, on(ev, fn) { mk['_' + ev] = fn; return mk; }, bindTooltip() { return mk; },
      addTo(g) { window.__lf.squares += 1; return mk; } };
    return mk;
  },
  circleMarker(ll, o) {
    const mk = { ll, o, on(ev, fn) { mk['_' + ev] = fn; return mk; }, bindTooltip() { return mk; },
      addTo(g) { g.layers.push(mk); window.__lf.markers = g.layers.length; window.__lf.all = g.layers; return mk; } };
    return mk;
  },
};
"""

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("  ok    " if cond else "  FAIL  ") + msg)
    if not cond:
        failures.append(msg)


async def new_page(ctx, base, path):
    page = await ctx.new_page()
    problems: list[str] = []
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    page.on(
        "console",
        lambda m: problems.append(f"console.{m.type}: {m.text}")
        if m.type == "error" and "ERR_TUNNEL" not in m.text and "net::ERR" not in m.text
        else None,
    )
    page.on(
        "requestfailed",
        lambda r: problems.append(f"requestfailed: {r.url}") if not any(h in r.url for h in TOLERATED_HOSTS) else None,
    )
    await page.goto(base + path, wait_until="networkidle")
    await page.wait_for_timeout(300)
    return page, problems


async def matrix(browser, base, shots: Path | None):
    for scheme in ("light", "dark"):
        for label, vp in (("desktop", {"width": 1360, "height": 900}), ("phone", {"width": 390, "height": 844})):
            ctx = await browser.new_context(viewport=vp, color_scheme=scheme)
            for path in PAGES:
                tag = f"{path} [{scheme}/{label}]"
                page, problems = await new_page(ctx, base, path)
                overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                body = await page.evaluate("document.body.innerText")
                bad = BAD_TEXT.findall(body)
                h1 = await page.evaluate("document.querySelector('h1')?.textContent ?? ''")
                check(bool(h1), f"{tag}: has an <h1>")
                check(not problems, f"{tag}: no errors {problems[:3] if problems else ''}")
                check(overflow <= 0, f"{tag}: no horizontal page scroll (overflow={overflow})")
                check(not bad, f"{tag}: no stray null/undefined/NaN text {bad[:3] if bad else ''}")
                if shots:
                    await page.screenshot(path=str(shots / f"{path.replace('.html', '')}-{scheme}-{label}.png"), full_page=True)
                await page.close()
            await ctx.close()


async def interactions(browser, base):
    ctx = await browser.new_context(viewport={"width": 1360, "height": 900})

    # ---- plan tracker
    page, problems = await new_page(ctx, base, "plan.html")
    rows = lambda: page.locator("tbody tr").count()  # noqa: E731
    total = await rows()
    check(total >= 5, f"plan: renders {total} rows")

    await page.fill("#f-q", "ipv6")
    await page.wait_for_timeout(300)
    check(await rows() == 1, "plan: search narrows to 1 row")
    check("q=ipv6" in page.url, "plan: search is reflected in the URL hash")

    await page.fill("#f-q", "zzzz-no-such-thing")
    await page.wait_for_timeout(300)
    check(await page.locator(".empty").count() == 1, "plan: empty state is shown for no matches")
    check(await page.locator("button:has-text('Export filtered CSV')").is_disabled(), "plan: export is disabled when empty")

    await page.fill("#f-q", "")
    await page.wait_for_timeout(300)
    check(await rows() == total, "plan: clearing search restores all rows")

    await page.locator("tbody .link-btn").first.click()
    await page.wait_for_timeout(200)
    check(await page.locator(".profile svg").count() >= 1, "plan: selecting a target draws its chart")
    check("sel=" in page.url, "plan: selection is reflected in the URL hash")
    await page.locator(".profile .hit").first.focus()
    await page.wait_for_timeout(100)
    check(await page.locator(".tooltip.on").count() == 1, "plan: chart points show a tooltip on keyboard focus")

    await page.locator(".legend .item").first.click()
    await page.wait_for_timeout(200)
    check(0 < await rows() < total, "plan: clicking a status legend item filters the table")
    check("status=" in page.url, "plan: status filter is reflected in the URL hash")

    # the deadline-passed/no-final-figure case renders as "Unresolved", with the as-of date on the latest value
    await page.goto(base + "plan.html#sel=cpi23_storage", wait_until="networkidle")
    await page.wait_for_timeout(300)
    prof = await page.locator(".profile").inner_text()
    check("Unresolved" in prof and "as of 30 Jun 2025" in prof, "plan: a partial-year value in the target year reads as Unresolved with its as-of date")
    check(await page.locator(".profile .dot.partial").count() >= 1, "plan: partial-year points are drawn hollow")
    check(await page.locator(".profile details.table-view a[href^='http']").count() >= 1, "plan: the table view links each reported value to its source")
    await page.goto(base + "plan.html#status=unresolved", wait_until="networkidle")
    await page.wait_for_timeout(300)
    check(await rows() >= 3, "plan: the unresolved status can be filtered from the URL hash")

    await page.goto(base + "plan.html#q=%E0%A4%A&status=bogus,achieved&sel=nope&plan=zzz", wait_until="networkidle")
    await page.wait_for_timeout(200)
    check(await rows() > 0 and await page.locator("#f-q").input_value() == "", "plan: a malformed/hostile hash degrades gracefully (bad query dropped, unknown status ignored)")

    async with page.expect_download() as dl:
        await page.goto(base + "plan.html", wait_until="networkidle")
        await page.locator("button:has-text('Export filtered CSV')").click()
    path = await (await dl.value).path()
    csv = Path(path).read_bytes()
    check(csv.startswith(b"\xef\xbb\xbf"), "plan: CSV starts with a UTF-8 BOM (Excel-safe)")
    check(b"\r\n" in csv and b"status" in csv.split(b"\r\n")[0], "plan: CSV has a header row with CRLF endings")
    await page.close()

    # ---- legislation
    page, _ = await new_page(ctx, base, "legislation.html")
    n = await page.locator("tbody tr").count()
    check(n >= 4, f"legislation: renders {n} rows")
    await page.fill("#f-from", "2022")
    await page.fill("#f-to", "2016")
    await page.wait_for_timeout(500)
    check(await page.locator("text=nothing can match").count() == 1, "legislation: from > to shows an explicit message")
    check(await page.locator(".empty").count() == 1, "legislation: from > to yields the empty state")
    await page.fill("#f-to", "20x6")
    await page.wait_for_timeout(500)
    check(await page.locator("text=Enter a 4-digit year").count() == 1, "legislation: non-numeric year is rejected inline")
    await page.fill("#f-from", "")
    await page.fill("#f-to", "")
    await page.fill("#f-q", "数据")
    await page.wait_for_timeout(400)
    check(await page.locator("tbody tr").count() >= 1, "legislation: searching Chinese text finds records")
    await page.close()

    # ---- map
    page, _ = await new_page(ctx, base, "map.html#sel=horinger")
    check(await page.locator(".profile h2").inner_text() == "Horinger cluster", "map: hash selects a cluster")
    kpi_text = await page.locator(".kpis").inner_text()
    check("10 national clusters" in kpi_text and "11 sites" in kpi_text, "map: KPIs count 10 clusters across 11 sites")
    check("1843" in await page.locator(".profile").inner_text(), "map: the profile shows the NDRC approval letter number")
    # The project layer is switched off (CONFIG.showProjectLayer = false) until its source licence is confirmed:
    # nothing about it may appear, and the git-ignored inventory file must not even be requested.
    prof = await page.locator(".profile").inner_text()
    check("Announced projects" not in prof, "map: no project list while the project layer is disabled")
    check("curated projects" not in kpi_text.lower(), "map: no project KPI while the project layer is disabled")
    check(await page.locator("input[name=layers]").count() == 0, "map: no layer toggle while the project layer is disabled")
    await page.goto(f"{base}/map.html#layers=projects&sel=horinger")
    await page.wait_for_timeout(500)
    check(await page.locator(".project-square").count() == 0, "map: a hand-edited #layers=projects hash cannot switch the layer on")
    await page.locator("tbody .link-btn").nth(1).click()
    await page.wait_for_timeout(200)
    check("sel=" in page.url and "horinger" not in page.url, "map: selecting another cluster updates the hash")
    await page.close()
    await ctx.close()

    # ---- map: Leaflet code path against an API-faithful stub (the real library is a CDN script)
    lctx = await browser.new_context(viewport={"width": 1360, "height": 900})
    await lctx.add_init_script(LEAFLET_STUB)
    # Where the CDN is reachable (e.g. CI) the real library would replace the stub, so keep it out of this context.
    await lctx.route("**/cdnjs.cloudflare.com/**", lambda route: route.abort())
    requested: list[str] = []
    lctx.on("request", lambda r: requested.append(r.url))
    page, problems = await new_page(lctx, base, "map.html")
    check(not any("edwc_projects.json" in u for u in requested), "map: the git-ignored project inventory is never requested")
    lf = await page.evaluate("window.__lf")
    check(not problems, f"map[leaflet stub]: no errors {problems[:2] if problems else ''}")
    check(lf["markers"] == 11, f"map[leaflet stub]: one marker per site, 11 for 10 clusters ({lf['markers']})")
    check(lf["squares"] == 0, "map[leaflet stub]: no project squares while the layer is off")
    check("{z}" in (lf["tilesUrl"] or ""), "map[leaflet stub]: tile URL template is passed through")
    latlngs = lf["fitBounds"][0][0] if lf["fitBounds"] else []
    check(len(latlngs) == 11 and all(18 <= a <= 54 and 73 <= b <= 135 for a, b in latlngs),
          "map[leaflet stub]: markers are [lat, lon] (not swapped) and fit to bounds")
    await page.fill("#f-q", "gui")
    await page.wait_for_timeout(400)
    lf = await page.evaluate("window.__lf")
    check(lf["markers"] == 1, f"map[leaflet stub]: filtering to one cluster leaves one marker ({lf['markers']})")
    check(lf["setView"] and lf["setView"][-1][1] == 7, "map[leaflet stub]: a single result zooms in instead of fitBounds")
    await page.fill("#f-q", "")
    await page.wait_for_timeout(400)
    await page.evaluate("window.__lf.all[0]._click()")
    await page.wait_for_timeout(200)
    check("sel=" in page.url, "map[leaflet stub]: clicking a marker selects it (URL hash)")
    await page.fill("#f-q", "zzzz")
    await page.wait_for_timeout(400)
    lf = await page.evaluate("window.__lf")
    check(lf["markers"] == 0 and await page.locator(".empty").count() == 1, "map[leaflet stub]: no matches clears markers and shows empty state")
    await page.close()
    await lctx.close()


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000/")
    ap.add_argument("--shots", type=Path, default=None)
    args = ap.parse_args()
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        print("== page matrix")
        await matrix(browser, args.base, args.shots)
        print("== interactions")
        await interactions(browser, args.base)
        await browser.close()
    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
