# Maintenance Checklist

## Daily / On update
1. Update product data in Google Sheets (`products`, `images_map`).
2. Open GitHub repo -> `Actions`.
3. Run `Build and Deploy Pages` (`Run workflow`).
4. Wait for green status on `build` and `deploy` jobs.
5. Open 2-3 random product URLs and verify:
   - image is visible,
   - status is correct,
   - price is correct.

## Weekly checks
1. Open `/admin/qr/` and verify rows load.
2. Download `/admin/qr-manifest.csv` and check it opens in Excel.
3. In latest workflow run, download artifact `qr-codes-svg` and verify SVG files are present.

## If something is wrong
1. If image is missing:
   - check `images_map` has the product code in first column,
   - check direct image link is in second column,
   - ensure Google Drive image is shared publicly.
2. If product page not updated:
   - rerun workflow,
   - clear browser cache or open URL with `?v=5`.
3. If workflow fails:
   - open failed job logs in `Actions`,
   - fix table format issues (empty IDs, malformed links),
   - rerun workflow.

## Data rules
1. `ITEM NO.` should be stable and preferably unique.
2. `BOX PRICE` can be empty.
3. `FEATURES` can be empty.
4. `ACTIVE` empty means active by default.

## Security note
1. GitHub Pages is public.
2. Any deployed admin URL is accessible if someone knows the link.
3. For private bulk QR usage, prefer downloading artifact `qr-codes-svg` from `Actions` instead of sharing admin URL.
