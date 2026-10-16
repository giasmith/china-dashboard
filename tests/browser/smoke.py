#!/usr/bin/env python3
"""Browser smoke test (Playwright + Chromium). Loads every page at desktop and phone width in light and dark
mode and checks:
  - no uncaught exceptions, no console errors, no failed requests
  - no page-level horizontal scroll
  - no stray "null" / "undefined" / "NaN" text anywhere in the rendered page
  - key interactions work: search, status toggle, row selection, URL-hash state, invalid year range, empty state
  - the map dashboard: layer tabs, filters, province focus by map click (also with real mouse input, and a drag that
    must not change it), the transmission-line overlay on the energy tabs, that there is no export/download control,
    and that no coordinate ever reaches the browser for a facility

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

PAGES = ["index.html", "plan.html", "legislation.html"]
TOLERATED_HOSTS: tuple[str, ...] = ()
BAD_TEXT = re.compile(r"\b(null|undefined|NaN)\b")

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


async def point_on(page, selector):
    """A viewport point whose topmost element is `selector`, so a real mouse click lands on it (None if covered)."""
    return await page.evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          for (let i = 1; i < 20; i += 1) for (let j = 1; j < 20; j += 1) {
            const x = b.left + (b.width * i) / 20, y = b.top + (b.height * j) / 20;
            if (document.elementFromPoint(x, y) === el) return { x, y };
          }
          return null;
        }""",
        selector,
    )


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

    # ---- map dashboard (index.html)
    page, problems = await new_page(ctx, base, "index.html#view=cost")
    check(not problems, f"map: no errors {problems[:2] if problems else ''}")
    check(await page.locator(".db-tab.active").inner_text() == "Electricity cost", "map: the view is restored from the URL hash")
    check(await page.locator("#db-provinces path").count() >= 31, "map: every province outline is drawn")
    total = int((await page.locator("#db-k-count").inner_text()).replace(",", ""))
    check(total > 400, f"map: KPI counts the inventory ({total})")
    # Privacy: the facility payload must not carry any coordinate-like field; the DOM must not place facilities
    # anywhere other than a province anchor (one bubble per province, never per facility).
    payload = await page.evaluate("fetch('data/facilities.json').then(r => r.json())")
    keys = set().union(*(f.keys() for f in payload["facilities"]))
    check(not keys & {"lat", "lon", "latitude", "longitude", "coordinates", "address", "city", "x", "y"}, f"map: facilities.json carries no location fields ({sorted(keys)})")
    # Partner logos at the top left, loaded and labelled; the commercial directory is not named anywhere.
    logos = await page.evaluate("[...document.querySelectorAll('.partner-logos img')].map(i => [i.alt, i.naturalWidth, Math.round(innerWidth - i.getBoundingClientRect().right), Math.round(i.getBoundingClientRect().top)])")
    check(len(logos) == 2 and all(alt and w > 0 for alt, w, _r, _t in logos), f"map: both partner logos load with alt text ({logos})")
    check(bool(logos) and logos[-1][2] < 40 and logos[-1][3] < 60, f"map: the logos sit at the top right of the page ({logos})")
    check((await page.locator(".site-header .brand").inner_text()).strip() == "China Data-Center Ecosystem Tracker", "map: the header carries the tracker title (no tagline)")
    nav = [t.strip() for t in await page.locator(".site-header .nav a").all_inner_texts()]
    check(nav == ["Map", "Plan targets", "Legislation"], f"map: the nav reads Map / Plan targets / Legislation ({nav})")
    for width in (1024, 1280):
        await page.set_viewport_size({"width": width, "height": 900})
        await page.wait_for_timeout(150)
        gap = await page.evaluate("(() => { const r = [...document.querySelectorAll('.partner-logos img')].pop().getBoundingClientRect(); return [Math.round(innerWidth - r.right), Math.round(r.top)]; })()")
        check(gap[0] < 40 and gap[1] < 60, f"map: at {width}px the logos stay at the top right ({gap})")
    await page.set_viewport_size({"width": 1360, "height": 900})
    await page.wait_for_timeout(150)
    flag = await page.locator(".db-filters .db-flag").inner_text()
    check("do not prove" in flag and await page.locator(".db-filters .db-flag svg").count() == 1, "map: the sidebar carries the screening caveat with its info icon")
    check(await page.locator("#db-group-source").count() == 0 and "Inventory source" not in await page.locator(".db-filters").inner_text(), "map: there is no inventory-source filter")
    tabs = [t.strip() for t in await page.locator(".db-tab").all_inner_texts()]
    check(tabs == ["Status", "Capacity", "Power", "Generation", "Electricity cost", "Water scarcity", "Policy"],
          f"map: only layers with data get a tab, no Hazard or Opposition ({tabs})")
    for view in ("status", "capacity"):
        await page.click(f".db-tab[data-view={view}]")
        await page.wait_for_timeout(150)
        check(not re.search(r"data\s*-?\s*center\s*-?\s*map", await page.locator("body").inner_text(), re.I), f"map: the {view} view does not name the commercial directory")
    check(await page.locator("#db-bubbles > g").count() <= 34, "map: at most one bubble per province (no per-facility points)")

    await page.click(".db-tab[data-view=status]")
    await page.wait_for_timeout(200)
    check(await page.locator("#db-bubbles .db-slice").count() > 0, "map: the status view draws status wheels")
    wheels = await page.evaluate("""[...document.querySelectorAll('#db-bubbles .db-bubble-ring')].map(c => [+c.getAttribute('cx'), +c.getAttribute('cy'), +c.getAttribute('r')])""")
    clash = [(a, b) for i, a in enumerate(wheels) for b in wheels[i + 1:] if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 < a[2] + b[2] - 0.01]
    check(not clash, f"map: no two status wheels overlap ({len(clash)} overlapping pairs)")
    # Hovering a province shows a tooltip and must leave the rest of the page intact (regression: the tooltip
    # element was once the <body> itself, so the first hover wiped the page).
    await page.locator("#db-provinces path[data-id=nei_mongol]").dispatch_event("pointerenter", {"clientX": 600, "clientY": 500})
    await page.wait_for_timeout(200)
    check("Inner Mongolia" in await page.locator("#db-tooltip").inner_text(), "map: hovering a province shows its tooltip")
    check(await page.locator("#db-map").count() == 1 and await page.locator("#db-provinces path").count() >= 31, "map: the page survives a hover")
    await page.locator("#db-provinces path[data-id=nei_mongol]").dispatch_event("pointerleave")
    check("view=status" in page.url, "map: switching tabs updates the hash")
    await page.click("details:has(#db-group-status) button:has-text('Clear')")
    await page.wait_for_timeout(200)
    check(await page.locator("#db-k-count").inner_text() == "0", "map: clearing a filter group empties the selection")
    check(await page.locator("#db-bubbles > g").count() == 0, "map: no bubbles for an empty selection")
    await page.click("details:has(#db-group-status) button:has-text('Select all')")
    await page.fill("#db-search", "alibaba")
    await page.wait_for_timeout(400)
    n = int((await page.locator("#db-k-count").inner_text()).replace(",", ""))
    check(0 < n < total, f"map: search narrows the selection ({n})")
    # The Province dropdown is gone: clicking a province on the map focuses the dashboard on it instead.
    check(await page.locator("#db-province").count() == 0, "map: there is no Province dropdown")
    await page.locator("#db-provinces path[data-id=nei_mongol]").dispatch_event("click")
    await page.wait_for_timeout(300)
    m = int((await page.locator("#db-k-count").inner_text()).replace(",", ""))
    check(0 < m <= n, f"map: clicking a province narrows the selection further ({m})")
    check("Inner Mongolia" in await page.locator("#db-scope").inner_text(), "map: the sidebar names the focused province")
    check("inner mongolia" in (await page.locator("#db-profile-eyebrow").inner_text()).lower(), "map: the profile card names the focused province")  # eyebrow is CSS-uppercased
    check(await page.locator("#db-provinces path.is-dim").count() >= 30, "map: the other provinces dim")
    check(await page.locator("#db-bubbles > g").count() > 1, "map: the other provinces keep their bubbles, so they stay clickable")
    await page.locator("#db-provinces path[data-id=nei_mongol]").dispatch_event("click")
    await page.wait_for_timeout(300)
    check(await page.locator("#db-k-count").inner_text() == f"{n:,}", "map: clicking the focused province again returns to all of China")
    await page.locator("#db-provinces path[data-id=nei_mongol]").dispatch_event("click")
    await page.wait_for_timeout(300)
    await page.click("#db-reset")
    await page.wait_for_timeout(300)
    check(await page.locator("#db-k-count").inner_text() == f"{total:,}", "map: reset restores the full inventory")
    check(await page.locator("#db-provinces path.is-dim").count() == 0 and "Select a province" in await page.locator("#db-detail").inner_text(), "map: reset also clears the province focus")

    await page.locator("#db-provinces path[data-id=guangdong]").dispatch_event("click")
    await page.wait_for_timeout(300)
    detail = await page.locator("#db-detail").inner_text()
    check(detail.startswith("SOUTH CHINA") or "Guangdong" in detail, "map: clicking a province opens its profile")
    check("facility list" in detail.lower() and "7,355" in detail, "map: the profile lists facilities and the 2024 generation figure")
    check(not re.search(r"\b\d{2,3}\.\d{4,}\b", detail), "map: the profile shows no coordinate-like numbers")
    await page.locator("#db-detail .db-facility-list .link-btn").first.click()
    await page.wait_for_timeout(200)
    check("Location is published at province level only" in await page.locator("#db-detail").inner_text(), "map: facility profile states the location rule")
    # facility_details.csv: extra figures carry their basis and citation in the facility profile
    await page.locator("#db-provinces path[data-id=xinjiang]").dispatch_event("click")
    await page.wait_for_timeout(300)
    await page.locator("#db-detail .db-facility-list .link-btn", has_text="China Unicom (Xinjiang)").first.click()
    await page.wait_for_timeout(200)
    fac = await page.locator("#db-detail").inner_text()
    check("18,876 (vendor-reported)" in fac and "8,192 PFLOPS" in fac and "design figure" in fac and "Figures from" in fac,
          "map: a facility with extra figures shows racks, compute and PUE with their basis and source")
    check(not re.search(r"https?://|www\.", fac), "map: the facility profile carries no links")
    await page.locator("#db-provinces path[data-id=xinjiang]").dispatch_event("click")
    await page.wait_for_timeout(300)
    await page.locator("#db-provinces path[data-id=guangdong]").dispatch_event("click")
    await page.wait_for_timeout(300)

    # The focus set by clicking Guangdong carries over to the Generation tab: only its plant units are drawn and the
    # power infrastructure profile describes Guangdong. Close returns to all of China.
    await page.click(".db-tab[data-view=generation]")
    await page.wait_for_timeout(1500)
    gd_plants = await page.locator("#db-plants circle").count()
    title = await page.locator("#db-profile-title").inner_text()
    check("Guangdong" in title, f"map: the power infrastructure profile follows the clicked province ({title!r})")
    check(0 < gd_plants < 5000, f"map: the plant layer shows only the focused province ({gd_plants})")
    gd_units = int((await page.locator("#db-chart-total").inner_text()).split()[0].replace(",", ""))
    check(gd_units == gd_plants, f"map: the profile's unit count matches the drawn units ({gd_units} vs {gd_plants})")
    await page.locator("#db-detail button:has-text('Close')").click()
    await page.wait_for_timeout(400)
    plants = await page.locator("#db-plants circle").count()
    check(plants > 10000, f"map: Close returns the generation view to all of China ({plants})")
    check("all of China" in await page.locator("#db-profile-title").inner_text(), "map: the profile title then says all of China")
    await page.select_option("#db-gen-tech", "Nuclear")
    await page.wait_for_timeout(300)
    check(await page.locator("#db-plants circle").count() < 100, "map: the technology filter narrows the plant layer")
    await page.click(".db-tab[data-view=water]")
    await page.wait_for_timeout(200)
    check(await page.locator("#db-plants circle").count() == 0, "map: leaving the generation view clears the plant layer")
    check(await page.locator("#db-water-measure").is_visible(), "map: the water view shows its measure control")
    check(not await page.locator("#db-gen-tech").is_visible(), "map: other sub-controls are hidden")

    # Real mouse input, not dispatch_event: capturing the pointer on pointerdown used to retarget every click to the
    # <svg>, so a plain click on a province did nothing. A drag must pan without selecting or clearing anything.
    await page.locator("#db-map").scroll_into_view_if_needed()
    pt = await point_on(page, "#db-provinces path[data-id=hebei]")
    check(pt is not None, "map: found an unobstructed point on Hebei")
    if pt:
        await page.mouse.click(pt["x"], pt["y"])
        await page.wait_for_timeout(300)
        check("Hebei" in await page.locator("#db-detail h2").first.inner_text(), "map: a real mouse click on a province selects it")
        check(await page.locator("#db-chart .db-bar-row.is-focus").count() == 1, "map: the comparison chart highlights the focused province once")
        check("Hebei ranks" in await page.locator("#db-chart").inner_text(), "map: the comparison chart states the province's rank")
        await page.mouse.move(pt["x"], pt["y"])
        await page.mouse.down()
        await page.mouse.move(pt["x"] + 40, pt["y"] + 10, steps=4)
        await page.mouse.move(pt["x"] + 80, pt["y"] + 20, steps=4)
        await page.mouse.up()
        await page.wait_for_timeout(300)
        check("Hebei" in await page.locator("#db-detail h2").first.inner_text(), "map: dragging the map keeps the focused province")
        await page.click("#db-zoom-reset")
        await page.click("#db-reset")
        await page.wait_for_timeout(300)

    # Transmission lines (OpenStreetMap, >= 250 kV): an overlay on the energy tabs only.
    await page.click(".db-tab[data-view=power]")
    await page.wait_for_timeout(1500)
    n_lines = await page.locator("#db-lines path").count()
    check(n_lines > 50, f"map: the Power tab draws the transmission lines ({n_lines} paths)")
    check(await page.locator("#db-lines-toggle").is_visible(), "map: the Power tab shows the transmission toggle")
    legend = await page.locator("#db-legend").inner_text()
    check("OpenStreetMap" in legend and "ODbL" in legend, "map: the legend credits OpenStreetMap (ODbL)")
    check("500 kV line" in legend, "map: the legend lists the voltage classes")
    pe = await page.evaluate("getComputedStyle(document.querySelector('#db-lines path')).pointerEvents")
    check(pe == "none", f"map: lines never take pointer events, so province clicks pass through ({pe})")
    await page.locator("#db-provinces path[data-id=gansu]").dispatch_event("click")
    await page.wait_for_timeout(300)
    check(await page.locator("#db-lines path.is-dim").count() > 0
          and await page.locator("#db-lines path[data-province=gansu]:not(.is-dim)").count() > 0,
          "map: focusing a province dims the other provinces' lines")
    detail = await page.locator("#db-detail").inner_text()
    check(re.search(r"Transmission ≥250 kV\s+[\d,]+ km mapped", detail) is not None, "map: the province detail gives mapped transmission km")
    check("km mapped" in (await page.locator("#db-chart").inner_text()).lower(), "map: the power infrastructure profile includes transmission km")  # sub-heading is CSS-uppercased
    check(not BAD_TEXT.search(await page.locator("main, #app").first.inner_text()), "map: no null/undefined/NaN on the Power tab with a province focused")
    await page.uncheck("#db-lines-toggle")
    await page.wait_for_timeout(200)
    check(await page.locator("#db-lines path").count() == 0, "map: the toggle hides the lines")
    await page.check("#db-lines-toggle")
    await page.click(".db-tab[data-view=generation]")
    await page.wait_for_timeout(800)
    check(await page.locator("#db-lines path").count() > 50, "map: the Generation tab draws the lines too")
    await page.click(".db-tab[data-view=status]")
    await page.wait_for_timeout(200)
    check(await page.locator("#db-lines path").count() == 0, "map: the lines are only drawn on the energy tabs")
    check(not await page.locator("#db-lines-toggle").is_visible(), "map: the toggle is hidden on the other tabs")
    await page.click("#db-reset")
    await page.wait_for_timeout(200)

    # The inventory is not downloadable: no export control anywhere on the map page, and no <a download>.
    check(await page.locator("#db-export, button:has-text('Export')").count() == 0, "map: no export control")
    check(await page.locator("a[download]").count() == 0, "map: no download links")
    await page.click(".db-tab[data-view=status]")
    await page.wait_for_timeout(200)
    check(await page.locator("#db-chart .db-donut-slice").count() >= 2, "map: the status profile is a donut")
    check("operating" in (await page.locator("#db-chart").inner_text()).lower(), "map: the donut legend names the categories")
    check(not problems, f"map: still no errors after interactions {problems[:2] if problems else ''}")
    await page.close()
    await ctx.close()


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
