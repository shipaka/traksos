/**
 * Opt-in text-only reasoning over already matched diagnostic records.
 * Disabled by default; no user identifier, contact details or payment data sent.
 * Treat model output as explanation, never a verified factory repair procedure.
 */
import type { VehicleContext } from './trakbot.ts';

export interface GroundingRecord {
  code: string;
  title_en: string;
  title_ru: string | null;
  detail_en: string | null;
  detail_ru: string | null;
  source_url: string;
  review_state: string;
}
interface ProviderSettings { enabled: boolean; apiKey: string; model: string }
const RULES = [
  'Ты TrakBot — спокойный напарник по диагностике грузовых автомобилей. Общайся естественно, дружелюбно, на "ты".',
  'НЕ продавай и НЕ рекламируй услуги. Не предлагай оплату, подписку или скидку. Не изображай живого мастера.',
  'Опирайся ТОЛЬКО на переданные данные и симптомы. Если их мало, скажи честно и задай ровно один уточняющий вопрос.',
  'Универсальные OBD-II записи не подтверждают диагноз марки, года, версии блока. Не угадывай SPN/FMI, OEM-коды, распиновки, контакты, давление или схему.',
  'Не рекомендуй обходить защиту, отключать EBS/ABS/ECAS, замыкать контакты или вскрывать высокое давление.',
  'Опасная неисправность тормозов, рулевого или подвески: скажи остановить эксплуатацию и обратиться к специалисту.',
  'Не называй конкретную деталь сломанной без достоверного измерения, не обещай ремонт.',
  'Ответ короткий: до 130 слов по-русски, сначала объяснение, затем один безопасный уточняющий вопрос.',
].join('\n');

function stripIdentifiers(s: string): string {
  return s
    .replace(/(?:\+?7|8)[\s()\-]*\d{3}[\s()\-]*\d{3}[\s()\-]*\d{2}[\s()\-]*\d{2}/g, '[номер скрыт]')
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, '[VIN скрыт]')
    .slice(0, 700);
}
export function canUseGroundedAi(consent: boolean, rows: GroundingRecord[], codes: string[], context: VehicleContext): boolean {
  if (!consent || !codes.length || codes.length > 5 || codes.length !== rows.length) return false;
  if (/^(EBS|ABS|ECAS)$/i.test((context.ecu ?? '').trim())) return false;
  return rows.every((r) => r.review_state !== 'unverified' && !!r.title_en &&
    codes.includes(r.code) && (r.detail_ru || r.detail_en));
}

export async function groundedAiAnswer(
  message: string,
  prior: string[],
  context: VehicleContext,
  rows: GroundingRecord[],
  settings: ProviderSettings,
): Promise<string | null> {
  if (!settings.enabled || !settings.apiKey || !settings.model) return null;
  const grounding = rows.map((r) => ({
    code: r.code, meaning: r.title_ru || r.title_en,
    description: r.detail_ru || r.detail_en,
    review: r.review_state, source: r.source_url,
  }));
  const input = [
    'Контекст ТС (со слов пользователя): ' + stripIdentifiers([context.make, context.model, context.year, context.ecu].filter(Boolean).join(', ')),
    'Предыдущие вопросы: ' + prior.slice(0, 4).reverse().map(stripIdentifiers).join(' | '),
    'Новый вопрос: ' + stripIdentifiers(message),
    'Подтверждённые справочные записи (не диагноз!): ' + JSON.stringify(grounding),
  ].join('\n');
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + settings.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        instructions: RULES,
        input: [{ role: 'user', content: input }],
        store: false,
        max_output_tokens: 550,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const result = await response.json() as {
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    const answer = (result.output ?? []).flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('\n').trim();
    if (!answer || answer.length > 2400) return null;
    if (/купите|оформите подписку|гарантирую|обязательно замените|точно неисправен/i.test(answer)) return null;
    return answer + '\n\nЭто справочная версия, не итоговая проверка автомобиля.';
  } catch {
    // Model/network outage must never block the free private chat or result in charges.
    return null;
  }
}


const CASUAL_RULES = [
  'Ты TrakBot — дружелюбный, спокойный автоматический помощник TrakSOS. Общайся естественно, на ты, без рекламы и маркетинговых предложений.',
  'Это нейтральная беседа, а не диагностика. Не придумывай данные о пользователе, ценах, статусах заявок, функциях сайта или партнёрах.',
  'Если вопрос касается неисправности, закона, денег, регистрации, точной навигации по сайту или опасного действия, признай ограничение и попроси уточнить. Профессиональную диагностику не подменяй.',
  'Не изображай живого механика и не давай гарантий. Ответ максимум 90 слов по-русски. Уместна лёгкая доброжелательная шутка.',
].join('\n');

export function neutralConversationEligible(input: string): boolean {
  if (!input.trim() || input.length > 200) return false;
  // Only everyday small talk: never let a non-grounded model troubleshoot a truck.
  if (/ошибк|код|диагност|машин|завод|двигател|топлив|тормоз|рулев|подвес|электр|масло|акб|давлен|датчик|схем|провод|ремонт|страхов|комисс|оплат|платн|возврат|заявк|заказ|профил|магазин|справочник|парол|кабинет/i.test(input)) return false;
  return /привет|как дела|как жизнь|как ты|настроени|спасибо|благодар|поговор|поболта|анекдот|шутк|как прошёл день|салют|здоров|добрый|чем занят/i.test(input);
}

export async function neutralAiAnswer(message: string, prior: string[], settings: ProviderSettings): Promise<string | null> {
  if (!settings.enabled || !settings.apiKey || !settings.model || !neutralConversationEligible(message)) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + settings.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        instructions: CASUAL_RULES,
        input: [{ role: 'user', content: [
          'Предыдущие реплики: ' + prior.slice(0, 3).reverse().map(stripIdentifiers).join(' | '),
          'Новое сообщение: ' + stripIdentifiers(message),
        ].join('\n') }],
        store: false,
        max_output_tokens: 260,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const data = await r.json() as { output?: Array<{ content?: Array<{type?: string;text?: string}> }> };
    const answer = (data.output ?? []).flatMap(x => x.content ?? []).filter(x => x.type === 'output_text')
      .map(x => x.text ?? '').join('\n').trim();
    if (!answer || answer.length > 1200 ||
        /оплат|подписк|купите|скидк|мы гарантируем|точная диагностика/i.test(answer)) return null;
    return answer;
  } catch {
    return null;
  }
}
