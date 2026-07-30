import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGIN = "https://aodxx.github.io";
const OPEN_FOOD_FACTS_API = "https://world.openfoodfacts.org/api/v3.6/product";
const USER_AGENT = "FreshMart/1.0 (https://github.com/aodxx/freshmart)";
const MAX_IMPORT_ROWS = 200;

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

function firstNonEmpty(...values: unknown[]) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
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

  return {
    barcode,
    name: name.slice(0, 300),
    brand: firstText(input.brand ?? input.brands),
    image_url: firstText(input.image_url ?? input.image_front_url),
    category_name: firstText(input.category_name ?? input.categories),
    quantity_label: firstText(input.quantity_label ?? input.quantity),
    source: String(input.source || "open_food_facts").slice(0, 80),
    source_url: firstText(input.source_url) ||
      `https://world.openfoodfacts.org/product/${barcode}`,
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

  const externalProduct = await lookupOpenFoodFacts(barcode);
  if (externalProduct) {
    return { found: true, match: "open_food_facts", barcode, product: externalProduct };
  }
  return { found: false, match: null, barcode, product: null };
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
