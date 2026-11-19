import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, forbidden } from '../http/router.ts';

export interface VehicleContext {
  make?: string;
  model?: string;
  year?: number;
  ecu?: string;
}

type Dtc = {
  code: string; title_en: string; title_ru: string | null;
  detail_ru: string | null; detail_en: string | null;
  source_url: string; review_state: string; protocol: string; make: string;
};
const DTC_PATTERN = /\b[PBCU][0-3][0-9A-F]{3}\b/gi;
const SPN_PATTERN = /\bSPN\s*[:#-]?\s*\d{1,6}\b/i;

export function extractDtcCodes(text: string): string[] {
  return [...new Set((text.toUpperCase().match(DTC_PATTERN) ?? []))].slice(0, 5);
}

function vehicleLabel(v: VehicleContext): string {
  return [v.make?.trim(), v.model?.trim(), v.year, v.ecu?.trim()].filter(Boolean).join(' · ');
}

export function composeTrakBotReply(input: string, found: Dtc[], context: VehicleContext = {}): string {
  const codes = extractDtcCodes(input);
  const vehicle = vehicleLabel(context);
  const safety = /\b(EBS|ABS|ECAS)\b|тормоз|рулев|педаль тормоза|brake|steer/i.test(input)
    ? '\n\nЕсли тормозная система, рулевое управление или подвеска работают неправильно, не продолжайте движение до проверки специалистом.'
    : '';
  if (codes.length) {
    const parts = codes.map((code) => {
      const row = found.find((x) => x.code === code);
      if (!row) return `Код ${code}: проверенной расшифровки пока нет. Нельзя назначать причину по одному коду.`;
      const title = row.title_ru || row.title_en;
      const detail = row.detail_ru || (row.detail_en ? 'Подробное описание источника доступно на английском языке специалисту.' : '');
      return `${code} — ${title}. ${detail}`.trim();
    });
    const caution = 'Это общие OBD-II значения, а не подтверждённый диагноз для конкретного блока. Не заменяйте детали только по коду.';
    const next = found.length === codes.length
      ? 'Уточни блок управления и условия возникновения ошибки — это поможет точнее сопоставить данные.'
      : 'По части кодов нет достоверной информации. Не стану угадывать; если нужно, можно передать вопрос специалисту.';
    return [vehicle ? `Автомобиль: ${vehicle}.` : '', ...parts, caution, next].filter(Boolean).join('\n\n') + safety;
  }
  if (SPN_PATTERN.test(input) || /\bFMI\b/i.test(input)) {
    return 'Для грузовых SPN/FMI укажи оба числа, марку, модель, год и блок управления. В пилотной базе пока нет подтверждённой заводской расшифровки J1939 — придумывать её не буду. Если точной карточки нет, вопрос лучше передать специалисту.' + safety;
  }
  if (/не завод|не запуска|не схватыв|стартер|запуск двигател|doesn.t start/i.test(input)) {
    return 'Проверим самое простое. Стартер крутит двигатель с обычной скоростью, только щёлкает или совсем молчит? Есть ли сообщения или коды ошибок на панели? Напиши марку, модель, год и двигатель. Не перемыкай контакты стартера и не вмешивайся в топливную систему на дороге.' + safety;
  }
  if (/аккумулятор|зарядк|генератор|напряжени/i.test(input)) {
    return 'Уточни: двигатель работает или заглох, что показывает приборная панель, есть ли код ошибки? Если есть возможность безопасно проверить напряжение обычным вольтметром без разборки проводки, сообщи показание. По одному симптому генератор не приговариваем.' + safety;
  }
  return 'Я TrakBot, помощник для первичных вопросов в личном чате. Напиши марку, модель, год, блок управления и точный код ошибки (например P0087), либо коротко опиши симптом. Я не ставлю окончательный диагноз — сложное передадим специалисту.' + safety;
}

export class TrakBotService {
  constructor(private db: Db) {}

  async history(user: AuthUser) {
    // A private conversation. Never joins to broadcasts, order chats or support threads.
    await this.db.query("delete from trakbot_messages where user_id=$1 and created_at < now() - interval '90 days'", [user.id]);
    const rows = await this.db.query(
      'select id::text as id, role, body, created_at from trakbot_messages where user_id=$1 order by id desc limit 60',
      [user.id],
    );
    return { messages: rows.reverse(), freePilot: true };
  }

  async reply(user: AuthUser, input: string, context: VehicleContext) {
    const message = input.trim();
    if (!message || message.length > 700) throw bad('invalid_message', 'Сообщение должно быть от 1 до 700 символов');
    // Bounded automated traffic to avoid unlimited text-generation or DB usage.
    const limit = await this.db.one<{ minute: number; day: number }>(
      "select count(*) filter (where created_at > now() - interval '1 minute')::int as minute, count(*)::int as day from trakbot_messages where user_id=$1 and role='user' and created_at > now() - interval '1 day'",
      [user.id],
    );
    if ((limit?.minute ?? 0) >= 10 || (limit?.day ?? 0) >= 150)
      throw bad('trakbot_rate_limit', 'Слишком много сообщений. Попробуйте позже или обратитесь к специалисту.');
    const codes = extractDtcCodes(message);
    const found = codes.length
      ? await this.db.query<Dtc>(
          "select code,protocol,make,title_en,title_ru,detail_ru,detail_en,source_url,review_state from diagnostic_codes where protocol='OBD2' and make='GENERIC' and ecu='' and code=any($1::text[])",
          [codes],
        )
      : [];
    const answer = composeTrakBotReply(message, found, context);
    const coverage = codes.length ? (codes.every((code) => found.some((row) => row.code === code)) ? 'generic_found' : 'partial_or_missing')
      : (SPN_PATTERN.test(message) || /\\bFMI\\b/i.test(message) ? 'not_supported' : 'initial_triage');
    // Billing is deliberately disabled. No authorization or capture is made for an unverified answer.
    return this.db.tx(async (q) => {
      await q.query('insert into trakbot_messages(user_id,role,body) values($1,\'user\',$2)', [user.id, message]);
      const [bot] = await q.query<{ id: string; role: string; body: string; created_at: string }>(
        "insert into trakbot_messages(user_id,role,body) values($1,'bot',$2) returning id::text as id,role,body,created_at",
        [user.id, answer],
      );
      return { message: bot, freePilot: true, coverage, chargeAllowed: false, handoffSuggested: coverage === 'partial_or_missing' || coverage === 'not_supported' };
    });
  }

  async expertLookup(user: AuthUser, query: string) {
    if (!user.roles.some((r) => ['master','service','admin','moderator'].includes(r))) throw forbidden();
    const q = query.trim().slice(0, 60);
    if (q.length < 2) return { items: [] };
    const items = await this.db.query(
      `select protocol,make,ecu,code,title_en,title_ru,detail_en,detail_ru,
              causes,symptoms,source_url,source_license,review_state,updated_at
         from diagnostic_codes
        where code ilike $1 or title_en ilike $2 or coalesce(title_ru,'') ilike $2
        order by case when code = upper($3) then 0 else 1 end, code limit 30`,
      [q.toUpperCase() + '%', '%' + q.replace(/[%_\\]/g, '') + '%', q],
    );
    return { items };
  }
}
