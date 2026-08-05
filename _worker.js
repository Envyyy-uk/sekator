/**
 * ЗАЯВКА З САЙТУ -> TELEGRAM
 *
 * Цей файл має лежати В КОРЕНІ, поруч з index.html.
 * Формат _worker.js працює при ручному завантаженні в Cloudflare Pages,
 * на відміну від папки functions (та компілюється тільки при збірці з Git).
 *
 * ─────────────────────────────────────────────────────────────
 * НАЛАШТУВАННЯ
 *
 * Cloudflare Pages -> проєкт -> Settings -> Variables and Secrets
 * Додати дві змінні типу Secret:
 *   TG_TOKEN = токен від @BotFather
 *   TG_CHAT  = число з @userinfobot
 *
 * Після збереження — новий деплой, інакше не підхопиться.
 * ─────────────────────────────────────────────────────────────
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Все, крім /api/lead, віддаємо як статику
    if (url.pathname !== '/api/lead') {
      return env.ASSETS.fetch(request);
    }

    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    // Діагностика: відкрий /api/lead у браузері
    if (request.method === 'GET') {
      return json({
        alive: true,
        TG_TOKEN: env.TG_TOKEN ? 'заданий (' + env.TG_TOKEN.length + ' символів)' : 'НЕ ЗАДАНИЙ',
        TG_CHAT:  env.TG_CHAT  ? 'заданий (' + env.TG_CHAT + ')'                 : 'НЕ ЗАДАНИЙ',
        hint: 'Якщо обидва задані — проблема не тут. Дивись Functions -> Logs.',
      });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method not allowed' }, 405);
    }

    if (!env.TG_TOKEN || !env.TG_CHAT) {
      return json({ ok: false, error: 'TG_TOKEN або TG_CHAT не задані' }, 500);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: 'bad json' }, 400);
    }

    const name = String(data.name || '').trim().slice(0, 100);
    const phone = String(data.phone || '').trim().slice(0, 20);
    const utm = String(data.utm || '').trim().slice(0, 300);
    const tg = String(data.tg || '').trim().replace(/^@/, '').slice(0, 64);

    if (!/^\+380\d{9}$/.test(phone)) {
      return json({ ok: false, error: 'bad phone' }, 400);
    }

    const kyivTime = new Date().toLocaleString('uk-UA', {
      timeZone: 'Europe/Kiev',
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    const text =
      `🔔 НОВА ЗАЯВКА\n\n` +
      `Імʼя: ${name || '—'}\n` +
      `Телефон: ${phone}\n` +
      (tg ? `Telegram: @${tg}\n` : '') +
      (utm ? `Джерело: ${utm}\n` : '') +
      `Час: ${kyivTime} (Київ)`;

    try {
      const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TG_CHAT,
          text,
          disable_web_page_preview: true,
        }),
      });
      const res = await r.json();
      if (!res.ok) {
        console.error('telegram rejected', res);
        return json({ ok: true, warn: res.description });
      }
    } catch (err) {
      // Клієнту все одно кажемо «прийнято» — краще втратити сповіщення,
      // ніж показати помилку і втратити замовлення.
      console.error('telegram failed', err);
    }

    return json({ ok: true });
  },
};
