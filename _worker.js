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
 * 3. Один раз у браузері:
 *    https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://<САЙТ>/tg&secret_token=<TG_SECRET>
 *
 * ─────────────────────────────────────────────────────────────
 * ЦИКЛ ЗАМОВЛЕННЯ
 *
 *   🆕 Нова
 *     └─ [📝 Додати дані]  -> вставляєш повідомлення клієнта як є
 *     └─ [✅ Підтвердити]
 *   ✅ Підтверджена
 *     └─ [📤 Текст постачальнику]  -> копіюєш і шлеш постачальнику
 *     └─ [📦 Відправлено]
 *   📦 Відправлена
 *     └─ [📝 Додати дані]  -> вставляєш ТТН від постачальника
 *     └─ [📨 Текст клієнту]  -> копіюєш і шлеш клієнту
 *     └─ [💰 Викуплено]
 *
 * Згенеровані тексти — окремі повідомлення з кнопкою 🗑,
 * картка замовлення лишається недоторканою.
 * ─────────────────────────────────────────────────────────────
 */

/* ═══ НАЛАШТУВАННЯ ТОВАРУ — міняй тут ═══ */
const VERSION = '2026-08-08-pb-v1';
const PRODUCT = 'Павербанк AWEI P101K зі швидкою зарядкою 22.5W';
const PRICE   = 2790;   // накладений платіж, грн

/* Куди дублювати дані для звітів. Порожній CRM_URL — нічого не шлеться. */
const CRM_URL  = 'https://sekator-crm.dekavork.workers.dev/update';
const CRM_LINK = 'https://sekator-crm.dekavork.workers.dev/link';
const CRM_KEY = 'sekator_crm_7f3k9m';

const FLOW = {
  new:       { label: '🆕 НОВА',         next: [['confirmed', '✅ Підтвердити'], ['refused', '❌ Відмова']] },
  confirmed: { label: '✅ ПІДТВЕРДЖЕНА', next: [['sent', '📦 Відправлено'],     ['refused', '❌ Відмова']] },
  sent:      { label: '📦 ВІДПРАВЛЕНА',  next: [['paid', '💰 Викуплено'],       ['returned', '🚫 Не викупив']] },
  paid:      { label: '💰 ВИКУПЛЕНА',    next: [['defect', '⚠️ Брак/повернення'], ['new', '↩️ Скинути']] },
  refused:   { label: '❌ ВІДМОВА',       next: [['new', '↩️ Скинути']] },
  returned:  { label: '🚫 НЕ ВИКУПИВ',    next: [['new', '↩️ Скинути']] },
  defect:    { label: '⚠️ БРАК/ПОВЕРНЕННЯ', next: [['new', '↩️ Скинути']] },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/tg')       return handleTelegram(request, env, url);
    if (url.pathname === '/api/del')  return handleDel(request, env);
    if (url.pathname === '/api/lead') return handleLead(request, env, url, ctx);
    if (url.pathname === '/api/diag') return handleDiag(request, env, url);
    const v = url.pathname.match(/^\/v\/(\d{10,15})$/);
    if (v) return viberRedirect(v[1]);
    return env.ASSETS.fetch(request);
  },
};

/* ═══════════════ РОЗБІР ТЕКСТУ ═══════════════ */

function extract(raw) {
  // Увага: у JS \b не працює з кирилицею, тому межі слова
  // задаємо явно через (?:^|[\s,;:.]) та (?=[\s,;:.]|$)
  let rest = ' ' + raw.replace(/\s+/g, ' ').trim() + ' ';
  const out = { city: '', branch: '', ttn: '', note: '' };
  let hadDigits = false;

  const B = '(?:^|[\\s,;:.(])';   // початок слова
  const E = '(?=[\\s,;:.)]|$)';   // кінець слова
  const cut = (mm) => { rest = rest.replace(mm[0], ' '); };
  const find = (src, flags) => rest.match(new RegExp(src, flags || 'i'));

  // ── ТТН ──
  let m = find(B + 'ттн\\s*№?\\s*(\\d[\\d\\s-]{8,20}\\d)' + E);
  if (!m) m = find(B + '(\\d{10,18})' + E);
  if (m) { out.ttn = m[1].replace(/\D/g, ''); cut(m); hadDigits = true; }

  // ── Відділення ──
  m = find(B + '(?:відд[іi]лен\\S*|отделен\\S*|нп|№|no)\\s*№?\\s*(\\d{1,4})' + E);
  if (!m) m = find(B + '(\\d{1,4})' + E);
  if (m) { out.branch = m[1]; cut(m); hadDigits = true; }

  // ── Місто ──
  const STOP = /^(ттн|нп|відділення|відділеня|отделение|місто|город|м|no|не|так|ні|будь|ласка|дякую|привіт|добрий|день)$/i;

  // 1) «м. Київ», «місто Київ»
  m = find(B + '(?:м\\.?|місто|город)\\s+([А-ЯІЇЄҐа-яіїєґA-Za-z][\\wА-Яа-яіїєґ\'’\\-]{2,}(?:\\s+[А-ЯІЇЄҐ][\\wА-Яа-яіїєґ\'’\\-]+)?)' + E, 'iu');

  // 2) слово з великої літери
  if (!m) {
    const cand = rest.match(/(?:^|\s)([А-ЯІЇЄҐ][а-яіїєґ'’\-]{2,}(?:[\s-][А-ЯІЇЄҐ][а-яіїєґ'’\-]{2,})?)(?=\s|$)/u);
    if (cand && !STOP.test(cand[1].split(/[\s-]/)[0])) m = cand;
  }

  // 3) були цифри, лишилось одне-два слова — це місто
  if (!m && hadDigits) {
    const left = rest.trim().split(/\s+/).filter(Boolean);
    if (left.length >= 1 && left.length <= 2 &&
        /^[А-Яа-яІЇЄҐіїєґA-Za-z'’-]{3,}$/u.test(left[0]) && !STOP.test(left[0])) {
      m = rest.match(new RegExp('(?:^|\\s)(' + left.join('\\s+') + ')(?=\\s|$)', 'u'));
    }
  }

  if (m) {
    out.city = m[1].trim().replace(/^./, c => c.toUpperCase());
    cut(m);
  }

  out.note = rest.replace(/\s+/g, ' ').replace(/^[\s,.;:()-]+|[\s,.;:()-]+$/g, '').trim();
  return out;
}

/* ═══════════════ КАРТКА ═══════════════ */

function buildCard(d) {
  const L = [];
  L.push(`🔔 ЗАЯВКА · ${FLOW[d.status].label}`);
  L.push('');
  L.push(`👤 ${d.name || '—'}`);
  L.push(`📞 ${d.phone}`);
  if (d.tg)  L.push(`✈️ @${d.tg}`);
  L.push(`🕐 ${d.time}`);
  if (d.utm) L.push(`🔗 ${d.utm}`);

  if (d.city || d.branch || d.ttn) {
    L.push('');
    if (d.city)   L.push(`📍 Місто: ${d.city}`);
    if (d.branch) L.push(`🏤 Відділення: ${d.branch}`);
    if (d.ttn)    L.push(`📦 ТТН: ${d.ttn}`);
  }

  if (d.notes.length) {
    L.push('');
    L.push('💬 Коментарі:');
    d.notes.forEach(n => L.push(`• ${n}`));
  }

  L.push('');
  L.push('↩️ Reply — додати дані');
  return L.join('\n');
}

function parseCard(text) {
  const get = (re) => (text.match(re) || [])[1] || '';
  const statusLabel = (text.split('\n')[0] || '').split(' · ')[1] || '';
  const status = Object.keys(FLOW).find(k => FLOW[k].label === statusLabel) || 'new';
  const notes = text.split('\n').filter(s => s.startsWith('• ')).map(s => s.slice(2).trim()).filter(Boolean);
  return {
    status,
    name:   get(/^👤 (.*)$/m),
    phone:  get(/^📞 (.*)$/m),
    tg:     get(/^✈️ @(\S+)$/m),
    time:   get(/^🕐 (.*)$/m),
    utm:    get(/^🔗 (.*)$/m),
    city:   get(/^📍 Місто: (.*)$/m),
    branch: get(/^🏤 Відділення: (.*)$/m),
    ttn:    get(/^📦 ТТН: (.*)$/m),
    notes,
  };
}

function buildKeyboard(origin, d) {
  const digits = String(d.phone || '').replace(/\D/g, '');
  const rows = [];

  const contact = [{ text: '💬 Viber', url: `${origin}/v/${digits}` }];
  if (d.tg) contact.push({ text: '✈️ Telegram', url: `https://t.me/${d.tg}` });
  rows.push(contact);

  rows.push([
    { text: '📝 Додати дані', callback_data: 'add' },
    { text: '🧹 Стерти дані', callback_data: 'clear' },
  ]);

  // Тексти в порядку процесу
  rows.push([
    { text: '1️⃣ Запит даних',   callback_data: 'msg:ask' },
    { text: '2️⃣ Постачальнику', callback_data: 'msg:sup' },
  ]);
  rows.push([
    { text: '3️⃣ ТТН клієнту', callback_data: 'msg:cli' },
  ]);

  rows.push(FLOW[d.status].next.map(([k, label]) => ({ text: label, callback_data: 'st:' + k })));
  return rows;
}

/* ═══════════════ ГЕНЕРОВАНІ ТЕКСТИ ═══════════════ */

function askText(d) {
  const first = d.name ? d.name.trim().split(/\s+/)[0] : '';
  return [
    `Добрий день${first ? ', ' + first : ''}!`,
    '',
    `Ви залишили заявку на ${PRODUCT.replace(/^./, c => c.toLowerCase())}.`,
    'Підтверджуєте замовлення?',
    '',
    `Ціна ${PRICE} грн. Оплата при отриманні на Новій Пошті, передоплати немає.`,
    '',
    'Якщо так — надішліть, будь ласка:',
    '• Місто',
    '• Номер відділення Нової Пошти',
    '• ПІБ отримувача повністю',
    '',
    'Відправимо сьогодні.',
  ].join('\n');
}

function supplierText(d) {
  return [
    'Доброго дня! Замовлення на відправку:',
    '',
    `Товар: ${PRODUCT}`,
    `Отримувач: ${d.name || '—'}`,
    `Телефон: ${d.phone}`,
    `Місто: ${d.city || '—'}`,
    `Відділення НП: ${d.branch || '—'}`,
    `Накладений платіж: ${PRICE} грн`,
    '',
    'Прошу надіслати ТТН після відправки. Дякую!',
  ].join('\n');
}

function clientText(d) {
  return [
    `Добрий день${d.name ? ', ' + d.name.split(' ')[0] : ''}!`,
    '',
    'Ваше замовлення відправлено 📦',
    `ТТН: ${d.ttn}`,
    `Відстежити: https://novaposhta.ua/tracking/?cargo_number=${d.ttn}`,
    '',
    `Оплата при отриманні — ${PRICE} грн.`,
    'Посилка зберігається на відділенні 7 днів.',
    '',
    'Порада: перед першим використанням зарядіть павербанк повністю — це займе ніч.',
    '',
    'Дякуємо за замовлення!',
  ].join('\n');
}

/* ═══════════════ ЗАЯВКА З САЙТУ ═══════════════ */

async function handleLead(request, env, url, ctx) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  if (request.method === 'GET') {
    return json({
      alive: true,
      version: VERSION,
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
    name: String(data.name || '').trim().slice(0, 100),
    phone,
    tg:   String(data.tg  || '').trim().replace(/^@/, '').slice(0, 64),
    utm:  String(data.utm || '').trim().slice(0, 200),
    time: new Date().toLocaleString('uk-UA', {
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

    // Кажемо CRM, де саме лежить картка в цьому боті — щоб потім
    // видалення в CRM прибирало її і тут. Із затримкою: CRM у цей
    // момент ще створює свій запис.
    const chatId = r.result && r.result.chat && r.result.chat.id;
    const msgId  = r.result && r.result.message_id;
    if (ctx && chatId && msgId) ctx.waitUntil(crmLink(phone, chatId, msgId));
  } catch (err) {
    console.error('telegram failed', err);
  }
  return json({ ok: true });
}

/* ═══════════════ ДІАГНОСТИКА ═══════════════ */

/**
 * Відкрий https://<домен>/api/diag — показує, що бачить Telegram.
 * Токен назовні не віддається, тільки факт наявності.
 */
async function handleDiag(request, env, url) {
  const out = {
    version: VERSION,
    site: url.origin,
    env: {
      TG_TOKEN:  env.TG_TOKEN  ? 'заданий' : 'НЕ ЗАДАНИЙ',
      TG_CHAT:   env.TG_CHAT   ? String(env.TG_CHAT) : 'НЕ ЗАДАНИЙ',
      TG_SECRET: env.TG_SECRET ? 'заданий' : 'НЕ ЗАДАНИЙ',
    },
  };

  if (env.TG_TOKEN) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/getWebhookInfo`);
      const j = await r.json();
      const info = j.result || {};
      const expect = url.origin + '/tg';

      out.webhook = {
        url: info.url || '(не встановлено)',
        очікується: expect,
        адреса_вірна: info.url === expect,
        secret_token_заданий: Boolean(info.has_custom_certificate === false && info.url)
          ? '(Telegram не показує значення)' : '(невідомо)',
        необроблених: info.pending_update_count,
        остання_помилка: info.last_error_message || 'немає',
      };

      if (!info.url) {
        out.що_робити = 'Вебхук не встановлений. Виконай setWebhook.';
      } else if (info.url !== expect) {
        out.що_робити = 'Вебхук вказує на інший домен. Перереєструй на ' + expect;
      } else if (info.last_error_message) {
        out.що_робити = 'Telegram отримує помилку. Якщо це 403 — secret_token не збігається з TG_SECRET.';
      } else {
        out.що_робити = 'Адреса правильна. Якщо кнопки мовчать — не збігається secret_token.';
      }

      out.перереєструвати =
        `https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=${expect}&secret_token=<значення TG_SECRET>`;
    } catch (e) {
      out.webhook = { error: String(e) };
    }
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* CRM просить прибрати картку тут. Свій токен нікуди не віддаємо. */
async function handleDel(request, env) {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });
  let d = {};
  try { d = await request.json(); } catch { return new Response('bad', { status: 400 }); }
  if (d.key !== CRM_KEY) return new Response('forbidden', { status: 403 });
  if (!d.chatId || !d.messageId) return new Response('no target', { status: 400 });
  await tgApi(env, 'deleteMessage', { chat_id: d.chatId, message_id: d.messageId });
  return new Response('ok');
}

/* ═══════════════ ВЕБХУК ═══════════════ */

async function handleTelegram(request, env, url) {
  const ok = () => new Response('ok');

  if (request.method !== 'POST') return ok();
  const want = String(env.TG_SECRET || '').trim();
  const got  = String(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '').trim();
  if (want && got !== want) {
    // Найчастіша причина: у setWebhook вписаний інший secret_token.
    // Кажемо про це в чат, інакше кнопки просто мовчать без пояснень.
    await tgApi(env, 'sendMessage', {
      chat_id: env.TG_CHAT,
      text: '⚠️ Кнопки не працюють: secret_token у вебхуку не збігається з TG_SECRET.\n\n'
          + 'Перереєструй вебхук із правильним значенням — див. /api/diag на сайті.',
    });
    return new Response('forbidden', { status: 403 });
  }

  let u;
  try { u = await request.json(); } catch { return ok(); }

  if (u.callback_query) return onCallback(u.callback_query, env, url, ok);
  if (u.message)        return onMessage(u.message, env, url, ok);
  return ok();
}

async function onCallback(cq, env, url, ok) {
  const data = String(cq.data || '');
  const msg = cq.message;
  let alert = '';
  let toast = '';

  /* ── Прибрати згенерований текст ── */
  if (data === 'del') {
    await tgApi(env, 'deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id });
    await tgApi(env, 'answerCallbackQuery', { callback_query_id: cq.id });
    return ok();
  }

  /* ── Запросити дані ── */
  if (data === 'add') {
    // У підказку кладемо id картки і її поточний текст —
    // інакше після відповіді картку не буде з чого перебудувати.
    // Підказка видаляється одразу після вводу.
    await tgApi(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: `📝 Встав дані одним повідомленням\n`
          + `(місто, відділення, ТТН, коментар — у будь-якому порядку)\n`
          + `\n#${msg.message_id}\n▪️\n${msg.text || ''}`,
      disable_web_page_preview: true,
      reply_markup: {
        force_reply: true,
        input_field_placeholder: 'Київ відділення 7 ттн 20450012345678',
      },
    });
    await tgApi(env, 'answerCallbackQuery', { callback_query_id: cq.id });
    return ok();
  }

  /* ── Згенерувати текст ── */
  if (data.startsWith('msg:')) {
    const d = parseCard(msg.text || '');
    const kind = data.slice(4);

    if (kind === 'ask' && !d.name) {
      await tgApi(env, 'answerCallbackQuery', {
        callback_query_id: cq.id, text: 'У заявці немає імені', show_alert: true,
      });
      return ok();
    }
    if (kind === 'sup' && (!d.city || !d.branch)) {
      await tgApi(env, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Спершу додай місто і відділення',
        show_alert: true,
      });
      return ok();
    }
    if (kind === 'cli' && !d.ttn) {
      await tgApi(env, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Спершу додай ТТН від постачальника',
        show_alert: true,
      });
      return ok();
    }

    await tgApi(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: kind === 'ask' ? askText(d) : (kind === 'sup' ? supplierText(d) : clientText(d)),
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '🗑 Прибрати', callback_data: 'del' }]] },
    });
    await tgApi(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Готово — копіюй і надсилай' });
    return ok();
  }

  /* ── Стерти дані ── */
  if (data === 'clear') {
    const d = parseCard(msg.text || '');
    d.city = ''; d.branch = ''; d.ttn = ''; d.notes = [];
    const r = await tgApi(env, 'editMessageText', {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      text: buildCard(d),
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buildKeyboard(url.origin, d) },
    });
    await tgApi(env, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: r.ok ? 'Дані стерті' : 'Помилка: ' + (r.description || ''),
      show_alert: !r.ok,
    });
    return ok();
  }

  /* ── Зміна статусу ── */
  if (data.startsWith('st:')) {
    const key = data.slice(3);
    if (!FLOW[key]) alert = 'Невідома дія';
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
      else { toast = FLOW[key].label; await crmSync(d, { chatId: msg.chat.id, messageId: msg.message_id }); }
    }
  }

  await tgApi(env, 'answerCallbackQuery', {
    callback_query_id: cq.id,
    text: alert || toast,
    show_alert: Boolean(alert),
  });
  return ok();
}

async function onMessage(m, env, url, ok) {
  if (!m.text || !m.reply_to_message || !m.reply_to_message.text) return ok();

  const parent = m.reply_to_message;
  let cardId = null;
  let cardText = null;

  if (/^📝 Встав дані/.test(parent.text)) {
    // Відповідь на підказку: id і текст картки зашиті в ній
    const id = parent.text.match(/#(\d+)/);
    const body = parent.text.split('\n▪️\n')[1];
    if (id && body) { cardId = Number(id[1]); cardText = body; }
  } else if (/^🔔 ЗАЯВКА/.test(parent.text)) {
    // Звичайна відповідь прямо на картку
    cardId = parent.message_id;
    cardText = parent.text;
  }

  if (!cardId || !cardText) return ok();

  const d = parseCard(cardText);
  const e = extract(m.text.trim().slice(0, 1000));

  if (e.city)   d.city = e.city;
  if (e.branch) d.branch = e.branch;
  if (e.ttn)    d.ttn = e.ttn;
  if (e.note)   d.notes.push(e.note);

  const r = await tgApi(env, 'editMessageText', {
    chat_id: m.chat.id,
    message_id: cardId,
    text: buildCard(d),
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buildKeyboard(url.origin, d) },
  });

  if (r.ok) {
    await crmSync(d, { chatId: m.chat.id, messageId: cardId });
    await tgApi(env, 'deleteMessage', { chat_id: m.chat.id, message_id: m.message_id });
    if (/^📝 Встав дані/.test(parent.text)) {
      await tgApi(env, 'deleteMessage', { chat_id: m.chat.id, message_id: parent.message_id });
    }
  } else {
    await tgApi(env, 'sendMessage', {
      chat_id: m.chat.id,
      text: 'Не вдалось оновити картку: ' + (r.description || 'невідома помилка'),
    });
  }
  return ok();
}

/* ═══════════════ СИНХРОНІЗАЦІЯ З CRM ═══════════════ */

/**
 * Шле поточний стан заявки в CRM для звітів.
 * Помилка тут нічого не ламає — заявка в цьому боті працює далі.
 */
async function crmLink(phone, chatId, messageId) {
  await new Promise(r => setTimeout(r, 2500));   // даємо CRM створити запис
  try {
    await fetch(CRM_LINK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: CRM_KEY, phone, chatId, messageId }),
    });
  } catch (e) {}
}

async function crmSync(d, src) {
  if (!CRM_URL || !d || !d.phone) return;
  try {
    await fetch(CRM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key:    CRM_KEY,
        phone:  d.phone,
        status: d.status,
        city:   d.city,
        branch: d.branch,
        ttn:    d.ttn,
        notes:  d.notes,
        srcChat: src && src.chatId,
        srcMsg:  src && src.messageId,
      }),
    });
  } catch (e) {}
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
<style>body{font-family:system-ui,sans-serif;padding:40px 20px;text-align:center;background:#FBFAF7;color:#131A24}
a{display:inline-block;margin-top:20px;background:#7360F2;color:#fff;text-decoration:none;padding:14px 26px;font-weight:700;border-radius:6px}</style>
<script>location.replace('viber://chat?number=%2B${num}');</script>
</head><body>
<p>Відкриваю Viber…</p>
<a href="viber://chat?number=%2B${num}">Відкрити вручну</a>
<p style="margin-top:24px;color:#3C4757;font-size:14px">+${num}</p>
</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
