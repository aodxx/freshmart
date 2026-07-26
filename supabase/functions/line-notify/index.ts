import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) throw new Error("Unauthorized");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");
    const { orderId, event = "new_order" } = await req.json();
    const { data: order, error } = await supabase.from("orders")
      .select("order_number,total_amount,status,user_id,recipient_name")
      .eq("id", orderId).single();
    if (error || !order) throw new Error("Order not found");
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (order.user_id !== user.id && profile?.role !== "admin") throw new Error("Forbidden");

    const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
    const targets = [
      Deno.env.get("LINE_ADMIN_USER_ID"),
      Deno.env.get("LINE_ADMIN_GROUP_ID"),
    ].filter(Boolean);
    if (!token || !targets.length) throw new Error("LINE secrets are not configured");
    const text = event === "new_order"
      ? `🛒 FreshMart มีออเดอร์ใหม่\n${order.order_number}\nลูกค้า: ${order.recipient_name}\nยอด: ฿${Number(order.total_amount).toFixed(2)}`
      : `📦 อัปเดตออเดอร์ ${order.order_number}\nสถานะ: ${order.status}`;
    const results = await Promise.all(targets.map(to => fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
    })));
    if (results.some(r => !r.ok)) throw new Error("LINE delivery failed");
    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: String(error.message || error) }), {
      status: /Unauthorized|Forbidden/.test(String(error)) ? 403 : 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
