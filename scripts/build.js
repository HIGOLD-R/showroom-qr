import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PRODUCT_FIELDS = {
  id: "ITEM NO.",
  name: "NAME",
  nameAz: "NAME AZ",
  boxPrice: "BOX PRICE",
  retailPrice: "RETAIL PRICE",
  manufacturer: "MANUFACTURER",
  features: "FEATURES",
  innerMeasures: "INNER MEASURES",
  outerMeasures: "OUTER MEASURES",
  description: "DESCRIPTION",
  status: "Status / Status",
  active: "ACTIVE",
  updatedAt: "UPDATED_AT",
};

const DEFAULT_IMAGE_FIELDS = {
  id: "ITEM NO.",
  imageUrl: "image_url",
  isMain: "is_main",
  sortOrder: "sort_order",
  active: "active",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        value += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(value);
      value = "";
      continue;
    }

    if (ch === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    if (ch === '\r') {
      continue;
    }

    value += ch;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell || "").trim() !== ""));
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h || "").trim());
  return rows.slice(1).map((row) => {
    const out = {};
    headers.forEach((header, idx) => {
      out[header] = String(row[idx] ?? "").trim();
    });
    return out;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseMoney(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value, currency = "AZN") {
  if (value == null) return "";
  return `${value.toFixed(2)} ${currency}`;
}

function toBoolean(value, fallback = true) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["true", "1", "yes", "active", "y"].includes(raw)) return true;
  if (["false", "0", "no", "inactive", "n"].includes(raw)) return false;
  return fallback;
}

function normalizeStockStatus(rawValue) {
  const raw = String(rawValue ?? "").toLowerCase();
  if (!raw) return "unknown";
  if (raw.includes("in stock") || raw.includes("movcud")) return "in_stock";
  if (raw.includes("out of stock") || raw.includes("yox")) return "out_of_stock";
  if (raw.includes("preorder") || raw.includes("pre-order")) return "preorder";
  if (raw.includes("request")) return "on_request";
  return "unknown";
}

function normalizePathId(value) {
  const cleaned = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "item";
}

function compareImageRecords(a, b) {
  if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
  return a.sortOrder - b.sortOrder;
}

async function ensureCleanOutput(outputDir) {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outputDir, "data"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "p"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "qr"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "admin", "qr"), { recursive: true });
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function renderPage(title, body, css) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

const PRODUCT_CSS = `
:root {
  --bg: #f1f3f8;
  --card: #ffffff;
  --ink: #111827;
  --muted: #6b7280;
  --line: #e6e8ee;
  --ok-bg: #2ea96a;
  --ok-ink: #ffffff;
  --price: #0f172a;
  --box-bg: #fff8e7;
  --box-line: #f2d89a;
  --box-ink: #7c4d00;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: linear-gradient(180deg, #ebedf4 0%, #f7f8fc 100%);
  font-family: "Segoe UI", Tahoma, sans-serif;
  color: var(--ink);
  padding: 18px;
}
.wrap {
  max-width: 560px;
  margin: 0 auto;
}
.card {
  background: var(--card);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 16px 36px rgba(17, 24, 39, 0.12);
  border: 1px solid rgba(17, 24, 39, 0.05);
}
.media {
  position: relative;
  background: #0f1117;
  min-height: 340px;
  display: grid;
  place-items: center;
}
.media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  min-height: 340px;
}
.status {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  background: #f3f4f6;
  color: #111827;
}
.status.in_stock { background: var(--ok-bg); color: var(--ok-ink); }
.status.out_of_stock { background: #ef4444; color: #fff; }
.status.preorder, .status.on_request, .status.unknown { background: #f59e0b; color: #fff; }
.content { padding: 18px 20px 20px; }
.brand {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
}
.name-en {
  margin: 8px 0 4px;
  font-size: 39px;
  line-height: 1.06;
  font-weight: 800;
}
.name-az {
  margin: 0;
  color: #4b5563;
  font-size: 16px;
  line-height: 1.35;
  font-weight: 600;
}
.desc {
  margin: 12px 0 0;
  color: #374151;
  line-height: 1.5;
  white-space: pre-wrap;
}
.sec-title {
  margin: 18px 0 10px;
  color: var(--muted);
  letter-spacing: 0.08em;
  font-size: 13px;
  text-transform: uppercase;
  font-weight: 700;
}
.spec-list {
  display: grid;
  gap: 8px;
}
.spec-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--line);
  background: #fafbff;
  border-radius: 12px;
  padding: 10px 12px;
}
.spec-row .k { color: #374151; }
.spec-row .v { color: #0f172a; font-weight: 700; text-align: right; }
.divider {
  margin: 18px 0;
  border-top: 1px solid var(--line);
}
.pricing {
  display: grid;
  gap: 12px;
}
.unit {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}
.unit .l {
  color: var(--muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 13px;
  font-weight: 700;
}
.unit .v {
  color: var(--price);
  font-size: 46px;
  font-weight: 900;
  line-height: 1;
}
.box-price {
  border: 1px solid var(--box-line);
  background: var(--box-bg);
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}
.box-price .l {
  color: var(--box-ink);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 14px;
}
.box-price .hint {
  color: var(--box-ink);
  opacity: 0.85;
  font-size: 13px;
}
.box-price .v {
  color: var(--box-ink);
  font-size: 33px;
  font-weight: 900;
  line-height: 1;
}
.meta {
  margin-top: 12px;
  color: #6b7280;
  font-size: 13px;
}
@media (max-width: 640px) {
  body { padding: 10px; }
  .name-en { font-size: 29px; }
  .unit .v { font-size: 36px; }
  .box-price .v { font-size: 28px; }
}
`;

const ADMIN_CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: #f7f8fb; color: #111827; }
.main { max-width: 1100px; margin: 0 auto; padding: 20px 14px 28px; }
.head { display: flex; justify-content: space-between; align-items: end; gap: 10px; margin-bottom: 14px; }
.h1 { margin: 0; font-size: 28px; }
.sub { color: #6b7280; font-size: 14px; margin-top: 4px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { display: inline-block; text-decoration: none; border: 1px solid #d9deea; background: white; color: #111827; border-radius: 10px; padding: 8px 12px; font-weight: 600; }
.tbl-wrap { background: white; border: 1px solid #e6e9f0; border-radius: 12px; overflow: auto; }
table { width: 100%; border-collapse: collapse; min-width: 900px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #edf0f5; font-size: 14px; }
th { background: #f8f9fc; font-size: 13px; color: #374151; text-transform: uppercase; letter-spacing: 0.04em; }
tr:hover td { background: #fafcff; }
a { color: #0f5cc0; text-decoration: none; }
a:hover { text-decoration: underline; }
.badge { display: inline-block; padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.badge.in_stock { background: #dcfce7; color: #166534; }
.badge.out_of_stock { background: #fee2e2; color: #991b1b; }
.badge.preorder, .badge.on_request, .badge.unknown { background: #fef3c7; color: #92400e; }
`;

async function fetchCsv(csvUrl, label) {
  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${label}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function build() {
  const configPath = path.resolve(__dirname, "..", "config.json");
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read config.json. Copy config.example.json first. ${error.message}`);
  }

  if (!config.productsCsvUrl || !config.imagesCsvUrl || !config.siteBaseUrl) {
    throw new Error("config.json must contain productsCsvUrl, imagesCsvUrl and siteBaseUrl.");
  }

  const outputDir = path.resolve(__dirname, "..", config.outputDir || "dist");
  const productFields = { ...DEFAULT_PRODUCT_FIELDS, ...(config.productFields || {}) };
  const imageFields = { ...DEFAULT_IMAGE_FIELDS, ...(config.imageFields || {}) };

  const productsCsv = await fetchCsv(config.productsCsvUrl, "products CSV");
  const imagesCsv = await fetchCsv(config.imagesCsvUrl, "images CSV");

  const productRows = rowsToObjects(parseCsv(productsCsv));
  const imageRows = rowsToObjects(parseCsv(imagesCsv));

  const imagesById = new Map();
  for (const row of imageRows) {
    const productId = String(row[imageFields.id] || "").trim();
    const imageUrl = String(row[imageFields.imageUrl] || "").trim();
    if (!productId || !imageUrl) continue;
    const record = {
      url: imageUrl,
      isMain: toBoolean(row[imageFields.isMain], false),
      sortOrder: Number.parseInt(row[imageFields.sortOrder], 10) || 999,
      active: toBoolean(row[imageFields.active], true),
    };
    if (!record.active) continue;
    const current = imagesById.get(productId) || [];
    current.push(record);
    imagesById.set(productId, current);
  }

  const seenIds = new Map();
  const seenUrlIds = new Map();
  const warnings = [];
  const products = [];

  for (const row of productRows) {
    const sourceId = String(row[productFields.id] || "").trim();
    if (!sourceId) {
      warnings.push("Skipped row with empty ITEM NO.");
      continue;
    }

    const duplicateIndex = (seenIds.get(sourceId) || 0) + 1;
    seenIds.set(sourceId, duplicateIndex);
    const productId = duplicateIndex === 1 ? sourceId : `${sourceId}--${duplicateIndex}`;
    if (duplicateIndex > 1) warnings.push(`Duplicate ITEM NO. \"${sourceId}\" -> generated \"${productId}\"`);

    const urlBase = normalizePathId(productId);
    const urlIndex = (seenUrlIds.get(urlBase) || 0) + 1;
    seenUrlIds.set(urlBase, urlIndex);
    const urlId = urlIndex === 1 ? urlBase : `${urlBase}--${urlIndex}`;

    const active = toBoolean(row[productFields.active], true);
    if (!active) continue;

    const images = (imagesById.get(sourceId) || []).sort(compareImageRecords);

    products.push({
      product_id: productId,
      source_item_no: sourceId,
      item_no: sourceId,
      url_id: urlId,
      name: String(row[productFields.name] || "").trim(),
      name_az: String(row[productFields.nameAz] || "").trim(),
      box_price: parseMoney(row[productFields.boxPrice]),
      retail_price: parseMoney(row[productFields.retailPrice]),
      currency: "AZN",
      manufacturer: String(row[productFields.manufacturer] || "").trim(),
      features: String(row[productFields.features] || "").trim(),
      inner_measures: String(row[productFields.innerMeasures] || "").trim(),
      outer_measures: String(row[productFields.outerMeasures] || "").trim(),
      description: String(row[productFields.description] || "").trim(),
      stock_status: normalizeStockStatus(row[productFields.status]),
      stock_label: String(row[productFields.status] || "").trim(),
      updated_at: String(row[productFields.updatedAt] || "").trim(),
      active: true,
      images: images.map((item) => item.url),
      image_main: images.length ? images[0].url : "",
    });
  }

  await ensureCleanOutput(outputDir);

  const cleanBase = String(config.siteBaseUrl || "").replace(/\/+$/, "");
  await writeFile(path.join(outputDir, "data", "products.json"), JSON.stringify(products, null, 2));

  const rootHtml = renderPage(
    "HIGOLD Showroom",
    `<main style="max-width:760px;margin:40px auto;padding:18px;background:white;border:1px solid #e8ebf3;border-radius:12px;font-family:Segoe UI,Tahoma,sans-serif;">
      <h1 style="margin:0 0 10px;">HIGOLD Showroom</h1>
      <p style="margin:6px 0;color:#4b5563;">Public catalog is disabled. Use product QR code to open each product card.</p>
      <p style="margin:6px 0;color:#4b5563;">Admin QR page: <a href="./admin/qr/">/admin/qr/</a></p>
    </main>`,
    "body{margin:0;background:#f7f8fc;}a{color:#0f5cc0;}"
  );
  await writeFile(path.join(outputDir, "index.html"), rootHtml);

  const adminRows = [];
  const manifestRows = [["product_id", "url_id", "name", "product_url", "qr_svg_url"]];

  for (const product of products) {
    const productRelativePath = `p/${encodeURIComponent(product.url_id)}/`;
    const productUrl = `${cleanBase}/${productRelativePath}`;
    const qrRelativePath = `qr/${encodeURIComponent(product.url_id)}.svg`;
    const qrAbsoluteUrl = `${cleanBase}/${qrRelativePath}`;

    const qrSvg = await QRCode.toString(productUrl, {
      type: "svg",
      margin: 1,
      width: 256,
      errorCorrectionLevel: "M",
    });

    await writeFile(path.join(outputDir, "qr", `${encodeURIComponent(product.url_id)}.svg`), qrSvg);

    const mainImageHtml = product.image_main
      ? `<img src="${escapeHtml(product.image_main)}" alt="${escapeHtml(product.name || product.product_id)}" />`
      : "<div style=\"color:#9ca3af;font-weight:600;\">No image</div>";

    const specRows = [
      ["Item No", product.item_no],
      ["Features", product.features],
      ["Inner Measures", product.inner_measures],
      ["Outer Measures", product.outer_measures],
      ["Manufacturer", product.manufacturer],
    ]
      .filter(([, value]) => String(value || "").trim() !== "")
      .map(([k, v]) => `<div class="spec-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`)
      .join("");

    const descriptionHtml = product.description ? `<p class="desc">${escapeHtml(product.description)}</p>` : "";
    const nameAzHtml = product.name_az ? `<p class="name-az">${escapeHtml(product.name_az)}</p>` : "";
    const unitPrice = product.retail_price != null ? formatMoney(product.retail_price, product.currency) : "Price on request";

    const boxPriceHtml = product.box_price != null
      ? `<div class="box-price">
          <div>
            <div class="l">Box Price</div>
            <div class="hint">Only for selected categories</div>
          </div>
          <div class="v">${escapeHtml(formatMoney(product.box_price, product.currency))}</div>
        </div>`
      : "";

    const productHtml = renderPage(
      `${product.product_id} - ${product.name}`,
      `<div class="wrap">
  <article class="card">
    <div class="media">
      ${mainImageHtml}
      <div class="status ${escapeHtml(product.stock_status)}">${escapeHtml(product.stock_label || product.stock_status)}</div>
    </div>
    <div class="content">
      <p class="brand">${escapeHtml(product.manufacturer || "HIGOLD")}</p>
      <h1 class="name-en">${escapeHtml(product.name || product.product_id)}</h1>
      ${nameAzHtml}
      ${descriptionHtml}

      ${specRows ? `<h3 class="sec-title">Features</h3><div class="spec-list">${specRows}</div>` : ""}

      <div class="divider"></div>

      <div class="pricing">
        <div class="unit">
          <div class="l">Unit Price</div>
          <div class="v">${escapeHtml(unitPrice)}</div>
        </div>
        ${boxPriceHtml}
      </div>

      <div class="meta">Product ID: ${escapeHtml(product.product_id)}</div>
    </div>
  </article>
</div>`,
      PRODUCT_CSS
    );

    await writeFile(path.join(outputDir, "p", product.url_id, "index.html"), productHtml);

    adminRows.push(`<tr>
  <td>${escapeHtml(product.product_id)}</td>
  <td>${escapeHtml(product.name || "")}</td>
  <td><span class="badge ${escapeHtml(product.stock_status)}">${escapeHtml(product.stock_label || product.stock_status)}</span></td>
  <td><a href="../../${escapeHtml(productRelativePath)}" target="_blank" rel="noopener">Open Card</a></td>
  <td><a href="../../${escapeHtml(qrRelativePath)}" target="_blank" rel="noopener">Open QR</a></td>
  <td><a href="../../${escapeHtml(qrRelativePath)}" download>Download SVG</a></td>
</tr>`);

    manifestRows.push([
      product.product_id,
      product.url_id,
      product.name,
      productUrl,
      qrAbsoluteUrl,
    ]);
  }

  const adminHtml = renderPage(
    "Admin QR Index",
    `<main class="main">
  <div class="head">
    <div>
      <h1 class="h1">Admin QR Index</h1>
      <div class="sub">Total products: ${products.length}. You can open or download each QR SVG.</div>
    </div>
    <div class="actions">
      <a class="btn" href="../qr-manifest.csv" download>Download manifest CSV</a>
      <a class="btn" href="../../index.html">Home</a>
    </div>
  </div>
  <div class="tbl-wrap">
    <table>
      <thead>
        <tr>
          <th>Product ID</th>
          <th>Name</th>
          <th>Status</th>
          <th>Card</th>
          <th>QR</th>
          <th>Download</th>
        </tr>
      </thead>
      <tbody>
        ${adminRows.join("\n")}
      </tbody>
    </table>
  </div>
</main>`,
    ADMIN_CSS
  );

  await writeFile(path.join(outputDir, "admin", "qr", "index.html"), adminHtml);

  const manifestCsv = manifestRows.map((row) => row.map(csvEscape).join(",")).join("\n");
  await writeFile(path.join(outputDir, "admin", "qr-manifest.csv"), `${manifestCsv}\n`);

  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }
  console.log(`Built ${products.length} products in ${outputDir}`);
}

build().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
