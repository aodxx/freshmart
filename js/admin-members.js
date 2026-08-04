import { escapeHtml, money, requireAdmin, supabase, toast } from './supabaseClient.js';

const statusLabels = {
  pending: 'รอดำเนินการ',
  awaiting_payment: 'รอชำระ',
  paid: 'ชำระแล้ว',
  preparing: 'กำลังจัดสินค้า',
  shipped: 'จัดส่งแล้ว',
  completed: 'สำเร็จ',
  cancelled: 'ยกเลิก'
};

const paymentMethodLabels = {
  cash: 'เงินสด',
  bank_transfer: 'โอนธนาคาร',
  promptpay: 'PromptPay',
  other: 'ช่องทางอื่น'
};

const state = {
  customers: [],
  query: '',
  segment: 'all',
  labelFilter: 'all',
  sort: 'recent',
  selectedId: null
};

const elements = {
  list: document.querySelector('[data-customer-list]'),
  resultCount: document.querySelector('[data-customer-result-count]'),
  search: document.querySelector('[data-customer-search]'),
  segment: document.querySelector('[data-customer-segment]'),
  labelFilter: document.querySelector('[data-customer-label-filter]'),
  sort: document.querySelector('[data-customer-sort]'),
  refresh: document.querySelector('[data-refresh-customers]'),
  detail: document.querySelector('[data-customer-detail]'),
  detailTitle: document.querySelector('#customerDetailTitle'),
  statusButton: document.querySelector('[data-toggle-customer-status]'),
  total: document.querySelector('[data-kpi-total]'),
  newCustomers: document.querySelector('[data-kpi-new]'),
  repeat: document.querySelector('[data-kpi-repeat]'),
  revenue: document.querySelector('[data-kpi-revenue]'),
  outstanding: document.querySelector('[data-kpi-outstanding]')
};

const detailModal = new bootstrap.Modal(document.querySelector('#customerDetailModal'));
const toTime = value => value ? new Date(value).getTime() || 0 : 0;

const thaiDate = (value, includeTime = false) => {
  if (!value) return '—';
  const options = includeTime
    ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }
    : { dateStyle: 'medium', timeZone: 'Asia/Bangkok' };
  return new Intl.DateTimeFormat('th-TH', options).format(new Date(value));
};

const safePictureUrl = value => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

const mapsUrl = (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
};

const avatarMarkup = customer => {
  const picture = safePictureUrl(customer.picture_url);
  const initial = Array.from(customer.display_name?.trim() || 'ล')[0];
  return `
    <div class="customer-avatar">
      ${picture
        ? `<img src="${escapeHtml(picture)}" alt="" loading="lazy" data-avatar-image>`
        : `<span class="customer-avatar__fallback">${escapeHtml(initial)}</span>`}
      <span class="customer-avatar__line" title="บัญชี LINE">LINE</span>
    </div>`;
};

const phoneMarkup = customer => {
  const phone = String(customer.phone || '').trim();
  if (!phone) return '<span>ยังไม่มีเบอร์โทร</span>';
  const dialable = phone.replace(/[^\d+]/g, '');
  return `<a href="tel:${escapeHtml(dialable)}">☎ ${escapeHtml(phone)}</a>`;
};

const bangkokMonthKey = value => {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date(value));
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  return `${year}-${month}`;
};

const isSameMonth = value => bangkokMonthKey(value) === bangkokMonthKey(Date.now());
const activeOrders = customer => customer.orders.filter(order => order.status !== 'cancelled');

const enrichCustomers = (
  customers,
  addresses,
  orders,
  receivables,
  receivablePayments,
  contexts,
  contextAudits,
  profiles
) => {
  const profileNames = new Map(profiles.map(profile => [profile.id, profile.full_name]));
  const contextByCustomer = new Map(contexts.map(context => [context.customer_id, context]));
  const auditsByCustomer = contextAudits.reduce((groups, audit) => {
    const rows = groups.get(audit.customer_id) || [];
    rows.push({ ...audit, changedByName: profileNames.get(audit.changed_by) || 'ผู้ดูแลระบบ' });
    groups.set(audit.customer_id, rows);
    return groups;
  }, new Map());

  return customers.map(customer => {
    const customerOrders = orders
      .filter(order => order.customer_id === customer.id)
      .sort((a, b) => toTime(b.created_at) - toTime(a.created_at));
    const validOrders = customerOrders.filter(order => order.status !== 'cancelled');
    const customerReceivables = receivables
      .filter(receivable => receivable.customer_id === customer.id)
      .map(receivable => ({
        ...receivable,
        payments: receivablePayments
          .filter(payment => payment.receivable_id === receivable.id)
          .sort((a, b) => toTime(b.paid_at) - toTime(a.paid_at))
      }))
      .sort((a, b) => toTime(b.created_at) - toTime(a.created_at));

    const orderRows = customerOrders.map(order => ({
      ...order,
      receivable: customerReceivables.find(receivable => receivable.order_id === order.id) || null
    }));

    const context = contextByCustomer.get(customer.id) || {
      customer_id: customer.id,
      labels: [],
      internal_note: null,
      updated_by: null,
      updated_at: null
    };

    return {
      ...customer,
      addresses: addresses.filter(address => address.customer_id === customer.id),
      orders: orderRows,
      receivables: customerReceivables,
      orderCount: validOrders.length,
      totalSpent: validOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
      outstandingTotal: customerReceivables.reduce(
        (sum, receivable) => sum + Number(receivable.balance_amount || 0),
        0
      ),
      lastOrderAt: validOrders[0]?.created_at || null,
      context: {
        ...context,
        labels: Array.isArray(context.labels) ? context.labels : [],
        updatedByName: profileNames.get(context.updated_by) || 'ผู้ดูแลระบบ'
      },
      contextHistory: auditsByCustomer.get(customer.id) || []
    };
  });
};

const labelMarkup = (labels, limit = 3) => {
  const visible = labels.slice(0, limit);
  if (!visible.length) return '';
  return `<div class="customer-labels">${visible.map(label =>
    `<span class="customer-label">${escapeHtml(label)}</span>`
  ).join('')}${labels.length > limit
    ? `<span class="customer-label customer-label--more">+${labels.length - limit}</span>`
    : ''}</div>`;
};

const renderLabelFilterOptions = () => {
  const selected = state.labelFilter;
  const labels = [...new Set(state.customers.flatMap(customer => customer.context.labels))]
    .sort((a, b) => a.localeCompare(b, 'th'));
  elements.labelFilter.innerHTML = `
    <option value="all">ทุกป้ายกำกับ</option>
    <option value="none">ยังไม่มีป้ายกำกับ</option>
    ${labels.map(label => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join('')}`;
  elements.labelFilter.value = labels.includes(selected) || selected === 'none' ? selected : 'all';
  state.labelFilter = elements.labelFilter.value;
};

const updateKpis = () => {
  elements.total.textContent = state.customers.length.toLocaleString('th-TH');
  elements.newCustomers.textContent = state.customers
    .filter(customer => isSameMonth(customer.first_seen_at)).length.toLocaleString('th-TH');
  elements.repeat.textContent = state.customers
    .filter(customer => customer.orderCount >= 2).length.toLocaleString('th-TH');
  elements.revenue.textContent = money(state.customers
    .reduce((sum, customer) => sum + customer.totalSpent, 0));
  elements.outstanding.textContent = money(state.customers
    .reduce((sum, customer) => sum + customer.outstandingTotal, 0));
};

const filteredCustomers = () => {
  const normalizedQuery = state.query.trim().toLocaleLowerCase('th-TH');
  const rows = state.customers.filter(customer => {
    const matchesSearch = !normalizedQuery || [
      customer.display_name,
      customer.phone,
      customer.context.internal_note,
      ...customer.context.labels
    ].some(value => String(value || '').toLocaleLowerCase('th-TH').includes(normalizedQuery));

    const matchesSegment = {
      all: true,
      no_orders: customer.orderCount === 0 && customer.status !== 'blocked',
      first_order: customer.orderCount === 1 && customer.status !== 'blocked',
      repeat: customer.orderCount >= 2 && customer.status !== 'blocked',
      outstanding: customer.outstandingTotal > 0,
      blocked: customer.status === 'blocked'
    }[state.segment];
    const matchesLabel = state.labelFilter === 'all' ||
      (state.labelFilter === 'none' && !customer.context.labels.length) ||
      customer.context.labels.includes(state.labelFilter);
    return matchesSearch && matchesSegment && matchesLabel;
  });

  return rows.sort((a, b) => {
    if (state.sort === 'spent') return b.totalSpent - a.totalSpent;
    if (state.sort === 'orders') return b.orderCount - a.orderCount;
    if (state.sort === 'outstanding') return b.outstandingTotal - a.outstandingTotal;
    if (state.sort === 'last_order') return toTime(b.lastOrderAt) - toTime(a.lastOrderAt);
    if (state.sort === 'name') return a.display_name.localeCompare(b.display_name, 'th');
    return toTime(b.last_seen_at) - toTime(a.last_seen_at);
  });
};

const renderEmpty = () => {
  elements.list.innerHTML = `
    <div class="customer-empty">
      <span class="empty-state__icon" aria-hidden="true">⌕</span>
      <strong>ไม่พบลูกค้าที่ตรงกับเงื่อนไข</strong>
      <span>ลองเปลี่ยนคำค้นหาหรือเลือกกลุ่มลูกค้าอื่น</span>
    </div>`;
};

const renderCustomers = () => {
  const rows = filteredCustomers();
  elements.resultCount.textContent = `พบ ${rows.length.toLocaleString('th-TH')} จาก ${state.customers.length.toLocaleString('th-TH')} คน`;
  if (!rows.length) return renderEmpty();

  elements.list.innerHTML = `<div class="customer-grid">${rows.map(customer => `
    <article class="customer-card">
      ${avatarMarkup(customer)}
      <div class="customer-card__main">
        <div class="customer-card__title">
          <h3>${escapeHtml(customer.display_name)}</h3>
          <span class="customer-status ${customer.status === 'blocked' ? 'customer-status--blocked' : ''}">
            ${customer.status === 'blocked' ? 'ระงับ' : 'ใช้งาน'}
          </span>
          ${customer.outstandingTotal > 0 ? '<span class="customer-debt-badge">มีค้างชำระ</span>' : ''}
        </div>
        <span class="customer-card__contact">${phoneMarkup(customer)}</span>
        <span class="customer-card__activity">ใช้งานล่าสุด ${thaiDate(customer.last_seen_at, true)}</span>
        ${labelMarkup(customer.context.labels)}
        <div class="customer-card__metrics">
          <div class="customer-card__metric"><small>ออเดอร์</small><strong>${customer.orderCount.toLocaleString('th-TH')} ครั้ง</strong></div>
          <div class="customer-card__metric"><small>ยอดซื้อรวม</small><strong>${money(customer.totalSpent)}</strong></div>
          <div class="customer-card__metric ${customer.outstandingTotal > 0 ? 'customer-card__metric--debt' : ''}"><small>ค้างชำระ</small><strong>${money(customer.outstandingTotal)}</strong></div>
          <div class="customer-card__metric"><small>สั่งล่าสุด</small><strong>${customer.lastOrderAt ? thaiDate(customer.lastOrderAt) : 'ยังไม่มี'}</strong></div>
        </div>
      </div>
      <div class="customer-card__action">
        <button class="btn btn-outline-primary btn-sm" type="button" data-customer-detail-id="${escapeHtml(customer.id)}">ดูข้อมูล</button>
      </div>
    </article>`).join('')}</div>`;

  elements.list.querySelectorAll('[data-customer-detail-id]').forEach(button => {
    button.addEventListener('click', () => openCustomerDetail(button.dataset.customerDetailId));
  });
  elements.list.querySelectorAll('[data-avatar-image]').forEach(image => {
    image.addEventListener('error', () => {
      image.replaceWith(Object.assign(document.createElement('span'), {
        className: 'customer-avatar__fallback',
        textContent: 'ล'
      }));
    }, { once: true });
  });
};

const navigationButton = (latitude, longitude) => {
  const url = mapsUrl(latitude, longitude);
  return url
    ? `<a class="btn btn-sm btn-outline-primary" href="${escapeHtml(url)}" target="_blank" rel="noopener">นำทางด้วย Google Maps ↗</a>`
    : '<span class="customer-location-missing">ยังไม่มีพิกัด GPS</span>';
};

const addressMarkup = customer => {
  if (customer.addresses.length) {
    return customer.addresses.map(address => `
      <div class="customer-address">
        <small>${escapeHtml(address.label)}${address.is_default ? ' · ที่อยู่หลัก' : ''}</small>
        <strong>${escapeHtml(address.recipient_name)} · ${escapeHtml(address.phone)}</strong>
        <p>${escapeHtml(address.address)}</p>
        <div class="customer-address__actions">${navigationButton(address.latitude, address.longitude)}</div>
      </div>`).join('');
  }

  const latestDelivery = customer.orders.find(order =>
    order.fulfillment_method === 'delivery' && order.shipping_address
  );
  if (latestDelivery) {
    return `
      <div class="customer-address">
        <small>ที่อยู่จากคำสั่งซื้อล่าสุด</small>
        <strong>${escapeHtml(latestDelivery.recipient_name)} · ${escapeHtml(latestDelivery.recipient_phone)}</strong>
        <p>${escapeHtml(latestDelivery.shipping_address)}</p>
        <div class="customer-address__actions">${navigationButton(latestDelivery.delivery_latitude, latestDelivery.delivery_longitude)}</div>
      </div>`;
  }
  return '<div class="customer-address"><small>ที่อยู่จัดส่ง</small><span class="text-secondary">ยังไม่มีข้อมูล</span></div>';
};

const receivablesMarkup = customer => {
  if (!customer.receivables.length) {
    return '<div class="customer-address"><span class="text-secondary">ไม่มีรายการค้างชำระที่บันทึกไว้</span></div>';
  }
  return customer.receivables.map(receivable => {
    const order = customer.orders.find(row => row.id === receivable.order_id);
    const outstanding = Number(receivable.balance_amount) > 0;
    return `
      <article class="customer-receivable ${outstanding ? 'is-outstanding' : 'is-paid'}">
        <div class="customer-receivable__head">
          <div>
            <small>${escapeHtml(order?.order_number || 'ไม่พบเลขออเดอร์')} · ${thaiDate(receivable.created_at, true)}</small>
            <strong>${outstanding ? `เหลือ ${money(receivable.balance_amount)}` : 'ชำระครบแล้ว'}</strong>
          </div>
          <span>${money(receivable.paid_amount)} / ${money(receivable.original_amount)}</span>
        </div>
        ${receivable.due_at ? `<p>กำหนดชำระ ${thaiDate(receivable.due_at, true)}</p>` : ''}
        ${receivable.note ? `<p>${escapeHtml(receivable.note)}</p>` : ''}
        ${receivable.payments.length ? `
          <div class="customer-receivable__history">
            ${receivable.payments.map(payment => `
              <div>
                <span>${thaiDate(payment.paid_at, true)} · ${escapeHtml(paymentMethodLabels[payment.method] || payment.method)}</span>
                <strong>${money(payment.amount)}</strong>
              </div>`).join('')}
          </div>` : ''}
        ${outstanding ? `
          <button class="btn btn-success btn-sm" type="button" data-record-receivable-payment="${escapeHtml(receivable.id)}">
            + บันทึกรับชำระ
          </button>` : ''}
      </article>`;
  }).join('');
};

const ordersMarkup = customer => {
  if (!customer.orders.length) {
    return '<div class="customer-address"><span class="text-secondary">ลูกค้ายังไม่เคยสั่งซื้อ</span></div>';
  }
  return customer.orders.slice(0, 10).map(order => {
    const paymentConfirmed = (order.payments || []).some(payment => payment.status === 'confirmed');
    return `
      <div class="customer-order">
        <div>
          <span class="customer-order__number">${escapeHtml(order.order_number)}</span>
          <span class="customer-order__meta">${thaiDate(order.created_at, true)} · ${order.fulfillment_method === 'pickup' ? 'รับที่ร้าน' : 'จัดส่ง'}</span>
          ${order.receivable ? `
            <span class="customer-order__debt ${Number(order.receivable.balance_amount) > 0 ? '' : 'is-paid'}">
              ${Number(order.receivable.balance_amount) > 0 ? `ค้าง ${money(order.receivable.balance_amount)}` : 'ชำระหนี้ครบแล้ว'}
            </span>` : ''}
        </div>
        <div class="customer-order__right">
          <strong>${money(order.total_amount)}</strong>
          <span class="customer-order__status ${order.status === 'cancelled' ? 'customer-order__status--cancelled' : ''}">
            ${escapeHtml(statusLabels[order.status] || order.status)}
          </span>
          ${!order.receivable && !paymentConfirmed && order.status !== 'cancelled' ? `
            <button class="btn btn-outline-danger btn-sm mt-2" type="button" data-create-receivable="${escapeHtml(order.id)}">
              บันทึกค้างชำระ
            </button>` : ''}
        </div>
      </div>`;
  }).join('');
};

const contextHistoryMarkup = customer => {
  if (!customer.contextHistory.length) {
    return '<div class="customer-context-empty">ยังไม่มีประวัติการแก้ไข</div>';
  }
  return customer.contextHistory.slice(0, 10).map(entry => {
    const labelsChanged = JSON.stringify(entry.old_labels || []) !== JSON.stringify(entry.new_labels || []);
    const noteChanged = entry.old_note !== entry.new_note;
    return `
      <article class="customer-context-history__item">
        <div>
          <strong>${entry.action === 'created' ? 'สร้างข้อมูลภายใน' : 'อัปเดตข้อมูลภายใน'}</strong>
          <span>${escapeHtml(entry.changedByName)} · ${thaiDate(entry.changed_at, true)}</span>
        </div>
        <ul>
          ${labelsChanged ? `<li>ป้ายกำกับ: ${(entry.new_labels || []).length
            ? escapeHtml(entry.new_labels.join(', '))
            : 'ล้างป้ายกำกับทั้งหมด'}</li>` : ''}
          ${noteChanged ? `<li>หมายเหตุ: ${entry.new_note
            ? escapeHtml(entry.new_note)
            : 'ล้างหมายเหตุ'}</li>` : ''}
        </ul>
      </article>`;
  }).join('');
};

const customerContextMarkup = customer => {
  const updated = customer.context.updated_at
    ? `แก้ไขล่าสุดโดย ${escapeHtml(customer.context.updatedByName)} · ${thaiDate(customer.context.updated_at, true)}`
    : 'ยังไม่มีข้อมูลภายในสำหรับลูกค้ารายนี้';
  return `
    <section class="customer-detail-section customer-context-panel">
      <div class="customer-context-panel__head">
        <div>
          <h3>หมายเหตุและป้ายกำกับ</h3>
          <p>ข้อมูลภายในสำหรับผู้ดูแล ลูกค้าจะไม่เห็นส่วนนี้</p>
        </div>
        <span class="customer-context-private">Admin only</span>
      </div>
      <label class="form-label" for="customer-context-labels">ป้ายกำกับ</label>
      <input class="form-control" id="customer-context-labels" maxlength="320"
        value="${escapeHtml(customer.context.labels.join(', '))}"
        placeholder="เช่น ลูกค้าประจำ, VIP, ร้านอาหาร">
      <small class="customer-context-help">คั่นแต่ละป้ายด้วยเครื่องหมายจุลภาค สูงสุด 10 ป้าย ป้ายละไม่เกิน 30 ตัวอักษร</small>
      <div class="customer-context-preview">${labelMarkup(customer.context.labels, 10) || '<span>ยังไม่มีป้ายกำกับ</span>'}</div>
      <label class="form-label mt-3" for="customer-context-note">หมายเหตุภายใน</label>
      <textarea class="form-control" id="customer-context-note" rows="4" maxlength="2000"
        placeholder="เช่น ความต้องการประจำ วันที่ควรติดต่อ หรือรายละเอียดที่ช่วยให้บริการได้ดีขึ้น">${escapeHtml(customer.context.internal_note || '')}</textarea>
      <div class="customer-context-actions">
        <small>${updated}</small>
        <button class="btn btn-primary" type="button" data-save-customer-context>บันทึกข้อมูลภายใน</button>
      </div>
      <details class="customer-context-history">
        <summary>ประวัติการเปลี่ยนแปลง (${customer.contextHistory.length.toLocaleString('th-TH')})</summary>
        <div class="customer-context-history__list">${contextHistoryMarkup(customer)}</div>
      </details>
    </section>`;
};

function bindDetailActions() {
  elements.detail.querySelectorAll('[data-create-receivable]').forEach(button => {
    button.addEventListener('click', () => createReceivable(button.dataset.createReceivable));
  });
  elements.detail.querySelectorAll('[data-record-receivable-payment]').forEach(button => {
    button.addEventListener('click', () =>
      recordReceivablePayment(button.dataset.recordReceivablePayment)
    );
  });
  elements.detail.querySelector('[data-save-customer-context]')
    ?.addEventListener('click', saveCustomerContext);
}

function openCustomerDetail(customerId) {
  const customer = state.customers.find(row => row.id === customerId);
  if (!customer) return;
  state.selectedId = customerId;
  elements.detailTitle.textContent = customer.display_name;
  elements.statusButton.textContent = customer.status === 'blocked' ? 'เปิดใช้งานลูกค้า' : 'ระงับลูกค้า';
  elements.statusButton.classList.toggle('btn-outline-danger', customer.status !== 'blocked');
  elements.statusButton.classList.toggle('btn-outline-success', customer.status === 'blocked');

  const phoneVerified = customer.is_phone_verified ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน';
  const lineFriend = customer.is_friend === true
    ? 'เป็นเพื่อน LINE'
    : customer.is_friend === false ? 'ยังไม่เป็นเพื่อน LINE' : 'ไม่ทราบสถานะเพื่อน';

  elements.detail.innerHTML = `
    <div class="customer-profile">
      ${avatarMarkup(customer)}
      <div>
        <h3>${escapeHtml(customer.display_name)}</h3>
        <div class="customer-card__contact">${phoneMarkup(customer)}</div>
        <div class="customer-profile__chips">
          <span class="customer-chip">${escapeHtml(lineFriend)}</span>
          <span class="customer-chip">เบอร์โทร: ${escapeHtml(phoneVerified)}</span>
          <span class="customer-status ${customer.status === 'blocked' ? 'customer-status--blocked' : ''}">
            ${customer.status === 'blocked' ? 'ถูกระงับ' : 'ใช้งานปกติ'}
          </span>
        </div>
      </div>
    </div>
    <div class="customer-detail-metrics">
      <div class="customer-detail-metric"><small>ออเดอร์ไม่ยกเลิก</small><strong>${activeOrders(customer).length.toLocaleString('th-TH')} ครั้ง</strong></div>
      <div class="customer-detail-metric"><small>ยอดซื้อสะสม</small><strong>${money(customer.totalSpent)}</strong></div>
      <div class="customer-detail-metric ${customer.outstandingTotal > 0 ? 'customer-detail-metric--debt' : ''}"><small>ยอดค้างชำระ</small><strong>${money(customer.outstandingTotal)}</strong></div>
      <div class="customer-detail-metric"><small>ที่อยู่ที่บันทึก</small><strong>${customer.addresses.length.toLocaleString('th-TH')} แห่ง</strong></div>
    </div>
    ${customerContextMarkup(customer)}
    <section class="customer-detail-section">
      <h3>ข้อมูลการใช้งาน</h3>
      <div class="customer-info-list">
        <div class="customer-info-item"><small>เข้าร้านครั้งแรก</small><strong>${thaiDate(customer.first_seen_at, true)}</strong></div>
        <div class="customer-info-item"><small>ใช้งานล่าสุด</small><strong>${thaiDate(customer.last_seen_at, true)}</strong></div>
        <div class="customer-info-item"><small>สั่งซื้อล่าสุด</small><strong>${customer.lastOrderAt ? thaiDate(customer.lastOrderAt, true) : 'ยังไม่มี'}</strong></div>
        <div class="customer-info-item"><small>ช่องทางสมาชิก</small><strong>LINE LIFF</strong></div>
      </div>
    </section>
    <section class="customer-detail-section">
      <h3>ที่อยู่จัดส่งและพิกัดนำทาง</h3>
      ${addressMarkup(customer)}
    </section>
    <section class="customer-detail-section">
      <h3>บัญชีค้างชำระ</h3>
      ${receivablesMarkup(customer)}
    </section>
    <section class="customer-detail-section">
      <h3>ประวัติคำสั่งซื้อ ${customer.orders.length > 10 ? '(10 รายการล่าสุด)' : ''}</h3>
      ${ordersMarkup(customer)}
    </section>`;

  bindDetailActions();
  detailModal.show();
}

async function saveCustomerContext() {
  const customer = state.customers.find(row => row.id === state.selectedId);
  if (!customer) return;
  const labelInput = elements.detail.querySelector('#customer-context-labels');
  const noteInput = elements.detail.querySelector('#customer-context-note');
  const saveButton = elements.detail.querySelector('[data-save-customer-context]');
  const labels = [...new Map(String(labelInput.value || '')
    .split(/[,\n]/)
    .map(label => label.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map(label => [label.toLocaleLowerCase('th-TH'), label])).values()];
  const note = String(noteInput.value || '').trim();

  if (labels.length > 10) return toast('warning', 'กำหนดป้ายกำกับได้สูงสุด 10 ป้าย');
  if (labels.some(label => Array.from(label).length > 30)) {
    return toast('warning', 'ป้ายกำกับแต่ละป้ายต้องไม่เกิน 30 ตัวอักษร');
  }
  if (note.length > 2000) return toast('warning', 'หมายเหตุต้องไม่เกิน 2,000 ตัวอักษร');

  saveButton.disabled = true;
  saveButton.textContent = 'กำลังบันทึก...';
  const { error } = await supabase.rpc('admin_save_customer_context', {
    p_customer_id: customer.id,
    p_labels: labels,
    p_internal_note: note || null
  });
  saveButton.disabled = false;
  saveButton.textContent = 'บันทึกข้อมูลภายใน';
  if (error) {
    const messages = {
      CUSTOMER_LABEL_TOO_LONG: 'ป้ายกำกับแต่ละป้ายต้องไม่เกิน 30 ตัวอักษร',
      CUSTOMER_LABEL_LIMIT_REACHED: 'กำหนดป้ายกำกับได้สูงสุด 10 ป้าย',
      CUSTOMER_NOTE_TOO_LONG: 'หมายเหตุต้องไม่เกิน 2,000 ตัวอักษร',
      ADMIN_REQUIRED: 'บัญชีนี้ไม่มีสิทธิ์จัดการข้อมูลภายในลูกค้า'
    };
    const key = Object.keys(messages).find(code => error.message.includes(code));
    return toast('error', key ? messages[key] : error.message);
  }

  await loadCustomers(customer.id);
  toast('success', 'บันทึกหมายเหตุและป้ายกำกับแล้ว');
}

async function createReceivable(orderId) {
  const customer = state.customers.find(row => row.id === state.selectedId);
  const order = customer?.orders.find(row => row.id === orderId);
  if (!customer || !order || order.receivable) return;

  const result = await Swal.fire({
    icon: 'warning',
    title: 'บันทึกยอดค้างชำระ',
    html: `
      <div class="text-start">
        <p class="small text-secondary">ออเดอร์ ${escapeHtml(order.order_number)} · ยอด ${money(order.total_amount)}</p>
        <label class="form-label" for="receivable-amount">ยอดที่ค้าง</label>
        <input class="form-control mb-3" id="receivable-amount" type="number" min="0.01" max="${Number(order.total_amount)}" step="0.01" value="${Number(order.total_amount).toFixed(2)}">
        <label class="form-label" for="receivable-due">กำหนดชำระ (ไม่บังคับ)</label>
        <input class="form-control mb-3" id="receivable-due" type="datetime-local">
        <label class="form-label" for="receivable-note">หมายเหตุ</label>
        <textarea class="form-control" id="receivable-note" maxlength="500" placeholder="เช่น ลูกค้าขอชำระวันศุกร์"></textarea>
      </div>`,
    showCancelButton: true,
    confirmButtonText: 'บันทึกค้างชำระ',
    cancelButtonText: 'ยกเลิก',
    preConfirm: () => {
      const amount = Number(document.querySelector('#receivable-amount').value);
      const dueAt = document.querySelector('#receivable-due').value;
      const note = document.querySelector('#receivable-note').value.trim();
      if (!Number.isFinite(amount) || amount <= 0 || amount > Number(order.total_amount)) {
        return Swal.showValidationMessage('ยอดค้างต้องมากกว่า 0 และไม่เกินยอดออเดอร์');
      }
      return { amount, dueAt, note };
    }
  });
  if (!result.isConfirmed) return;

  const { error } = await supabase.from('customer_receivables').insert({
    customer_id: customer.id,
    order_id: order.id,
    original_amount: result.value.amount,
    due_at: result.value.dueAt ? new Date(result.value.dueAt).toISOString() : null,
    note: result.value.note || null
  });
  if (error) return toast('error', error.message);
  await loadCustomers(customer.id);
  toast('success', 'บันทึกยอดค้างชำระแล้ว');
}

async function recordReceivablePayment(receivableId) {
  const customer = state.customers.find(row => row.id === state.selectedId);
  const receivable = customer?.receivables.find(row => row.id === receivableId);
  if (!customer || !receivable || Number(receivable.balance_amount) <= 0) return;

  const result = await Swal.fire({
    icon: 'question',
    title: 'บันทึกรับชำระ',
    html: `
      <div class="text-start">
        <p class="small text-secondary">ยอดคงเหลือ ${money(receivable.balance_amount)}</p>
        <label class="form-label" for="payment-amount">จำนวนเงินที่รับ</label>
        <input class="form-control mb-3" id="payment-amount" type="number" min="0.01" max="${Number(receivable.balance_amount)}" step="0.01" value="${Number(receivable.balance_amount).toFixed(2)}">
        <label class="form-label" for="payment-method">ช่องทางรับชำระ</label>
        <select class="form-select mb-3" id="payment-method">
          <option value="cash">เงินสด</option>
          <option value="bank_transfer">โอนธนาคาร</option>
          <option value="promptpay">PromptPay</option>
          <option value="other">ช่องทางอื่น</option>
        </select>
        <label class="form-label" for="payment-note">หมายเหตุ</label>
        <textarea class="form-control" id="payment-note" maxlength="500" placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"></textarea>
      </div>`,
    showCancelButton: true,
    confirmButtonText: 'ยืนยันรับชำระ',
    cancelButtonText: 'ยกเลิก',
    preConfirm: () => {
      const amount = Number(document.querySelector('#payment-amount').value);
      const method = document.querySelector('#payment-method').value;
      const note = document.querySelector('#payment-note').value.trim();
      if (!Number.isFinite(amount) || amount <= 0 || amount > Number(receivable.balance_amount)) {
        return Swal.showValidationMessage('จำนวนเงินต้องมากกว่า 0 และไม่เกินยอดคงเหลือ');
      }
      return { amount, method, note };
    }
  });
  if (!result.isConfirmed) return;

  const { error } = await supabase.from('receivable_payments').insert({
    receivable_id: receivable.id,
    amount: result.value.amount,
    method: result.value.method,
    note: result.value.note || null,
    paid_at: new Date().toISOString()
  });
  if (error) return toast('error', error.message);
  await loadCustomers(customer.id);
  toast('success', 'บันทึกรับชำระแล้ว');
}

async function toggleCustomerStatus() {
  const customer = state.customers.find(row => row.id === state.selectedId);
  if (!customer) return;
  const nextStatus = customer.status === 'blocked' ? 'active' : 'blocked';
  const actionLabel = nextStatus === 'blocked' ? 'ระงับลูกค้า' : 'เปิดใช้งานลูกค้า';
  const confirmation = await Swal.fire({
    icon: nextStatus === 'blocked' ? 'warning' : 'question',
    title: actionLabel,
    text: nextStatus === 'blocked'
      ? 'ลูกค้าจะไม่สามารถสั่งซื้อใหม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง'
      : 'ลูกค้าจะกลับมาสั่งซื้อได้ตามปกติ',
    showCancelButton: true,
    confirmButtonText: 'ยืนยัน',
    cancelButtonText: 'ยกเลิก'
  });
  if (!confirmation.isConfirmed) return;

  elements.statusButton.disabled = true;
  const { error } = await supabase.from('customers')
    .update({ status: nextStatus })
    .eq('id', customer.id);
  elements.statusButton.disabled = false;
  if (error) return toast('error', error.message);

  customer.status = nextStatus;
  renderCustomers();
  updateKpis();
  openCustomerDetail(customer.id);
  toast('success', `${actionLabel}แล้ว`);
}

async function loadCustomers(reopenId = null) {
  elements.refresh.disabled = true;
  elements.refresh.classList.add('is-loading');
  const user = await requireAdmin();
  if (!user) return;

  const [
    customerResult,
    addressResult,
    orderResult,
    receivableResult,
    paymentResult,
    contextResult,
    contextAuditResult,
    profileResult
  ] =
    await Promise.all([
      supabase.from('customers')
        .select('id,line_user_id,display_name,picture_url,phone,is_phone_verified,is_friend,status,first_seen_at,last_seen_at,created_at')
        .order('last_seen_at', { ascending: false }),
      supabase.from('customer_addresses')
        .select('id,customer_id,label,recipient_name,phone,address,latitude,longitude,is_default,created_at')
        .order('is_default', { ascending: false }),
      supabase.from('orders')
        .select('id,customer_id,customer_address_id,order_number,total_amount,status,fulfillment_method,recipient_name,recipient_phone,shipping_address,delivery_latitude,delivery_longitude,delivery_location_source,pickup_at,created_at,payments(status,amount)')
        .not('customer_id', 'is', null)
        .order('created_at', { ascending: false }),
      supabase.from('customer_receivables')
        .select('id,customer_id,order_id,original_amount,paid_amount,balance_amount,status,due_at,note,created_at,updated_at,settled_at')
        .order('created_at', { ascending: false }),
      supabase.from('receivable_payments')
        .select('id,receivable_id,amount,method,note,paid_at,created_at')
        .order('paid_at', { ascending: false }),
      supabase.from('customer_admin_context')
        .select('customer_id,labels,internal_note,updated_by,updated_at'),
      supabase.from('customer_context_audit_log')
        .select('id,customer_id,action,old_labels,new_labels,old_note,new_note,changed_by,changed_at')
        .order('changed_at', { ascending: false }),
      supabase.from('profiles')
        .select('id,full_name')
    ]);

  elements.refresh.disabled = false;
  elements.refresh.classList.remove('is-loading');
  const firstError = customerResult.error || addressResult.error || orderResult.error ||
    receivableResult.error || paymentResult.error || contextResult.error ||
    contextAuditResult.error || profileResult.error;
  if (firstError) {
    elements.list.innerHTML = `
      <div class="customer-empty">
        <span class="empty-state__icon" aria-hidden="true">!</span>
        <strong>โหลดข้อมูลลูกค้าไม่สำเร็จ</strong>
        <span>${escapeHtml(firstError.message)}</span>
      </div>`;
    return toast('error', 'โหลดข้อมูลลูกค้าไม่สำเร็จ');
  }

  state.customers = enrichCustomers(
    customerResult.data || [],
    addressResult.data || [],
    orderResult.data || [],
    receivableResult.data || [],
    paymentResult.data || [],
    contextResult.data || [],
    contextAuditResult.data || [],
    profileResult.data || []
  );
  renderLabelFilterOptions();
  updateKpis();
  renderCustomers();
  if (reopenId && state.customers.some(customer => customer.id === reopenId)) {
    openCustomerDetail(reopenId);
  }
}

elements.search.addEventListener('input', event => {
  state.query = event.target.value;
  renderCustomers();
});
elements.segment.addEventListener('change', event => {
  state.segment = event.target.value;
  renderCustomers();
});
elements.labelFilter.addEventListener('change', event => {
  state.labelFilter = event.target.value;
  renderCustomers();
});
elements.sort.addEventListener('change', event => {
  state.sort = event.target.value;
  renderCustomers();
});
elements.refresh.addEventListener('click', () => loadCustomers());
elements.statusButton.addEventListener('click', toggleCustomerStatus);

loadCustomers();
