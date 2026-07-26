import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://aodxx.github.io";
const LINE_CHANNEL_ID = "2010025658";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function verifyLineUser(accessToken: string) {
  if (!accessToken || accessToken.length < 20) throw new Error("LINE_LOGIN_REQUIRED");

  const verification = await fetch(
    `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!verification.ok) throw new Error("INVALID_LINE_TOKEN");
  const tokenInfo = await verification.json();
  if (String(tokenInfo.client_id) !== LINE_CHANNEL_ID || Number(tokenInfo.expires_in) <= 0) {
    throw new Error("INVALID_LINE_CHANNEL");
  }

  const response = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("LINE_PROFILE_UNAVAILABLE");
  const profile = await response.json();
  if (!profile.userId || !profile.displayName) throw new Error("INVALID_LINE_PROFILE");
  return profile as { userId: string; displayName: string; pictureUrl?: string };
}

async function getCustomer(accessToken: string) {
  const profile = await verifyLineUser(accessToken);
  const { data, error } = await admin.from("customers").upsert({
    line_user_id: profile.userId,
    display_name: profile.displayName,
    picture_url: profile.pictureUrl ?? null,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "line_user_id" }).select("*").single();
  if (error) throw error;
  return data;
}

async function notifyAdmin(order: any, customer: any) {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const targets = [
    Deno.env.get("LINE_ADMIN_USER_ID"),
    Deno.env.get("LINE_ADMIN_GROUP_ID"),
  ].filter(Boolean);
  if (!token || !targets.length) return;
  const text = [
    "🛒 FreshMart มีออเดอร์ใหม่",
    order.order_number,
    `ลูกค้า: ${customer.display_name}`,
    `รับสินค้า: ${order.fulfillment_method === "pickup" ? "รับหน้าร้าน" : "ร้านจัดส่ง"}`,
    `ยอด: ฿${Number(order.total_amount).toFixed(2)}`,
  ].join("\n");
  await Promise.allSettled(targets.map((to) =>
    fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
    })
  ));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== ALLOWED_ORIGIN) {
    return json({ success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  }

  try {
    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await req.formData();
      const customer = await getCustomer(String(form.get("accessToken") || ""));
      const orderId = String(form.get("orderId") || "");
      const file = form.get("slip");
      if (!(file instanceof File)) throw new Error("SLIP_REQUIRED");
      if (file.size > 5 * 1024 * 1024) throw new Error("SLIP_TOO_LARGE");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        throw new Error("INVALID_SLIP_TYPE");
      }
      const { data: order } = await admin.from("orders").select("id")
        .eq("id", orderId).eq("customer_id", customer.id).single();
      if (!order) throw new Error("ORDER_NOT_FOUND");
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${customer.id}/${orderId}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await admin.storage.from("payment-slips")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: paymentError } = await admin.from("payments").update({
        slip_path: path,
        status: "submitted",
        submitted_at: new Date().toISOString(),
      }).eq("order_id", orderId);
      if (paymentError) throw paymentError;
      return json({ success: true, slipPath: path });
    }

    const body = await req.json();
    const action = String(body.action || "bootstrap");
    const customer = await getCustomer(String(body.accessToken || ""));

    if (action === "bootstrap") {
      const [{ data: settings }, { data: addresses }] = await Promise.all([
        admin.from("store_settings").select("*").eq("id", 1).single(),
        admin.from("customer_addresses").select("*")
          .eq("customer_id", customer.id).order("is_default", { ascending: false }),
      ]);
      return json({ success: true, customer, settings, addresses: addresses || [] });
    }

    if (action === "update_phone") {
      const phone = String(body.phone || "").replace(/\D/g, "");
      if (!/^0\d{8,9}$/.test(phone)) throw new Error("INVALID_PHONE");
      const { data, error } = await admin.from("customers")
        .update({ phone, is_phone_verified: false })
        .eq("id", customer.id).select("*").single();
      if (error) throw error;
      return json({ success: true, customer: data });
    }

    if (action === "save_address") {
      const address = body.address || {};
      const recipientName = String(address.recipient_name || "").trim();
      const phone = String(address.phone || "").replace(/\D/g, "");
      const addressText = String(address.address || "").trim();
      if (!recipientName || !/^0\d{8,9}$/.test(phone) || !addressText) {
        throw new Error("INVALID_ADDRESS");
      }
      if (address.is_default) {
        await admin.from("customer_addresses").update({ is_default: false })
          .eq("customer_id", customer.id);
      }
      const row = {
        customer_id: customer.id,
        label: String(address.label || "บ้าน").slice(0, 40),
        recipient_name: recipientName,
        phone,
        address: addressText,
        latitude: address.latitude || null,
        longitude: address.longitude || null,
        is_default: Boolean(address.is_default),
      };
      const query = address.id
        ? admin.from("customer_addresses").update(row)
            .eq("id", address.id).eq("customer_id", customer.id)
        : admin.from("customer_addresses").insert(row);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return json({ success: true, address: data });
    }

    if (action === "place_order") {
      const payload = body.order || {};
      const { data: orderId, error } = await admin.rpc("place_liff_order", {
        p_customer_id: customer.id,
        p_items: payload.items,
        p_fulfillment_method: payload.fulfillment_method,
        p_payment_method: payload.payment_method || "pay_at_store",
        p_recipient_name: payload.recipient_name || customer.display_name,
        p_recipient_phone: payload.recipient_phone || customer.phone,
        p_shipping_address: payload.shipping_address || null,
        p_pickup_at: payload.pickup_at || null,
        p_customer_note: payload.customer_note || null,
        p_coupon_code: payload.coupon_code || null,
      });
      if (error) throw error;
      const { data: order } = await admin.from("orders")
        .select("id,order_number,total_amount,delivery_fee,status,payment_method,fulfillment_method")
        .eq("id", orderId).single();
      await notifyAdmin(order, customer);
      return json({ success: true, order });
    }

    if (action === "list_orders") {
      const { data, error } = await admin.from("orders")
        .select("*,order_items(*),payments(id,status,method,amount,slip_path)")
        .eq("customer_id", customer.id).order("created_at", { ascending: false });
      if (error) throw error;
      return json({ success: true, orders: data || [] });
    }

    throw new Error("UNSUPPORTED_ACTION");
  } catch (error) {
    const message = String(error?.message || error);
    const status = /LINE_|ORIGIN/.test(message) ? 401 : 400;
    return json({ success: false, error: message }, status);
  }
});
