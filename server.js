/* ==========================================================================
   Kalai Pet Shop — Telegram New Order Notification Backend
   --------------------------------------------------------------------------
   ONE job only: receive a new order from the website and send a formatted
   message to every Telegram chat ID listed in TELEGRAM_CHAT_IDS.

   Environment variables (set these in Railway, never in code):
     TELEGRAM_BOT_TOKEN   -> the token BotFather gave you
     TELEGRAM_CHAT_IDS    -> comma-separated chat IDs, e.g. "-1001234567890,987654321"
                              (group chat id + your personal chat id)
   ========================================================================== */

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (!BOT_TOKEN || CHAT_IDS.length === 0) {
  console.warn('[startup] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_IDS is missing. Set them in Railway → Variables.');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatOrderMessage(order) {
  const customer = order.customer || {};
  const items = Array.isArray(order.items) ? order.items : [];

  const itemsBlock = items.map(i => {
    const qty = i.qty ?? i.quantity ?? 1;
    const price = Number(i.price || 0);
    const subtotal = price * Number(qty);
    return `🐟 <b>${escapeHtml(i.name || 'Product')}</b>\nQty: ${qty}\nPrice: ₹${price}\nSubtotal: ₹${subtotal}`;
  }).join('\n\n');

  const orderDate = order.date
    ? new Date(order.date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  return [
    `🛒 <b>NEW ORDER</b>`,
    `━━━━━━━━━━━━━━`,
    ``,
    `🆔 Order: <b>${escapeHtml(order.id)}</b>`,
    ``,
    `👤 Customer: ${escapeHtml(customer.name)}`,
    `📞 Phone: ${escapeHtml(customer.phone)}`,
    customer.whatsapp ? `💬 WhatsApp: ${escapeHtml(customer.whatsapp)}` : null,
    `📍 Address: ${escapeHtml(customer.address)}${customer.pincode ? ', ' + escapeHtml(customer.pincode) : ''}`,
    ``,
    `━━━━━━━━━━━━━━`,
    `📦 <b>ITEMS</b>`,
    ``,
    itemsBlock || '(no items listed)',
    ``,
    `━━━━━━━━━━━━━━`,
    `💰 <b>TOTAL: ₹${order.total ?? 0}</b>`,
    `💳 Payment: ${escapeHtml(order.paymentStatus || order.payment || 'Pending')}`,
    `🕒 ${orderDate}`
  ].filter(Boolean).join('\n');
}

async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`Telegram API error for chat ${chatId}: ${data.description || res.status}`);
  }
  return data;
}

app.get('/', (req, res) => {
  res.send('Kalai Pet Shop Telegram notifier is running.');
});

app.post('/notify-order', async (req, res) => {
  const { extraChatIds, ...order } = req.body || {};

  if (!order || !order.id) {
    return res.status(400).json({ ok: false, error: 'Missing order data' });
  }

  const safeExtraIds = Array.isArray(extraChatIds)
    ? extraChatIds.map(String).map(s => s.trim()).filter(Boolean)
    : [];
  const allChatIds = [...new Set([...CHAT_IDS, ...safeExtraIds])];

  if (!BOT_TOKEN || allChatIds.length === 0) {
    console.error('[notify-order] Server missing TELEGRAM_BOT_TOKEN or no chat IDs configured');
    return res.status(200).json({ ok: false, error: 'Notifications not configured' });
  }

  const message = formatOrderMessage(order);

  const results = await Promise.allSettled(
    allChatIds.map(chatId => sendTelegramMessage(chatId, message))
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[notify-order] Failed to notify chat ${CHAT_IDS[i]}:`, r.reason?.message || r.reason);
    }
  });

  const anySucceeded = results.some(r => r.status === 'fulfilled');
  res.status(200).json({ ok: anySucceeded });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kalai Pet Shop Telegram notifier listening on port ${PORT}`);
});
