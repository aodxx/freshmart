export const normalizeBarcode = value => String(value || '').replace(/\D/g, '');

export function hasValidGtinCheckDigit(value) {
  const barcode = normalizeBarcode(value);
  if (![8, 12, 13, 14].includes(barcode.length)) return false;
  const digits = [...barcode].map(Number);
  const checkDigit = digits.pop();
  const sum = digits.reverse().reduce(
    (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
    0
  );
  return (10 - (sum % 10)) % 10 === checkDigit;
}
