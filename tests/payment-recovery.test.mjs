import test from 'node:test';
import assert from 'node:assert/strict';
import {
  persistPaymentSlip,
  shouldNotifyAdminAfterOrder,
} from '../supabase/functions/liff-api/payment-recovery.mjs';

const paymentUpdate = {
  slip_path: 'customer/order/slip.jpg',
  status: 'submitted',
};

function paymentBuilder(result) {
  return {
    update: patch => ({
      eq: (column, value) => ({
        select: projection => ({
          single: async () => {
            assert.equal(column, 'order_id');
            assert.equal(value, 'order-1');
            assert.equal(projection, 'id,status,slip_path');
            assert.deepEqual(patch, paymentUpdate);
            return result;
          },
        }),
      }),
    }),
  };
}

test('payment slip persists before success and keeps the stored path', async () => {
  const calls = [];
  const storage = {
    upload: async (...args) => {
      calls.push(['upload', ...args]);
      return { error: null };
    },
    remove: async (...args) => {
      calls.push(['remove', ...args]);
      return { error: null };
    },
  };

  const payment = await persistPaymentSlip({
    storage,
    payments: paymentBuilder({ data: { id: 'payment-1', status: 'submitted', slip_path: paymentUpdate.slip_path }, error: null }),
    orderId: 'order-1',
    path: paymentUpdate.slip_path,
    file: 'test-file',
    contentType: 'image/jpeg',
    paymentUpdate,
  });

  assert.equal(payment.id, 'payment-1');
  assert.deepEqual(calls, [
    ['upload', paymentUpdate.slip_path, 'test-file', { contentType: 'image/jpeg', upsert: false }],
  ]);
});

test('payment update failure removes the newly uploaded slip before surfacing the failure', async () => {
  const calls = [];
  const updateFailure = new Error('forced payment update failure');
  const storage = {
    upload: async (...args) => {
      calls.push(['upload', ...args]);
      return { error: null };
    },
    remove: async (...args) => {
      calls.push(['remove', ...args]);
      return { error: null };
    },
  };

  await assert.rejects(
    persistPaymentSlip({
      storage,
      payments: paymentBuilder({ data: null, error: updateFailure }),
      orderId: 'order-1',
      path: paymentUpdate.slip_path,
      file: 'test-file',
      contentType: 'image/jpeg',
      paymentUpdate,
    }),
    updateFailure,
  );

  assert.deepEqual(calls.at(-1), ['remove', [paymentUpdate.slip_path]]);
});

test('notification timing preserves cash immediacy and waits for transfer slip persistence', () => {
  assert.equal(shouldNotifyAdminAfterOrder('cash'), true);
  assert.equal(shouldNotifyAdminAfterOrder('pay_at_store'), true);
  assert.equal(shouldNotifyAdminAfterOrder('bank_transfer'), false);
  assert.equal(shouldNotifyAdminAfterOrder('promptpay'), false);
});
