/**
 * ЗАЯВКИ З САЙТУ -> TELEGRAM. МІНІ-CRM У БОТІ.
 *
 * Файл має лежати в КОРЕНІ репозиторію, поруч з index.html.
 *
 * ─────────────────────────────────────────────────────────────
 * НАЛАШТУВАННЯ (один раз)
 *
 * 1. Cloudflare Pages -> Settings -> Variables and Secrets, тип Secret:
 *      TG_TOKEN   = токен від @BotFather
 *      TG_CHAT    = твій chat id
 *      TG_SECRET  = вигаданий пароль, напр. sekator_9f3k2m
 *
 * 2. Новий деплой.
 *
 * 3. Відкрий у браузері один раз:
 *    https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://<САЙТ>/tg&secret_token=<TG_SECRET>
 *
 * ─────────────────────────────────────────────────────────────
 * ЯК КОРИСТУВАТИСЬ
 *
 * Процес: 🆕 Нова -> ✅ Підтверджена -> 📦 Відправлена -> 💰 Викуплена
 * Кнопка показує тільки НАСТУПНИЙ крок, щоб не було плутанини.
 *
 * Дані клієнта — REPLY на картку. Розпізнаються префікси:
 *   місто Київ            -> Місто
 *   нп 15   /  відділення 15  -> Відділення
 *   ттн 20450012345678    -> ТТН
 *   решта тексту          -> Коментар (додається списком)
 * ─────────────────────────────────────────────────────────────
 */

const FLOW = {
  new:       { label: '🆕 НОВА',          next: [['confirmed', '✅ Підтвердити'], ['refused', '❌ Відмова']] },
  confirmed: { label: '✅ ПІДТВЕРДЖЕНА',  next: [['sent', '📦 Відправлено'],     ['refused', '❌ Відмова']] },
  sent:      { label: '📦 ВІДПРАВЛЕНА',   next: [['paid', '💰 Викуплено'],       ['returned', '🚫 Не викупив']] },
  paid:      { label: '💰 ВИКУПЛЕНА',     next: [['new', '↩️ Скинути']] },
  refused:   { label: '❌ ВІДМОВА',        next: [['new', '↩️ Скинути']] },
  returned:  { label: '🚫 НЕ ВИКУПИВ',     next: [['new', '↩️ Скинути']] },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/tg')       return handleTelegram(request, env, url);
    if (url.pathname === '/api/lead') return handleLead(request, env, url);

    const v = url.pathname.match(/^\/v\/(\d{10,15})$/);
    if (v) return viberRedirect(v[1]);

    return env.ASSETS.fetch(request);
  },
};

/* ═══════════════ КАРТКА ЗАМОВЛЕННЯ ═══════════════ */

function buildCard(d) {
  return [
    `🔔 ЗАЯВКА`,
    FLOW[d.status].label,
    ``,
    `👤 ${d.name || '—'}`,
    `📞 ${d.phone}`,
    d.tg ? `✈️ @${d.tg}` : null,
    `🕐 ${d.time}`,
    d.utm ? `🔗 ${d.utm}` : null,
    ``,
    `━━━━━━━━━━━━━━━`,
    `Місто: ${d.city || '—'}`,
    `Відділення: ${d.branch || '—'}`,
    `ТТН: ${d.ttn || '—'}`,
    ``,
    `💬 Коментарі:`,
    d.notes.length ? d.notes.map(n => `• ${n}`).join('\n') : '—',
    ``,
    `↩️ Reply на це повідомлення = додати дані`,
  ].filter(x => x !== null).join('\n');
}

function parseCard(text) {
  const get = (re) => (text.match(re) || [])[1] || '';
  const statusLine = (text.split('\n')[1] || '').trim();
  const status = Object.keys(FLOW).find(k => FLOW[k].label === statusLine) || 'new';

  const notesBlock = (text.split('💬 Коментарі:')[1] || '').split('↩️')[0] || '';
  const notes = notesBlock
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.startsWith('• '))
    .map(s => s.slice(2).trim())
    .filter(Boolean);

  return {
    status,
    name:   get(/^👤 (.*)$/m),
    phone:  get(/^📞 (.*)$/m),
    tg:     get(/^✈️ @(\S+)$/m),
    time:   get(/^🕐 (.*)$/m),
    utm:    get(/^🔗 (.*)$/m),
    city:   norm(get(/^Місто: (.*)$/m)),
    branch: norm(get(/^Відділення: (.*)$/m)),
    ttn:    norm(get(/^ТТН: (.*)$/m)),
    notes,
  };
}

const norm = (v) => (v === '—' ? '' : v);

function buildKeyboard(origin, d) {
  const digits = String(d.phone || '').replace(/\D/g, '');
  const contact = [{ text: '💬 Viber', url: `${origin}/v/${digits}` }];
  if (d.tg) contact.push({ text: '✈️ Telegram', url: `https://t.me/${d.tg}` });

  const steps = FLOW[d.status].next.map(([key, label]) => ({
    text: label,
    callback_data: 'st:' + key,
  }));

  return [contact, steps];
}

/* ═══════════════ ЗАЯВКА З САЙТУ ═══════════════ */

async function handleLead(request, env, url) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  if (request.method === 'GET') {
    return json({
      alive: true,
      TG_TOKEN:  env.TG_TOKEN  ? 'заданий' : 'НЕ ЗАДАНИЙ',
      TG_CHAT:   env.TG_CHAT   ? 'заданий' : 'НЕ ЗАДАНИЙ',
      TG_SECRET: env.TG_SECRET ? 'заданий' : 'НЕ ЗАДАНИЙ — кнопки не працюватимуть',
    });
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (!env.TG_TOKEN || !env.TG_CHAT) return json({ ok: false, error: 'TG_TOKEN або TG_CHAT не задані' }, 500);

  let data;
  try { data = await request.json(); }
  catch { return json({ ok: false, error: 'bad json' }, 400); }

  const phone = String(data.phone || '').trim();
  if (!/^\+380\d{9}$/.test(phone)) return json({ ok: false, error: 'bad phone' }, 400);

  const d = {
    status: 'new',
    name:  String(data.name || '').trim().slice(0, 100),
    phone,
    tg:    String(data.tg || '').trim().replace(/^@/, '').slice(0, 64),
    utm:   String(data.utm || '').trim().slice(0, 200),
    time:  new Date().toLocaleString('uk-UA', {
             timeZone: 'Europe/Kiev',
             day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
           }),
    city: '', branch: '', ttn: '', notes: [],
  };

  try {
    const r = await tgApi(env, 'sendMessage', {
      chat_id: env.TG_CHAT,
      text: buildCard(d),
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buildKeyboard(url.origin, d) },
    });
    if (!r.ok) return json({ ok: true, warn: r.description });
  } catch (err) {
    console.error('telegram failed', err);
  }

  return json({ ok: true });
}

/* ═══════════════ ВЕБХУК TELEGRAM ═══════════════ */

async function handleTelegram(request, env, url) {
  const ok = () => new Response('ok');

  if (request.method !== 'POST') return ok();
  if (env.TG_SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TG_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let u;
  try { u = await request.json(); } catch { return ok(); }

  /* ── Кнопка статусу ── */
  if (u.callback_query) {
    const cq  = u.callback_query;
    const key = String(cq.data || '').replace(/^st:/, '');
    const msg = cq.message;
    let alert = '';

    if (!FLOW[key])            alert = 'Невідома дія';
    else if (!msg || !msg.text) alert = 'Немає тексту картки';
    else {
      const d = parseCard(msg.text);
      d.status = key;
      const r = await tgApi(env, 'editMessageText', {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        text: buildCard(d),
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buildKeyboard(url.origin, d) },
      });
      if (!r.ok) alert = 'Помилка: ' + (r.description || 'невідома');
    }

    await tgApi(env, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: alert || FLOW[key].label,
      show_alert: Boolean(alert),
    });
    return ok();
  }

  /* ── Reply = додати дані ── */
  const m = u.message;
  if (m && m.text && m.reply_to_message && m.reply_to_message.text) {
    const card = m.reply_to_message;
    if (!/^🔔 ЗАЯВКА/.test(card.text)) return ok();

    const d = parseCard(card.text);
    const raw = m.text.trim().slice(0, 500);
    const low = raw.toLowerCase();

    if (/^(місто|город)\s+/i.test(raw))                 d.city   = raw.replace(/^\S+\s+/, '');
    else if (/^(нп|відділення|отделение)\s+/i.test(raw)) d.branch = raw.replace(/^\S+\s+/, '');
    else if (/^ттн\s+/i.test(raw))                       d.ttn    = raw.replace(/^\S+\s+/, '');
    else if (/^\d{14}$/.test(raw))                       d.ttn    = raw;
    else d.notes.push(raw);

    const r = await tgApi(env, 'editMessageText', {
      chat_id: card.chat.id,
      message_id: card.message_id,
      text: buildCard(d),
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buildKeyboard(url.origin, d) },
    });

    if (r.ok) {
      await tgApi(env, 'deleteMessage', { chat_id: m.chat.id, message_id: m.message_id });
    } else {
      await tgApi(env, 'sendMessage', {
        chat_id: m.chat.id,
        text: 'Не вдалось оновити картку: ' + (r.description || 'невідома помилка'),
      });
    }
  }

  return ok();
}

/* ═══════════════ ДРІБНИЦІ ═══════════════ */

async function tgApi(env, method, body) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
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
