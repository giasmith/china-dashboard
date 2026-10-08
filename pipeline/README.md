# Pipeline

Gathers Chinese legislation and statistics and turns them into the dashboard's data files. **This is a stub**: the
foundations are in place and tested; the extraction steps are the next piece of work.

## Stages (planned)

1. **Fetch** - `china_pipeline.fetch.PoliteFetcher`. Done. Enforces: source must be `enabled`, URL must be on the
   source's own host, robots.txt is honoured (a server error or timeout on robots.txt means *do not fetch*), a delay per
   host, a size cap, and every download is saved raw with a provenance sidecar (URL, UTC timestamp, SHA-256).
2. **Parse** - turn raw HTML/PDF into text and metadata. *Not started.*
3. **Extract** - draft `plan_targets` (indicator, baseline, target, year, binding/anticipated) and `legislation`
   records from parsed text. *Not started.* Extraction will be assistive: each draft record is written with
   `verified: false` and a pointer to the snapshot it came from, and a person confirms it.
4. **Actuals** - collect reported values (statistical communiques etc.) for each target. *Not started.*
5. **Validate and publish** - write to `site/data/` and run `scripts/validate_data.py`. The schemas in `../schemas/`
   are the contract.

## Source registry

`config/sources.yml` lists candidate sources, all `planned`. A source can only be `enabled` once `access_checked` is
true, meaning a person has read its terms of use and robots.txt and recorded the outcome in `access_notes`. The loader
refuses anything else, and the fetcher refuses anything not `enabled`.

## Ground rules

- No paywall circumvention, no aggressive crawling, no fetching from hosts that are not a registered source.
- Raw downloads (`pipeline/data/raw/`) are git-ignored; they can be large and may carry licensing limits.
- Provenance is not optional: a published number must be traceable to a snapshot hash.

## Tests

```bash
python3 -m unittest discover -s pipeline/tests -v     # offline; the network layer is injected
```
