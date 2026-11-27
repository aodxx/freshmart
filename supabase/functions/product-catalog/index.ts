import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGIN = "https://aodxx.github.io";
const OPEN_FOOD_FACTS_API = "https://world.openfoodfacts.org/api/v3.6/product";
const OPEN_FOOD_FACTS_SEARCH_API = "https://world.openfoodfacts.net/cgi/search.pl";
const USER_AGENT = "FreshMart/1.0 (https://github.com/aodxx/freshmart)";
const MAX_IMPORT_ROWS = 200;
const MAX_SEARCH_RESULTS = 24;

// Apify fallback chain (order = priority): Makro PRO TH -> Shopee TH -> Open Food Facts -> Lazada TH.
// All actors search the Thai marketplace; without APIFY_TOKEN the Apify steps are skipped
// and the previous Open Food Facts behaviour is kept untouched.
const APIFY_API = "https://api.apify.com/v2";
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") || "";
const APIFY_RUN_TIMEOUT_MS = Number(Deno.env.get("APIFY_RUN_TIMEOUT_MS") || 25000);
const APIFY_CHAIN_DEADLINE_MS = Number(Deno.env.get("APIFY_CHAIN_DEADLINE_MS") || 70000);
const APIFY_STEP_MIN_BUDGET_MS = 6000;
const APIFY_MAKRO_ACTOR = Deno.env.get("APIFY_MAKRO_ACTOR") ||
  "mai_amm~makro-pro-thailand-product-price-scraper";
const APIFY_SHOPEE_ACTOR = Deno.env.get("APIFY_SHOPEE_ACTOR") || "lergassy~shopee-scraper";
const APIFY_LAZADA_ACTOR = Deno.env.get("APIFY_LAZADA_ACTOR") || "lergassy~lazada-scraper";
const APIFY_MAKRO_STORE_CODE = Deno.env.get("APIFY_MAKRO_STORE_CODE") || "01";
const APIFY_LOOKUP_ITEMS = Number(Deno.env.get("APIFY_LOOKUP_ITEMS") || 15);
const APIFY_SEARCH_ITEMS = Number(Deno.env.get("APIFY_SEARCH_ITEMS") || 20);
const FALLBACK_SOURCE_ORDER = [
  "makro_pro",
  "shopee_th",
  "open_food_facts",
  "lazada_th",
] as const;
type FallbackSource = typeof FALLBACK_SOURCE_ORDER[number];

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function normalizeBarcode(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function hasValidGtinCheckDigit(barcode: string) {
  if (![8, 12, 13, 14].includes(barcode.length)) return false;
  const digits = [...barcode].map(Number);
  const checkDigit = digits.pop()!;
  const sum = digits.reverse().reduce(
    (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
    0,
  );
  return (10 - (sum % 10)) % 10 === checkDigit;
}

function requireValidBarcode(value: unknown) {
  const barcode = normalizeBarcode(value);
  if (!hasValidGtinCheckDigit(barcode)) throw new Error("INVALID_GTIN");
  return barcode;
}

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("AUTH_REQUIRED");

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new Error("INVALID_SESSION");

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();
  if (profileError || profile?.role !== "admin") throw new Error("ADMIN_REQUIRED");
  return userData.user;
}

function firstText(value: unknown) {
  if (Array.isArray(value)) return firstText(value[0]);
  return String(value ?? "").split(",")[0].trim() || null;
}

function pickText(...values: unknown[]) {
  for (const value of values) {
    const text = firstText(value);
    if (text) return text;
  }
  return null;
}

function firstNonEmpty(...values: unknown[]) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("th-TH")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

function hasThailandCountrySignal(input: Record<string, unknown>) {
  const value = [
    input.countries,
    input.countries_en,
    input.countries_th,
    input.countries_tags,
  ].flatMap((item) => Array.isArray(item) ? item : [item]).join(" ").toLocaleLowerCase("th-TH");
  return /thailand|ประเทศไทย|en:thailand/.test(value);
}

function normalizeCatalogRow(input: Record<string, unknown>) {
  const barcode = requireValidBarcode(input.barcode ?? input.code);
  const name = firstNonEmpty(input.name, input.product_name_th, input.product_name);
  if (!name) throw new Error("PRODUCT_NAME_REQUIRED");

  const lastModifiedSeconds = Number(input.last_modified_t);
  const modifiedValue = input.source_updated_at ??
    input.last_modified_datetime ??
    (Number.isFinite(lastModifiedSeconds) && lastModifiedSeconds > 0
      ? new Date(lastModifiedSeconds * 1000).toISOString()
      : null);
  const parsedModified = modifiedValue ? new Date(String(modifiedValue)) : null;
  const modified = parsedModified && !Number.isNaN(parsedModified.valueOf())
    ? parsedModified.toISOString()
    : null;

  const source = String(input.source || "open_food_facts").slice(0, 80);
  return {
    barcode,
    name: name.slice(0, 300),
    brand: firstText(input.brand ?? input.brands),
    image_url: firstText(input.image_url ?? input.image_front_url),
    category_name: firstText(input.category_name ?? input.categories),
    quantity_label: firstText(input.quantity_label ?? input.quantity),
    source,
    source_url: firstText(input.source_url) ||
      (source === "open_food_facts"
        ? `https://world.openfoodfacts.org/product/${barcode}`
        : null),
    source_updated_at: modified || null,
    raw_data: input.raw_data && typeof input.raw_data === "object"
      ? input.raw_data
      : input,
  };
}

async function lookupInStore(barcode: string) {
  const { data, error } = await admin
    .from("product_variants")
    .select(
      "id,barcode,variant_name,price,stock_qty,products(id,name,brand,description,image_path,image_url,category_id,categories(name))",
    )
    .eq("barcode", barcode)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function lookupInCatalog(barcode: string) {
  const { data, error } = await admin
    .from("open_product_catalog")
    .select("*")
    .eq("barcode", barcode)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function lookupOpenFoodFacts(barcode: string) {
  const fields = [
    "code",
    "product_name",
    "product_name_th",
    "brands",
    "image_front_url",
    "image_url",
    "categories",
    "quantity",
    "last_modified_t",
  ].join(",");
  let response: Response;
  try {
    response = await fetch(
      `${OPEN_FOOD_FACTS_API}/${barcode}.json?fields=${encodeURIComponent(fields)}`,
      { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } },
    );
  } catch (error) {
    console.warn("Open Food Facts request failed; using manual entry", error);
    return null;
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    console.warn(`Open Food Facts returned ${response.status}; using manual entry`);
    return null;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    console.warn("Open Food Facts returned invalid JSON; using manual entry", error);
    return null;
  }
  if (payload.status === "failure" || !payload.product) return null;
  if (!firstNonEmpty(payload.product.product_name_th, payload.product.product_name)) {
    console.warn("Open Food Facts product has no name; using manual entry");
    return null;
  }
  const row = normalizeCatalogRow({
    ...payload.product,
    barcode,
    raw_data: payload.product,
  });
  const { data, error } = await admin
    .from("open_product_catalog")
    .upsert(row, { onConflict: "barcode" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isoText(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function firstUrl(...values: unknown[]): string | null {
  const queue = [...values];
  while (queue.length) {
    const value = queue.shift();
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value.trim())) return value.trim();
    } else if (Array.isArray(value)) {
      queue.push(...value);
    } else if (value && typeof value === "object") {
      queue.push((value as Record<string, unknown>).url, (value as Record<string, unknown>).link);
    }
  }
  return null;
}

const GTIN_ROW_FIELDS = ["barcode", "ean", "gtin", "gtin8", "gtin12", "gtin13", "gtin14", "upc", "upc12"];

function firstGtin(row: Record<string, unknown>) {
  for (const field of GTIN_ROW_FIELDS) {
    const value = normalizeBarcode(row[field]);
    if ([8, 12, 13, 14].includes(value.length) && hasValidGtinCheckDigit(value)) return value;
  }
  return null;
}

function apifyInputFor(source: Exclude<FallbackSource, "open_food_facts">, term: string, items: number) {
  if (source === "makro_pro") {
    return {
      actor: APIFY_MAKRO_ACTOR,
      input: {
        keyword: term,
        storeCode: APIFY_MAKRO_STORE_CODE,
        language: "th",
        maxItems: items,
        includeDetails: false,
        autoCorrect: false,
      },
    };
  }
  if (source === "shopee_th") {
    return {
      actor: APIFY_SHOPEE_ACTOR,
      input: { country: "TH", searchTerms: [term], maxItems: items, includeShopAndReviews: false },
    };
  }
  return {
    actor: APIFY_LAZADA_ACTOR,
    input: { country: "TH", searchTerms: [term], maxItems: items },
  };
}

async function runApifyActor(
  actor: string,
  input: Record<string, unknown>,
  timeoutMs: number,
) {
  if (!APIFY_TOKEN) return { status: "disabled" as const, items: [] as Record<string, unknown>[] };
  if (timeoutMs < APIFY_STEP_MIN_BUDGET_MS) {
    return { status: "skipped_budget" as const, items: [] as Record<string, unknown>[] };
  }
  try {
    const response = await fetch(`${APIFY_API}/acts/${actor}/runs-sync-get-dataset-items?clean=true`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${APIFY_TOKEN}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.warn(`Apify actor ${actor} responded ${response.status}`);
      return { status: "error" as const, items: [] as Record<string, unknown>[] };
    }
    const payload = await response.json();
    const items = (Array.isArray(payload) ? payload : [])
      .filter((row) => row && typeof row === "object")
      .filter((row) => !["error", "notice"].includes(String(row.type)));
    return { status: "ok" as const, items };
  } catch (error) {
    console.warn(`Apify actor ${actor} run failed`, error);
    return { status: "timeout" as const, items: [] as Record<string, unknown>[] };
  }
}

function normalizeApifyRow(source: Exclude<FallbackSource, "open_food_facts">, row: Record<string, unknown>) {
  if (source === "makro_pro") {
    const name = firstNonEmpty(row.name, row.nameTh, row.name_th, row.title);
    if (!name) return null;
    return {
      barcode: firstGtin(row),
      name: name.slice(0, 300),
      brand: firstText(row.brand),
      image_url: firstUrl(row.imageUrl, row.image, row.pictures, row.images),
      category_name: pickText(row.categoryName, row.category),
      quantity_label: pickText(row.sourcePackLabel, row.packLabel, row.quantityLabel),
      price: finiteNumber(row.price),
      currency: String(row.currency || "THB"),
      source: "makro_pro",
      source_url: firstUrl(row.url, row.productUrl, row.link),
      source_updated_at: isoText(row.observedAt ?? row.observationTime ?? row.scrapedAt),
      raw_data: row,
    };
  }
  // Shopee and Lazada rows share the same flat marketplace-card shape.
  const name = firstNonEmpty(row.title, row.name);
  if (!name) return null;
  return {
    barcode: firstGtin(row),
    name: name.slice(0, 300),
    brand: firstText(row.brand),
    image_url: firstUrl(row.imageUrl, row.image, row.images),
    category_name: pickText(
      row.category,
      Array.isArray(row.breadcrumb) ? row.breadcrumb.at(-2) : row.breadcrumb,
      Array.isArray(row.categoryPath) ? row.categoryPath.at(-1) : row.categoryPath,
    ),
    quantity_label: pickText(row.variation, row.skuName),
    price: finiteNumber(row.price),
    currency: String(row.currency || "THB"),
    source: source,
    source_url: firstUrl(row.url, row.productUrl),
    source_updated_at: isoText(row.scrapedAt ?? row.createdAt),
    raw_data: row,
  };
}

async function persistCatalogSuggestion(row: Record<string, unknown> & { barcode: string | null }) {
  const price = row.price ?? null;
  const currency = row.currency ?? null;
  if (!row.barcode || !hasValidGtinCheckDigit(row.barcode)) return { ...row, price, currency };
  try {
    const stored = normalizeCatalogRow({ ...row, barcode: row.barcode });
    const { data, error } = await admin
      .from("open_product_catalog")
      .upsert(stored, { onConflict: "barcode" })
      .select("*")
      .maybeSingle();
    if (error) {
      console.warn("Apify catalog upsert failed; returning live row", error);
      return { ...row, price, currency };
    }
    return { ...(data ?? row), price, currency };
  } catch (error) {
    console.warn("Apify catalog row rejected by validation; returning live row", error);
    return { ...row, price, currency };
  }
}

function formatSearchResult(row: Record<string, unknown>, match: "catalog" | "open_food_facts") {
  const normalized = normalizeCatalogRow({
    ...row,
    barcode: row.barcode ?? row.code,
    raw_data: row,
  });
  return { ...normalized, match };
}

function matchesSearchQuery(row: Record<string, unknown>, query: string) {
  const searchable = [
    row.name,
    row.product_name,
    row.product_name_th,
    row.brand,
    row.brands,
    row.category_name,
    row.categories,
    row.quantity_label,
    row.quantity,
    row.code,
    row.barcode,
  ].map(normalizeSearchText).join(" ");
  return searchable.includes(normalizeSearchText(query));
}

async function searchOpenFoodFacts(query: string) {
  const fields = [
    "code",
    "product_name",
    "product_name_th",
    "brands",
    "image_front_url",
    "image_url",
    "categories",
    "quantity",
    "countries",
    "countries_en",
    "countries_tags",
    "last_modified_t",
  ].join(",");
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(MAX_SEARCH_RESULTS),
    countries_tags_en: "Thailand",
    fields,
  });
  const response = await fetch(`${OPEN_FOOD_FACTS_SEARCH_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
  });
  if (!response.ok) throw new Error("OPEN_FOOD_FACTS_SEARCH_UNAVAILABLE");
  const payload = await response.json();
  return (Array.isArray(payload.products) ? payload.products : [])
    .filter((row) => row && hasThailandCountrySignal(row))
    .filter((row) => firstNonEmpty(row.product_name_th, row.product_name))
    .filter((row) => matchesSearchQuery(row, query))
    .map((row) => {
      try {
        return formatSearchResult(row, "open_food_facts");
      } catch (rowError) {
        console.warn("Skipping Open Food Facts search row with invalid GTIN", rowError);
        return null;
      }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function suggestionKey(row: Record<string, unknown>) {
  return `${normalizeSearchText(row.name)}|${normalizeSearchText(row.brand ?? "")}`;
}

async function searchCatalog(queryValue: unknown) {
  const query = String(queryValue ?? "").trim().slice(0, 100);
  if (normalizeSearchText(query).length < 2) throw new Error("SEARCH_QUERY_TOO_SHORT");

  const localTerm = query.replace(/[,%()]/g, " ").trim();
  const { data: localRows, error } = await admin
    .from("open_product_catalog")
    .select("barcode,name,brand,image_url,category_name,quantity_label,source,source_url,source_updated_at,raw_data")
    .or(`name.ilike.%${localTerm}%,brand.ilike.%${localTerm}%,category_name.ilike.%${localTerm}%`)
    .limit(MAX_SEARCH_RESULTS);
  if (error) throw error;

  const localResults = (localRows || [])
    .filter((row) => matchesSearchQuery(row, query))
    .map((row) => ({ ...row, match: "catalog" as const }));

  const deadlineAt = Date.now() + APIFY_CHAIN_DEADLINE_MS;
  const attempts: Array<{ source: string; status: string; count: number }> = [];

  // External sources run concurrently; the merged list is kept in FALLBACK_SOURCE_ORDER.
  const externalGroups = await Promise.all(FALLBACK_SOURCE_ORDER.map(async (source) => {
    if (source === "open_food_facts") {
      try {
        const rows = await searchOpenFoodFacts(query);
        attempts.push({ source, status: "ok", count: rows.length });
        return rows as Array<Record<string, unknown>>;
      } catch (groupError) {
        attempts.push({ source, status: "error", count: 0 });
        console.warn("Open Food Facts search failed", groupError);
        return [];
      }
    }

    const spec = apifyInputFor(source, query, APIFY_SEARCH_ITEMS);
    const result = await runApifyActor(spec.actor, spec.input, deadlineAt - Date.now());
    attempts.push({ source, status: result.status, count: result.items.length });
    return result.items
      .map((row) => normalizeApifyRow(source, row))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }));

  const seenBarcodes = new Set(localResults.map((row) => row.barcode));
  const seenKeys = new Set(localResults.map(suggestionKey));
  const externalResults = externalGroups
    .flat()
    .filter((row) => {
      if (row.barcode && seenBarcodes.has(row.barcode)) return false;
      const key = suggestionKey(row);
      if (seenKeys.has(key)) return false;
      if (row.barcode) seenBarcodes.add(row.barcode);
      seenKeys.add(key);
      return true;
    })
    .map((row) => ({ ...row, match: String(row.source || "open_food_facts") }));

  const results = [...localResults, ...externalResults].slice(0, MAX_SEARCH_RESULTS);
  return { query, results, attempts };
}

async function lookup(barcodeValue: unknown) {
  const barcode = requireValidBarcode(barcodeValue);
  const storeProduct = await lookupInStore(barcode);
  if (storeProduct) {
    return { found: true, match: "store", barcode, product: storeProduct };
  }

  const catalogProduct = await lookupInCatalog(barcode);
  if (catalogProduct) {
    return { found: true, match: "catalog", barcode, product: catalogProduct };
  }

  const deadlineAt = Date.now() + APIFY_CHAIN_DEADLINE_MS;
  const attempts: Array<{ source: string; status: string; count: number }> = [];

  for (const source of FALLBACK_SOURCE_ORDER) {
    if (source === "open_food_facts") {
      const product = await lookupOpenFoodFacts(barcode);
      attempts.push({ source, status: product ? "found" : "miss", count: product ? 1 : 0 });
      if (product) return { found: true, match: source, barcode, product, attempts };
      continue;
    }

    const spec = apifyInputFor(source, barcode, APIFY_LOOKUP_ITEMS);
    const result = await runApifyActor(spec.actor, spec.input, deadlineAt - Date.now());
    const hit = result.items
      .map((row) => normalizeApifyRow(source, row))
      .find((row) => row && row.barcode === barcode);
    attempts.push({ source, status: result.status, count: result.items.length });
    if (hit) {
      const product = await persistCatalogSuggestion(hit);
      return { found: true, match: source, barcode, product, attempts };
    }
  }
  return { found: false, match: null, barcode, product: null, attempts };
}

async function importRows(rows: unknown) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_IMPORT_ROWS) {
    throw new Error("IMPORT_BATCH_MUST_HAVE_1_TO_200_ROWS");
  }

  const accepted = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  rows.forEach((input, index) => {
    try {
      if (!input || typeof input !== "object") throw new Error("INVALID_ROW");
      accepted.push(normalizeCatalogRow(input as Record<string, unknown>));
    } catch (error) {
      rejected.push({ index, reason: String(error?.message || error) });
    }
  });

  if (accepted.length) {
    const { error } = await admin
      .from("open_product_catalog")
      .upsert(accepted, { onConflict: "barcode" });
    if (error) throw error;
  }
  return { imported: accepted.length, rejected };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== ALLOWED_ORIGIN) {
    return json({ success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  }

  try {
    await requireAdmin(req);
    const body = await req.json();
    const action = String(body.action || "lookup");

    if (action === "lookup") {
      return json({ success: true, ...(await lookup(body.barcode)) });
    }
    if (action === "search") {
      return json({ success: true, ...(await searchCatalog(body.query)) });
    }
    if (action === "import") {
      return json({ success: true, ...(await importRows(body.products)) });
    }
    throw new Error("UNSUPPORTED_ACTION");
  } catch (error) {
    const message = String(error?.message || error);
    const status = /AUTH_REQUIRED|INVALID_SESSION/.test(message)
      ? 401
      : /ADMIN_REQUIRED|ORIGIN_NOT_ALLOWED/.test(message)
      ? 403
      : 400;
    return json({ success: false, error: message }, status);
  }
});
