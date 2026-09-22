/* ==========================================================================
   STK Pet Shop — Telegram Backend
   --------------------------------------------------------------------------
   TWO jobs:
   1) POST /notify-order   — sends a new-order message to configured chats
   2) POST /telegram-webhook — replies to customers who message the bot
      (currently handles /start with a themed welcome photo + buttons)

   Environment variables (set these in Render, never in code):
     TELEGRAM_BOT_TOKEN        -> the token BotFather gave you
     TELEGRAM_CHAT_IDS         -> comma-separated admin chat IDs for orders
     TELEGRAM_WELCOME_IMAGE_URL -> a hosted image URL for the /start photo
     TELEGRAM_SUPPORT_URL      -> link for the "Support" button
     TELEGRAM_DEVELOPER_URL    -> link for the "Developer" button
     TELEGRAM_WEBSITE_URL      -> your live site URL, for the website button
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

const WELCOME_IMAGE_URL = 'https://raw.githubusercontent.com/Richardloves-dev/Kalai-telegram-bot/main/stk-welcome.jpg';
const SUPPORT_URL = 'https://t.me/Namma_power_andha_ragam_ucg';
const DEVELOPER_URL = 'https://t.me/Riohari_Loves_Log';
const WEBSITE_URL = 'https://stkpetshop@gmail.vercel.app';

if (!BOT_TOKEN || CHAT_IDS.length === 0) {
  console.warn('[startup] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_IDS is missing. Set them in Render → Environment.');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ==========================================================================
   1) NEW ORDER NOTIFICATION
   ========================================================================== */

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
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`Telegram API error for chat ${chatId}: ${data.description || res.status}`);
  }
  return data;
}

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
  const results = await Promise.allSettled(allChatIds.map(chatId => sendTelegramMessage(chatId, message)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[notify-order] Failed to notify chat ${allChatIds[i]}:`, r.reason?.message || r.reason);
    }
  });

  const anySucceeded = results.some(r => r.status === 'fulfilled');
  res.status(200).json({ ok: anySucceeded });
});

/* ==========================================================================
   2) TELEGRAM WEBHOOK — replies to customers who message the bot
   ========================================================================== */

function buildWelcomeCaption(firstName, lastName) {
  const name = [firstName, lastName].filter(Boolean).join(' ');
  return [
    `ʜᴇʏ ${escapeHtml(name)}`,
    `๏ ᴛʜɪs ɪs ˹Sᴛᴋ ✘ 𑊦ᴜᴘᴘᴏʀᴛ˼ 🎀!`,
    ``,
    `➻ ᴀ ғᴀsᴛ sᴜᴘᴘᴏʀᴛ ʙᴏᴛ ғᴏʀ sʜᴏᴘ ʙᴜsɪɴᴇss ᴜsᴇ.`
  ].join('\n');
}

const WELCOME_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '✨ Support ✨', url: SUPPORT_URL },
      { text: '🥀 Developer 🥀', url: DEVELOPER_URL }
    ],
    [
      { text: '🛒 STK Pet shop (website)', url: WEBSITE_URL }
    ]
  ]
};

async function sendWelcomePhoto(chatId, firstName, lastName) {
  const caption = buildWelcomeCaption(firstName, lastName);
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: WELCOME_IMAGE_URL,
      caption,
      reply_markup: WELCOME_KEYBOARD
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    console.error('[webhook] sendPhoto failed:', data.description || res.status);
  }
}

app.post('/telegram-webhook', async (req, res) => {
  // Acknowledge Telegram immediately — Telegram retries if we're slow/silent.
  res.sendStatus(200);

  try {
    const update = req.body;
    const msg = update?.message;
    if (!msg || !msg.text) return;

    if (msg.text.startsWith('/start')) {
      const chatId = msg.chat.id;
      const firstName = msg.from?.first_name || '';
      const lastName = msg.from?.last_name || '';
      await sendWelcomePhoto(chatId, firstName, lastName);
    }
  } catch (err) {
    console.error('[telegram-webhook] error:', err.message || err);
  }
});

app.get('/', (req, res) => {
  res.send('STK Pet Shop Telegram backend is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`STK Pet Shop Telegram backend listening on port ${PORT}`);
});
