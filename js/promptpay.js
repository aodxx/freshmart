const field = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

export function normalizePromptPayTarget(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) {
    return { tag: '01', value: `0066${digits.slice(1)}` };
  }
  if (digits.length === 11 && digits.startsWith('66')) {
    return { tag: '01', value: `0066${digits.slice(2)}` };
  }
  if (digits.length === 13) return { tag: '02', value: digits };
  throw new Error('PROMPTPAY_TARGET_INVALID');
}

export function crc16Ccitt(value) {
  let crc = 0xffff;
  for (const char of value) {
    crc ^= char.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function createPromptPayPayload(target, amount) {
  const account = normalizePromptPayTarget(target);
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount >= 1_000_000_000) {
    throw new Error('PROMPTPAY_AMOUNT_INVALID');
  }
  const merchantInfo = field('00', 'A000000677010111') + field(account.tag, account.value);
  const body = [
    field('00', '01'),
    field('01', '12'),
    field('29', merchantInfo),
    field('53', '764'),
    field('54', numericAmount.toFixed(2)),
    field('58', 'TH')
  ].join('');
  const payload = `${body}6304`;
  return payload + crc16Ccitt(payload);
}
