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
    :root { --bg: #f4efe4; --surface: #fffdf8; --text: #22201c; --muted: #6a665d; --line: #e6dece; --accent: #2f7a5e; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: linear-gradient(180deg, #ece4d4 0%, var(--bg) 220px); color: var(--text); }
    .page { max-width: 1080px; margin: 0 auto; padding: 24px 16px 40px; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .brand { color: var(--text); text-decoration: none; font-weight: 700; letter-spacing: 0.02em; }
    .stamp { color: var(--muted); font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
    .card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
    .card h2, .card h1 { margin: 0 0 8px; font-size: 18px; line-height: 1.3; }
    .meta { margin: 8px 0 0; color: var(--muted); font-size: 14px; }
    .price { font-size: 18px; font-weight: 700; margin-top: 6px; }
    .status { display: inline-block; margin-top: 8px; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--line); font-size: 12px; }
    .status.in_stock { background: #e4f6e6; border-color: #bde4c2; color: #195b21; }
    .status.out_of_stock { background: #fbe5e5; border-color: #f3c2c2; color: #832323; }
    .status.preorder, .status.on_request { background: #fff5dc; border-color: #f2dfab; color: #795200; }
    .details { margin-top: 10px; display: grid; grid-template-columns: 1fr; gap: 8px; }
    .details dt { color: var(--muted); font-size: 13px; }
    .details dd { margin: 2px 0 0; }
    .image-wrap { width: 100%; aspect-ratio: 4/3; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #faf6ee; display: grid; place-items: center; }
    .image-wrap img { width: 100%; height: 100%; object-fit: contain; }
    .actions a { color: var(--accent); text-decoration: none; font-weight: 600; }
    .actions a:hover { text-decoration: underline; }
    .qr svg { width: 180px; height: 180px; }
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
  await writeFile(path.join(outputDir, "data", "products.json"), JSON.stringify(products, null, 2));  const indexHtml = renderLayout({
    title: "HIGOLD Showroom",
    homeHref: "./index.html",
    body: `<section class="card">
  <h1>HIGOLD Showroom</h1>
  <p>This landing page is intentionally minimal.</p>
  <p>Use product QR code to open a specific product card.</p>
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

    const detailRows = [
      ["Item No", product.item_no],
      ["Name AZ", product.name_az],
      ["Manufacturer", product.manufacturer],
      ["Features", product.features],
      ["Inner Measures", product.inner_measures],
      ["Outer Measures", product.outer_measures],
      ["Retail Price", product.retail_price == null ? "" : `${product.retail_price.toFixed(2)} ${product.currency}`],
      ["Box Price", product.box_price == null ? "" : `${product.box_price.toFixed(2)} ${product.currency}`],
      ["Status", product.stock_label],
      ["Updated", product.updated_at],
    ]
      .filter(([, value]) => String(value || "").trim() !== "")
      .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join("");

    const imageHtml = product.image_main
      ? `<div class="image-wrap"><img src="${escapeHtml(product.image_main)}" alt="${escapeHtml(product.name || product.product_id)}" /></div>`
      : "";
    const descriptionHtml = product.description ? `<p>${escapeHtml(product.description)}</p>` : "";

    const pageHtml = renderLayout({
      title: `${product.product_id} - ${product.name}`,
      homeHref: "../../index.html",
      body: `<article class="card">
  ${imageHtml}
  <h1>${escapeHtml(product.name || product.product_id)}</h1>
  <div class="meta">${escapeHtml(product.product_id)}</div>
  ${descriptionHtml}
  <dl class="details">${detailRows}</dl>
  <div class="qr">
    <h3>QR</h3>
    ${qrSvg}
    <p class="actions"><a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener">${escapeHtml(productUrl)}</a></p>
  </div>
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
