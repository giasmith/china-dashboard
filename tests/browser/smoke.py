#!/usr/bin/env python3
"""Browser smoke test (Playwright + Chromium). Loads every page at desktop and phone width in light and dark
mode and checks:
  - no uncaught exceptions, no console errors, no failed requests
  - no page-level horizontal scroll
  - no stray "null" / "undefined" / "NaN" text anywhere in the rendered page
  - key interactions work: search, status toggle, row selection, URL-hash state, invalid year range, empty state
  - the map dashboard: layer tabs, filters, province selection, that there is no export/download control, and that
    no coordinate ever reaches the browser for a facility

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
    check(await page.locator("#db-bubbles > g").count() <= 34, "map: at most one bubble per province (no per-facility points)")

    await page.click(".db-tab[data-view=status]")
    await page.wait_for_timeout(200)
    check(await page.locator("#db-bubbles .db-slice").count() > 0, "map: the status view draws status wheels")
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
    await page.select_option("#db-province", "nei_mongol")
    await page.wait_for_timeout(300)
    m = int((await page.locator("#db-k-count").inner_text()).replace(",", ""))
    check(0 < m <= n, f"map: province filter narrows further ({m})")
    await page.click("#db-reset")
    await page.wait_for_timeout(300)
    check(await page.locator("#db-k-count").inner_text() == f"{total:,}", "map: reset restores the full inventory")

    await page.locator("#db-provinces path[data-id=guangdong]").dispatch_event("click")
    await page.wait_for_timeout(300)
    detail = await page.locator("#db-detail").inner_text()
    check(detail.startswith("SOUTH CHINA") or "Guangdong" in detail, "map: clicking a province opens its profile")
    check("facility list" in detail.lower() and "7,355" in detail, "map: the profile lists facilities and the 2024 generation figure")
    check(not re.search(r"\b\d{2,3}\.\d{4,}\b", detail), "map: the profile shows no coordinate-like numbers")
    await page.locator("#db-detail .db-facility-list .link-btn").first.click()
    await page.wait_for_timeout(200)
    check("Location is published at province level only" in await page.locator("#db-detail").inner_text(), "map: facility profile states the location rule")

    await page.click(".db-tab[data-view=generation]")
    await page.wait_for_timeout(1500)
    plants = await page.locator("#db-plants circle").count()
    check(plants > 10000, f"map: the generation view loads the plant units ({plants})")
    await page.select_option("#db-gen-tech", "Nuclear")
    await page.wait_for_timeout(300)
    check(await page.locator("#db-plants circle").count() < 100, "map: the technology filter narrows the plant layer")
    await page.click(".db-tab[data-view=water]")
    await page.wait_for_timeout(200)
    check(await page.locator("#db-plants circle").count() == 0, "map: leaving the generation view clears the plant layer")
    check(await page.locator("#db-water-measure").is_visible(), "map: the water view shows its measure control")
    check(not await page.locator("#db-gen-tech").is_visible(), "map: other sub-controls are hidden")

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
