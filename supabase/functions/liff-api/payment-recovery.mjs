export function shouldNotifyAdminAfterOrder(paymentMethod) {
  return !["bank_transfer", "promptpay"].includes(paymentMethod);
}

export async function persistPaymentSlip({
  storage,
  payments,
  orderId,
  path,
  file,
  contentType,
  paymentUpdate,
}) {
  const { error: uploadError } = await storage.upload(path, file, {
    contentType,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: payment, error: paymentError } = await payments
    .update(paymentUpdate)
    .eq("order_id", orderId)
    .select("id,status,slip_path")
    .single();

  if (paymentError || !payment) {
    const { error: cleanupError } = await storage.remove([path]);
    if (cleanupError) {
      console.error("PAYMENT_SLIP_CLEANUP_FAILED", cleanupError);
    }
    throw paymentError || new Error("PAYMENT_NOT_FOUND");
  }

  return payment;
}
