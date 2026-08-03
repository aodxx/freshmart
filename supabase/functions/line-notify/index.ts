import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://aodxx.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

const statusLabels: Record<string, string> = {
  pending: "ร้านได้รับคำสั่งซื้อแล้ว",
  awaiting_payment: "กำลังรอตรวจสอบการชำระเงิน",
  paid: "ยืนยันการชำระเงินแล้ว",
  preparing: "ร้านกำลังจัดสินค้า",
  shipped: "สินค้าอยู่ระหว่างจัดส่ง",
  completed: "คำสั่งซื้อสำเร็จแล้ว",
  cancelled: "คำสั่งซื้อถูกยกเลิก",
};

async function pushMessage(token: string, to: string, text: string) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LINE_DELIVERY_FAILED:${response.status}:${details.slice(0, 160)}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== ALLOWED_ORIGIN) {
    return json({ success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  }

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) throw new Error("UNAUTHORIZED");

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, serviceKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("UNAUTHORIZED");
    const { data: profile } = await userClient.from("profiles")
      .select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") throw new Error("FORBIDDEN");

    const { orderId, event = "status_update" } = await req.json();
    if (!orderId) throw new Error("ORDER_ID_REQUIRED");
    const { data: order, error: orderError } = await adminClient.from("orders")
      .select("id,order_number,total_amount,status,customer_id,recipient_name,tracking_number,delivery_provider,payments(status,rejection_reason)")
      .eq("id", orderId).single();
    if (orderError || !order) throw new Error("ORDER_NOT_FOUND");

    const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
    if (!token) throw new Error("LINE_SECRET_NOT_CONFIGURED");

    if (event === "new_order") {
      const targets = [Deno.env.get("LINE_ADMIN_USER_ID"), Deno.env.get("LINE_ADMIN_GROUP_ID")]
        .filter((value): value is string => Boolean(value));
      if (!targets.length) throw new Error("LINE_ADMIN_TARGET_NOT_CONFIGURED");
      const text = [
        "🛒 FreshMart มีออเดอร์ใหม่",
        order.order_number,
        `ลูกค้า: ${order.recipient_name}`,
        `ยอด: ฿${Number(order.total_amount).toFixed(2)}`,
      ].join("\n");
      await Promise.all(targets.map((to) => pushMessage(token, to, text)));
      return json({ success: true, delivered: targets.length });
    }

    if (!order.customer_id) return json({ success: true, skipped: "CUSTOMER_NOT_LINKED" });
    const { data: customer } = await adminClient.from("customers")
      .select("line_user_id,display_name").eq("id", order.customer_id).single();
    if (!customer?.line_user_id) return json({ success: true, skipped: "LINE_USER_NOT_LINKED" });

    const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;
    let lines: string[];
    if (event === "payment_confirmed") {
      lines = ["✅ FreshMart ยืนยันการชำระเงินแล้ว", order.order_number, `ยอด ฿${Number(order.total_amount).toFixed(2)}`, "ร้านจะเริ่มจัดสินค้าให้คุณ"];
    } else if (event === "payment_rejected") {
      lines = ["⚠️ หลักฐานการชำระเงินยังไม่ผ่าน", order.order_number, `เหตุผล: ${payment?.rejection_reason || "กรุณาติดต่อร้าน"}`, "กรุณาส่งหลักฐานใหม่อีกครั้ง"];
    } else if (event === "delivery_updated") {
      lines = ["🚚 FreshMart อัปเดตข้อมูลจัดส่ง", order.order_number];
      if (order.delivery_provider) lines.push(`ผู้จัดส่ง: ${order.delivery_provider}`);
      if (order.tracking_number) lines.push(`เลขติดตาม: ${order.tracking_number}`);
    } else {
      lines = ["📦 อัปเดตคำสั่งซื้อ FreshMart", order.order_number, statusLabels[order.status] || `สถานะ: ${order.status}`];
    }

    await pushMessage(token, customer.line_user_id, lines.join("\n"));
    return json({ success: true, delivered: 1 });
  } catch (error) {
    const message = String(error?.message || error);
    const status = /UNAUTHORIZED|FORBIDDEN|ORIGIN/.test(message) ? 403 : 400;
    return json({ success: false, error: message }, status);
  }
});
