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

    if (ch === ",") {
      row.push(value);
      value = "";
      continue;
    }

    if (ch === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    if (ch === "\r") {
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

function parseMoney(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function renderLayout({ title, body, homeHref }) {
  const generatedAt = new Date().toISOString();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #efe9db;
      --bg2: #e4dbc8;
      --surface: #fffdf7;
      --ink: #1f1e1a;
      --muted: #6f6b60;
      --line: #e1d7bf;
      --accent: #206a4f;
      --accent-2: #124131;
      --good-bg: #e4f6e8;
      --good-line: #bee1c5;
      --good-text: #18552a;
      --bad-bg: #fbe4e4;
      --bad-line: #f0c2c2;
      --bad-text: #7e2323;
      --warm-bg: #fff3db;
      --warm-line: #efd9a7;
      --warm-text: #785400;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 8% 0%, rgba(255,255,255,0.5), transparent 32%),
        linear-gradient(180deg, var(--bg2), var(--bg));
      min-height: 100vh;
    }

    .page {
      max-width: 1120px;
      margin: 0 auto;
      padding: 22px 14px 36px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      gap: 8px;
    }

    .brand {
      color: var(--ink);
      text-decoration: none;
      font-weight: 800;
      letter-spacing: 0.02em;
      font-size: 30px;
    }

    .stamp {
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 10px 26px rgba(66, 54, 25, 0.08);
    }

    .landing {
      padding: 26px;
    }

    .landing h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }

    .landing p {
      margin: 6px 0;
      color: var(--muted);
    }

    .product-shell {
      display: grid;
      grid-template-columns: 1.05fr 1fr;
      gap: 18px;
      padding: 18px;
    }

    .hero-col {
      display: grid;
      gap: 10px;
      align-content: start;
    }

    .main-image {
      width: 100%;
      aspect-ratio: 4 / 3;
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
      background: #f8f4ea;
      display: grid;
      place-items: center;
    }

    .main-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .thumb-row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
      gap: 8px;
    }

    .thumb {
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
      background: #f8f4ea;
      aspect-ratio: 1 / 1;
    }

    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .info-col {
      display: grid;
      align-content: start;
      gap: 10px;
    }

    .kicker {
      color: var(--muted);
      font-size: 13px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .title-en {
      margin: 0;
      font-size: 34px;
      line-height: 1.1;
      letter-spacing: 0.01em;
    }

    .title-az {
      margin: 0;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.35;
      font-weight: 600;
    }

    .price-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 2px;
    }

    .price-main {
      font-size: 28px;
      font-weight: 800;
      color: var(--accent-2);
    }

    .price-box {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 13px;
      color: #504b40;
      background: #fff8ea;
    }

    .status {
      display: inline-flex;
      width: fit-content;
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 700;
      margin-top: 2px;
    }

    .status.in_stock { background: var(--good-bg); border-color: var(--good-line); color: var(--good-text); }
    .status.out_of_stock { background: var(--bad-bg); border-color: var(--bad-line); color: var(--bad-text); }
    .status.preorder, .status.on_request, .status.unknown { background: var(--warm-bg); border-color: var(--warm-line); color: var(--warm-text); }

    .desc {
      margin: 2px 0 0;
      color: #3e392f;
      line-height: 1.55;
      white-space: pre-wrap;
      border-left: 3px solid #ddcfaf;
      padding-left: 10px;
    }

    .spec-grid {
      margin: 2px 0 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .spec-item {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px 10px;
      background: #fffcf4;
    }

    .spec-item dt {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .spec-item dd {
      margin: 5px 0 0;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.35;
    }

    .qr-block {
      border-top: 1px dashed var(--line);
      margin-top: 8px;
      padding-top: 12px;
    }

    .qr-title {
      margin: 0 0 8px;
      font-size: 14px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }

    .qr-wrap {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
    }

    .qr-wrap svg {
      width: 142px;
      height: 142px;
      border: 1px solid var(--line);
      background: white;
      border-radius: 8px;
      padding: 6px;
    }

    .link a {
      color: var(--accent);
      font-weight: 700;
      text-decoration: none;
      word-break: break-all;
    }

    .link a:hover { text-decoration: underline; }

    @media (max-width: 900px) {
      .product-shell { grid-template-columns: 1fr; }
      .title-en { font-size: 28px; }
      .spec-grid { grid-template-columns: 1fr; }
      .brand { font-size: 24px; }
      .stamp { font-size: 11px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <a class="brand" href="${homeHref}">HIGOLD Showroom</a>
      <div class="stamp">Generated ${escapeHtml(generatedAt)}</div>
    </header>
    ${body}
  </div>
</body>
</html>`;
}

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
    if (duplicateIndex > 1) {
      warnings.push(`Duplicate ITEM NO. \"${sourceId}\" -> generated \"${productId}\"`);
    }

    const urlBase = normalizePathId(productId);
    const urlIndex = (seenUrlIds.get(urlBase) || 0) + 1;
    seenUrlIds.set(urlBase, urlIndex);
    const urlId = urlIndex === 1 ? urlBase : `${urlBase}--${urlIndex}`;

    const active = toBoolean(row[productFields.active], true);
    if (!active) continue;

    const images = (imagesById.get(sourceId) || []).sort(compareImageRecords);
    const mainImage = images.length > 0 ? images[0].url : "";

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
      image_main: mainImage,
    });
  }

  await ensureCleanOutput(outputDir);

  const cleanBase = String(config.siteBaseUrl || "").replace(/\/+$/, "");
  await writeFile(path.join(outputDir, "data", "products.json"), JSON.stringify(products, null, 2));

  const indexHtml = renderLayout({
    title: "HIGOLD Showroom",
    homeHref: "./index.html",
    body: `<section class="card landing">
  <h1>HIGOLD Showroom</h1>
  <p>This page does not contain a public catalog.</p>
  <p>Open product cards via QR code only.</p>
</section>`,
  });

  await writeFile(path.join(outputDir, "index.html"), indexHtml);

  for (const product of products) {
    const productRelativePath = `p/${encodeURIComponent(product.url_id)}/`;
    const productUrl = `${cleanBase}/${productRelativePath}`;
    const qrSvg = await QRCode.toString(productUrl, {
      type: "svg",
      margin: 1,
      width: 256,
      errorCorrectionLevel: "M",
    });

    await writeFile(path.join(outputDir, "qr", `${encodeURIComponent(product.url_id)}.svg`), qrSvg);

    const retailPrice = product.retail_price == null ? "Price on request" : `${product.retail_price.toFixed(2)} ${product.currency}`;
    const boxPrice = product.box_price == null ? "" : `${product.box_price.toFixed(2)} ${product.currency}`;

    const detailRows = [
      ["Item No", product.item_no],
      ["Manufacturer", product.manufacturer],
      ["Features", product.features],
      ["Inner Measures", product.inner_measures],
      ["Outer Measures", product.outer_measures],
      ["Updated", product.updated_at],
    ]
      .filter(([, value]) => String(value || "").trim() !== "")
      .map(([label, value]) => `<div class="spec-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join("");

    const allImages = product.images.length > 0 ? product.images : (product.image_main ? [product.image_main] : []);
    const mainImage = product.image_main || allImages[0] || "";

    const mainImageHtml = mainImage
      ? `<div class="main-image"><img src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.name || product.product_id)}" /></div>`
      : `<div class="main-image"><div class="meta">No image</div></div>`;

    const thumbsHtml = allImages.length > 1
      ? `<div class="thumb-row">${allImages.map((img) => `<div class="thumb"><img src="${escapeHtml(img)}" alt="${escapeHtml(product.name || product.product_id)}" /></div>`).join("")}</div>`
      : "";

    const azNameHtml = product.name_az ? `<p class="title-az">${escapeHtml(product.name_az)}</p>` : "";
    const descriptionHtml = product.description ? `<p class="desc">${escapeHtml(product.description)}</p>` : "";
    const boxPriceHtml = boxPrice ? `<span class="price-box">Box Price: ${escapeHtml(boxPrice)}</span>` : "";

    const pageHtml = renderLayout({
      title: `${product.product_id} - ${product.name}`,
      homeHref: "../../index.html",
      body: `<article class="card product-shell">
  <section class="hero-col">
    ${mainImageHtml}
    ${thumbsHtml}
  </section>
  <section class="info-col">
    <div class="kicker">Product ID: ${escapeHtml(product.product_id)}</div>
    <h1 class="title-en">${escapeHtml(product.name || product.product_id)}</h1>
    ${azNameHtml}
    <div class="status ${escapeHtml(product.stock_status)}">${escapeHtml(product.stock_label || product.stock_status)}</div>
    <div class="price-row">
      <div class="price-main">${escapeHtml(retailPrice)}</div>
      ${boxPriceHtml}
    </div>
    ${descriptionHtml}
    <dl class="spec-grid">${detailRows}</dl>
    <div class="qr-block">
      <p class="qr-title">Product QR Link</p>
      <div class="qr-wrap">
        ${qrSvg}
        <p class="link"><a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener">${escapeHtml(productUrl)}</a></p>
      </div>
    </div>
  </section>
</article>`,
    });

    await writeFile(path.join(outputDir, "p", product.url_id, "index.html"), pageHtml);
  }

  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }
  console.log(`Built ${products.length} products in ${outputDir}`);
}

build().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
