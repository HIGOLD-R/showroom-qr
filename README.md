# Showroom QR

Static generator for product cards and QR codes.

## What is generated
- `dist/data/products.json` - normalized products from Google Sheets
- `dist/p/<product_id>/index.html` - product pages
- `dist/qr/<product_id>.svg` - QR files for print
- `dist/index.html` - product list

## Data source
Two published CSV links from one Google Spreadsheet:
- `products` sheet (main product data)
- `images_map` sheet (image links by `ITEM NO.`)

## Expected columns
### products
- `ITEM NO.` (required, unique)
- `NAME`
- `NAME AZ`
- `BOX PRICE` (optional)
- `RETAIL PRICE`
- `MANUFACTURER`
- `FEATURES`
- `INNER MEASURES`
- `OUTER MEASURES`
- `DESCRIPTION`
- `Status / Status`
- `ACTIVE`
- `UPDATED_AT`

### images_map
Minimum:
- `ITEM NO.`
- `image_url`

Optional:
- `is_main` (`TRUE/FALSE`)
- `sort_order` (`1,2,3...`)
- `active` (`TRUE/FALSE`)

## Local run
1. Copy config:
```powershell
Copy-Item config.example.json config.json
```
2. Set your real Pages URL in `config.json`:
```json
"siteBaseUrl": "https://<github-username>.github.io/<repo>"
```
3. Install and build:
```powershell
npm install
npm run build
```

## GitHub Pages
Workflow is in `.github/workflows/deploy.yml`.

It runs:
- manually (`workflow_dispatch`)
- every 6 hours (`cron`)

During workflow run, `siteBaseUrl` is auto-set to:
`https://<owner>.github.io/<repo>`

After first push:
1. Open repo -> `Settings` -> `Pages`.
2. Ensure source is `GitHub Actions`.
3. Run action `Build and Deploy Pages`.

## Notes
- Public site uses only status, not exact stock quantity.
- Product URL is stable and based on `ITEM NO.`.
- If one item has multiple images, main image is selected by `is_main`, then `sort_order`.
