/**
 * ЗАЯВКИ З САЙТУ -> TELEGRAM, ЗІ СТАТУСАМИ Й НОТАТКАМИ
 *
 * Файл має лежати в КОРЕНІ репозиторію, поруч з index.html.
 *
 * ─────────────────────────────────────────────────────────────
 * НАЛАШТУВАННЯ (робиться один раз)
 *
 * 1. Cloudflare Pages -> Settings -> Variables and Secrets.
 *    Три змінні, тип Secret:
 *
 *      TG_TOKEN   = токен від @BotFather
 *      TG_CHAT    = твій chat id
 *      TG_SECRET  = будь-який вигаданий пароль, напр. sekator_9f3k2m
 *                   (захищає бота від чужих запитів)
 *
 * 2. Новий деплой (щоб змінні підхопились).
 *
 * 3. Один раз відкрий у браузері, підставивши свої значення:
 *
 *    https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://<ТВІЙ-САЙТ>/tg&secret_token=<TG_SECRET>
 *
 *    Має відповісти {"ok":true,...}
 *
 * ─────────────────────────────────────────────────────────────
 * ЯК КОРИСТУВАТИСЬ
 *
 * • Кнопки під заявкою міняють статус — картка оновлюється на місці.
 * • Щоб додати нотатку (адресу, відділення, коментар) —
 *   зроби REPLY на повідомлення заявки і напиши текст.
 *   Він допишеться в картку, а твоє повідомлення зникне.
 * ─────────────────────────────────────────────────────────────
 */

const STATUSES = {
  new:       '🆕 Нова',
  confirmed: '✅ Підтверджена',
  sent:      '📦 Відправлена',
  paid:      '💰 Викуплена',
  refused:   '❌ Відмова',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/tg')       return handleTelegram(request, env, url);
    if (url.pathname === '/api/lead') return handleLead(request, env, url);

    // /v/380XXXXXXXXX -> відкриває Viber.
    // Потрібно, бо Telegram не робить клікабельними посилання viber://
    const v = url.pathname.match(/^\/v\/(\d{10,15})$/);
    if (v) return viberRedirect(v[1]);

    return env.ASSETS.fetch(request);
  },
};

/* ─────────────────── Заявка з сайту ─────────────────── */

async function handleLead(request, env, url) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  if (request.method === 'GET') {
    return json({
      alive: true,
      TG_TOKEN:  env.TG_TOKEN  ? 'заданий' : 'НЕ ЗАДАНИЙ',
      TG_CHAT:   env.TG_CHAT   ? 'заданий' : 'НЕ ЗАДАНИЙ',
      TG_SECRET: env.TG_SECRET ? 'заданий' : 'НЕ ЗАДАНИЙ (потрібен для кнопок)',
    });
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (!env.TG_TOKEN || !env.TG_CHAT) return json({ ok: false, error: 'TG_TOKEN або TG_CHAT не задані' }, 500);

  let data;
  try { data = await request.json(); }
  catch { return json({ ok: false, error: 'bad json' }, 400); }

  const name  = String(data.name  || '').trim().slice(0, 100);
  const phone = String(data.phone || '').trim().slice(0, 20);
  const utm   = String(data.utm   || '').trim().slice(0, 300);
  const tg    = String(data.tg    || '').trim().replace(/^@/, '').slice(0, 64);

  if (!/^\+380\d{9}$/.test(phone)) return json({ ok: false, error: 'bad phone' }, 400);

  const digits = phone.replace(/\D/g, '');
  const kyivTime = new Date().toLocaleString('uk-UA', {
    timeZone: 'Europe/Kiev',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  const text =
    `🔔 ЗАЯВКА\n` +
    `Статус: ${STATUSES.new}\n\n` +
    `Імʼя: ${name || '—'}\n` +
    `Телефон: ${phone}\n` +
    (tg  ? `Telegram: @${tg}\n` : '') +
    (utm ? `Джерело: ${utm}\n` : '') +
    `Час: ${kyivTime} (Київ)`;

  try {
    const r = await tgApi(env, 'sendMessage', {
      chat_id: env.TG_CHAT,
      text,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buildKeyboard(url.origin, digits, tg, 'new') },
    });
    if (!r.ok) return json({ ok: true, warn: r.description });
  } catch (err) {
    console.error('telegram failed', err);
  }

  return json({ ok: true });
}

/* ─────────────────── Клавіатура ─────────────────── */

function buildKeyboard(origin, digits, tg, status) {
  const contact = [{ text: '💬 Viber', url: `${origin}/v/${digits}` }];
  if (tg) contact.push({ text: '✈️ Telegram', url: `https://t.me/${tg}` });

  const mark = (key, label) =>
    ({ text: (status === key ? '· ' : '') + label, callback_data: 'st:' + key });

  return [
    contact,
    [mark('confirmed', '✅ Підтв.'), mark('sent', '📦 Відпр.')],
    [mark('paid', '💰 Викуп'),      mark('refused', '❌ Відмова')],
  ];
}

/* ─────────────────── Вебхук Telegram ─────────────────── */

async function handleTelegram(request, env, url) {
  const ok = () => new Response('ok');

  if (request.method !== 'POST') return ok();
  if (!env.TG_SECRET) return ok();
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TG_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let u;
  try { u = await request.json(); } catch { return ok(); }

  // ── Натиснули кнопку статусу ──
  if (u.callback_query) {
    const cq  = u.callback_query;
    const key = String(cq.data || '').replace(/^st:/, '');
    const msg = cq.message;

    if (STATUSES[key] && msg && msg.text) {
      const text = msg.text.replace(/^Статус: .*$/m, `Статус: ${STATUSES[key]}`);
      const { digits, tg } = parseCard(msg.text);

      await tgApi(env, 'editMessageText', {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buildKeyboard(url.origin, digits, tg, key) },
      });
    }

    await tgApi(env, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: STATUSES[key] || '',
    });
    return ok();
  }

  // ── Reply на картку = додати нотатку ──
  const m = u.message;
  if (m && m.text && m.reply_to_message && m.reply_to_message.text) {
    const card = m.reply_to_message;
    const note = m.text.trim().slice(0, 500);

    let text = card.text;
    if (!/📝 Нотатки:/.test(text)) text += '\n\n📝 Нотатки:';
    text += `\n• ${note}`;

    const { digits, tg, status } = parseCard(card.text);

    await tgApi(env, 'editMessageText', {
      chat_id: card.chat.id,
      message_id: card.message_id,
      text,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buildKeyboard(url.origin, digits, tg, status) },
    });

    // Прибираємо своє повідомлення, щоб чат лишався чистим
    await tgApi(env, 'deleteMessage', { chat_id: m.chat.id, message_id: m.message_id });
  }

  return ok();
}

/* ─────────────────── Розбір картки ─────────────────── */

function parseCard(text) {
  const phone = (text.match(/Телефон: \+?(\d{10,15})/) || [])[1] || '';
  const tg    = (text.match(/Telegram: @(\S+)/) || [])[1] || '';
  const stLine = (text.match(/^Статус: (.*)$/m) || [])[1] || '';
  const status = Object.keys(STATUSES).find(k => STATUSES[k] === stLine) || 'new';
  return { digits: phone, tg, status };
}

/* ─────────────────── Дрібниці ─────────────────── */

async function tgApi(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

function viberRedirect(num) {
  return new Response(
    `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Відкриваю Viber…</title>
<style>body{font-family:system-ui,sans-serif;padding:40px 20px;text-align:center;background:#F5F3EE;color:#23201B}
a{display:inline-block;margin-top:20px;background:#7360F2;color:#fff;text-decoration:none;padding:14px 26px;font-weight:700;border-radius:6px}</style>
<script>location.replace('viber://chat?number=%2B${num}');</script>
</head><body>
<p>Відкриваю Viber…</p>
<a href="viber://chat?number=%2B${num}">Відкрити вручну</a>
<p style="margin-top:24px;color:#4E4841;font-size:14px">+${num}</p>
</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
