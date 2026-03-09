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

const PRODUCT_ALIASES = {
  id: ["ITEM NO.", "item no", "item no.", "product_id", "id"],
  name: ["NAME", "name", "English name"],
  nameAz: ["NAME AZ", "name az"],
  boxPrice: ["BOX PRICE", "box price", "box_price"],
  retailPrice: ["RETAIL PRICE", "retail price", "retail_price"],
  manufacturer: ["MANUFACTURER", "manufacturer", "brand"],
  features: ["FEATURES", "features", "feature"],
  innerMeasures: ["INNER MEASURES", "inner measures"],
  outerMeasures: ["OUTER MEASURES", "outer measures"],
  description: ["DESCRIPTION", "description"],
  status: ["Status / Status", "status", "Stock status"],
  active: ["ACTIVE", "active"],
  updatedAt: ["UPDATED_AT", "updated_at", "updated at"],
};

const IMAGE_ALIASES = {
  id: ["ITEM NO.", "item no", "item no.", "product_id", "id"],
  imageUrl: ["image_url", "image url", "url", "link", "image"],
  isMain: ["is_main", "ismain", "main", "IS_MAIN"],
  sortOrder: ["sort_order", "sort order", "order", "SORT_ORDER"],
  active: ["active", "ACTIVE"],
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

    if (ch === '\r') continue;

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
  const headers = rows[0].map((h) => String(h || "").replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((row) => {
    const out = {};
    headers.forEach((header, idx) => {
      out[header] = String(row[idx] ?? "").trim();
    });
    return out;
  });
}

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._/-]+/g, "")
    .replace(/[()]/g, "")
    .replace(/\uFEFF/g, "");
}

function getByAliases(row, aliases) {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = String(row[key] ?? "").trim();
      if (value) return value;
    }
  }

  const aliasSet = new Set(aliases.map(normalizeKey));
  for (const [key, valueRaw] of Object.entries(row)) {
    if (aliasSet.has(normalizeKey(key))) {
      const value = String(valueRaw ?? "").trim();
      if (value) return value;
    }
  }
  return "";
}

function cleanItemNo(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^(?:copy|\u043A\u043E\u043F\u0438\u044F)\s+/iu, "").trim();
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

function normalizeImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";

  const getDriveId = (value) => {
    const fileDMatch = value.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (fileDMatch) return fileDMatch[1];
    const openIdMatch = value.match(/[?&]id=([^&]+)/i);
    if (openIdMatch) return openIdMatch[1];
    return "";
  };

  const driveId = getDriveId(raw);
  if (driveId) {
    return `https://drive.google.com/thumbnail?id=${driveId}&sz=w1600`;
  }

  return raw;
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
  --bg: #eceff4;
  --card: #ffffff;
  --ink: #0f172a;
  --muted: #6b7280;
  --line: #e5e7eb;
  --ok: #22a26d;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
  background: radial-gradient(1200px 600px at top left, #f5f7fb, #e7ebf3);
}
body {
  font-family: "Segoe UI", Tahoma, sans-serif;
  color: var(--ink);
  padding: 20px 20px calc(20px + env(safe-area-inset-bottom));
}
.wrap { max-width: 560px; margin: 0 auto; }
.card {
  background: var(--card);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 20px 38px rgba(2, 6, 23, 0.16);
  border: 1px solid rgba(15, 23, 42, 0.06);
}
.media {
  position: relative;
  aspect-ratio: 1 / 1;
  background: linear-gradient(160deg, #10131b, #1b1f2a);
  overflow: hidden;
}
.media img { width: 100%; height: 100%; object-fit: cover; }
.status {
  position: absolute;
  top: 14px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 8px 14px;
  font-weight: 700;
  font-size: 14px;
  backdrop-filter: blur(6px);
  color: #fff;
  background: rgba(107, 114, 128, 0.85);
}
.status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.status.in_stock { background: rgba(34, 162, 109, 0.92); }
.status.out_of_stock { background: rgba(220, 38, 38, 0.92); }
.status.preorder, .status.on_request, .status.unknown { background: rgba(202, 138, 4, 0.92); }
.content { padding: 20px; }
.brand {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
}
.name-en {
  margin: 10px 0 4px;
  font-size: 40px;
  line-height: 1.04;
  font-weight: 900;
}
.name-az {
  margin: 0;
  color: #475569;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
}
.desc {
  margin: 12px 0 0;
  color: #374151;
  line-height: 1.5;
  white-space: pre-wrap;
}
.sec-title {
  margin: 20px 0 10px;
  color: #6b7280;
  font-size: 13px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
}
.spec-list { display: grid; gap: 8px; }
.spec-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  background: #f8fafc;
  border: 1px solid #edf0f5;
  border-radius: 10px;
  padding: 11px 12px;
}
.spec-row .k { color: #4b5563; font-size: 14px; }
.spec-row .v { color: #0f172a; font-size: 15px; font-weight: 800; }
.divider { margin: 18px 0; border-top: 1px solid var(--line); }
.pricing { display: grid; gap: 12px; }
.unit { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.unit .l {
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 13px;
  font-weight: 700;
}
.unit .v { font-size: 50px; line-height: 1; font-weight: 900; color: #0b1325; }
.box-price {
  border: 1px solid #f2d48f;
  background: linear-gradient(160deg, #fff9eb, #fff4db);
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}
.box-price .l {
  color: #7a4a00;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 13px;
  font-weight: 800;
}
.box-price .hint { color: #955f0a; font-size: 12px; margin-top: 2px; }
.box-price .v { color: #7a4a00; font-size: 34px; line-height: 1; font-weight: 900; }
.meta { margin-top: 12px; font-size: 13px; color: #64748b; }
@media (max-width: 640px) {
  body { padding: 10px 10px calc(10px + env(safe-area-inset-bottom)); }
  .name-en { font-size: 30px; }
  .unit .v { font-size: 39px; }
  .box-price .v { font-size: 29px; }
}
`;

const ADMIN_CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: #f7f8fb; color: #111827; }
.main { max-width: 1120px; margin: 0 auto; padding: 20px 14px 28px; }
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
    const rowValues = Object.values(row).map((v) => String(v || "").trim());

    let productId = cleanItemNo(getByAliases(row, [imageFields.id, ...IMAGE_ALIASES.id]));
    if (!productId && rowValues.length > 0) {
      productId = cleanItemNo(rowValues[0]);
    }

    let imageUrlRaw = getByAliases(row, [imageFields.imageUrl, ...IMAGE_ALIASES.imageUrl]);
    if (!imageUrlRaw && rowValues.length > 1) {
      imageUrlRaw = rowValues[1];
    }

    const imageUrl = normalizeImageUrl(imageUrlRaw);
    if (!productId || !imageUrl) continue;
    const record = {
      url: imageUrl,
      isMain: toBoolean(getByAliases(row, [imageFields.isMain, ...IMAGE_ALIASES.isMain]), false),
      sortOrder: Number.parseInt(getByAliases(row, [imageFields.sortOrder, ...IMAGE_ALIASES.sortOrder]), 10) || 999,
      active: toBoolean(getByAliases(row, [imageFields.active, ...IMAGE_ALIASES.active]), true),
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
    const sourceId = cleanItemNo(getByAliases(row, [productFields.id, ...PRODUCT_ALIASES.id]));
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

    const active = toBoolean(getByAliases(row, [productFields.active, ...PRODUCT_ALIASES.active]), true);
    if (!active) continue;

    const images = (imagesById.get(sourceId) || []).sort(compareImageRecords);

    products.push({
      product_id: productId,
      source_item_no: sourceId,
      item_no: sourceId,
      url_id: urlId,
      name: getByAliases(row, [productFields.name, ...PRODUCT_ALIASES.name]),
      name_az: getByAliases(row, [productFields.nameAz, ...PRODUCT_ALIASES.nameAz]),
      box_price: parseMoney(getByAliases(row, [productFields.boxPrice, ...PRODUCT_ALIASES.boxPrice])),
      retail_price: parseMoney(getByAliases(row, [productFields.retailPrice, ...PRODUCT_ALIASES.retailPrice])),
      currency: "AZN",
      manufacturer: getByAliases(row, [productFields.manufacturer, ...PRODUCT_ALIASES.manufacturer]),
      features: getByAliases(row, [productFields.features, ...PRODUCT_ALIASES.features]),
      inner_measures: getByAliases(row, [productFields.innerMeasures, ...PRODUCT_ALIASES.innerMeasures]),
      outer_measures: getByAliases(row, [productFields.outerMeasures, ...PRODUCT_ALIASES.outerMeasures]),
      description: getByAliases(row, [productFields.description, ...PRODUCT_ALIASES.description]),
      stock_status: normalizeStockStatus(getByAliases(row, [productFields.status, ...PRODUCT_ALIASES.status])),
      stock_label: getByAliases(row, [productFields.status, ...PRODUCT_ALIASES.status]),
      updated_at: getByAliases(row, [productFields.updatedAt, ...PRODUCT_ALIASES.updatedAt]),
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
      ? `<img src="${escapeHtml(product.image_main)}" alt="${escapeHtml(product.name || product.product_id)}" referrerpolicy="no-referrer" loading="eager" onerror="if(!this.dataset.f){const m=this.src.match(/[?&]id=([^&]+)/);if(m){this.dataset.f='1';this.src='https://drive.google.com/uc?export=view&id='+m[1];}}" />`
      : "<div style=\"color:#9ca3af;font-weight:600;display:grid;place-items:center;width:100%;height:100%;\">No image</div>";

    const specRows = [
      ["Features", product.features],
      ["Inner Measures", product.inner_measures],
      ["Outer Measures", product.outer_measures],
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

    const featuresSection = specRows
      ? `<h3 class="sec-title">Features</h3><div class="spec-list">${specRows}</div>`
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
      ${featuresSection}
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
