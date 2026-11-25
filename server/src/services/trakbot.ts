import { professionalTechAccess, requireProfessionalTechAccess } from '../domain/techbaseAccess.ts';
import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, forbidden } from '../http/router.ts';
import { config } from '../config.ts';
import { maskPhones } from '../util.ts';
import { resolveGuideDestination } from './trakbotGuide.ts';
import { canUseGroundedAi, groundedAiAnswer, neutralAiAnswer } from './trakbotAi.ts';
import { offlineSmallTalk } from './trakbotOfflineTalk.ts';

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
const NON_GENERIC_ECU = /\b(?:EBS|ABS|ECAS)\b/i;
function nonGenericDtcContext(question: string, vehicle: VehicleContext): boolean {
  return NON_GENERIC_ECU.test(question) || NON_GENERIC_ECU.test(vehicle.ecu ?? '');
}

export function extractDtcCodes(text: string): string[] {
  return [...new Set((text.toUpperCase().match(DTC_PATTERN) ?? []))].slice(0, 5);
}

function vehicleLabel(v: VehicleContext): string {
  return [v.make?.trim(), v.model?.trim(), v.year, v.ecu?.trim()].filter(Boolean).join(' · ');
}

export type TrakBotRole = 'driver' | 'specialist';

/** Replies are deliberately conversational, not sales scripts. Grounding beats confidence. */
export function composeTrakBotReply(
  input: string, found: Dtc[], context: VehicleContext = {},
  previousUserMessages: string[] = [], role: TrakBotRole = 'driver',
): string {
  const codes = extractDtcCodes(input);
  const vehicle = vehicleLabel(context);
  const expert = role === 'specialist';
  const danger = /\b(EBS|ABS|ECAS)\b|тормоз|рулев|педаль тормоза|brake|steer/i.test(input + ' ' + (context.ecu ?? ''));
  const safety = danger
    ? '\n\nВажно: если тормоза, рулевое или подвеска работают неправильно, не продолжайте движение до проверки специалистом.'
    : '';
  const incompatibleEcu = nonGenericDtcContext(input, context);
  const unsupportedProtocol = SPN_PATTERN.test(input) || /\bFMI\b/i.test(input);
  if (unsupportedProtocol) {
    return 'Понял, это формат грузовой диагностики. Напиши SPN и FMI полностью, марку, двигатель и блок. В текущей базе нет подтверждённой расшифровки именно этой ошибки J1939 — наугад не дам. Если точной карточки нет, лучше подключить специалиста.' + safety;
  }
  if (codes.length) {
    if (incompatibleEcu) {
      return 'Смотри, тут надо уточнить формат. ' +
        (context.ecu?.trim() ? 'Указан блок ' + context.ecu.trim() + '.' : 'В вопросе упомянут блок EBS/ABS/ECAS.') +
        ' А код похож на универсальный OBD-II. Для этого блока значение может быть другим. Пришли код точно как на диагностике, включая систему и подтип — гадать не буду.' + safety;
    }
    const parts = codes.map((code) => {
      const row = found.find((x) => x.code === code);
      if (!row) return 'По ' + code + ' проверенной расшифровки пока нет. Лучше уточнить блок и формат кода.';
      const name = row.title_ru || row.title_en;
      const description = row.detail_ru ||
        (row.detail_en ? 'Есть английское описание в источнике, но русский технический перевод ещё не проверен.' : '');
      const verification = row.review_state === 'unverified'
        ? ' Значение из внешнего справочника ещё не перепроверено.' : '';
      return code + ' — ' + name + '. ' + description + verification;
    });
    const followup = expert
      ? 'Для дальнейшего разбора нужны версия блока, условия появления, текущие параметры и проведённые измерения. Назови их — отделим факты от предположений.'
      : 'Что именно сейчас делает машина? Напиши симптом и когда ошибка появилась — попробуем сузить круг вопросов.';
    return [vehicle ? 'По машине: ' + vehicle + '.' : '', ...parts,
      'Это общий OBD-II справочник, не подтверждённый диагноз конкретного блока. По одному коду менять детали нельзя.',
      followup].filter(Boolean).join('\n\n') + safety;
  }

  // Offline conversation is a tiny separate personality layer, never a
  // substitute for codes, platform navigation or safety-relevant diagnostics.
  const casualReply = offlineSmallTalk(input, previousUserMessages);
  if (casualReply) return casualReply;

  const prior = previousUserMessages.join(' ').toLowerCase();
  const first = input.toLowerCase();

  if (/^(спасибо|благодарю|спс|пасиб|супер|спасибо большое)[!.\s]*$/i.test(first)) {
    return 'Да не за что! Рад, если пригодилось. Если что-то ещё всплывёт — пиши.' + safety;
  }
  if (/как дела|как жизнь|что нового|как ты/i.test(first) && first.length < 90) {
    return 'Всё ровно, на связи. Я, конечно, ИИ, но поболтать и разобраться с вопросом могу. Как у тебя дела?' + safety;
  }
  if (/кто ты|ты человек|живой|что ты умеешь|что умеет бот|расскажи о себе/i.test(first)) {
    return 'Я TrakBot — автоматический помощник TrakSOS. Могу объяснить, где что находится на площадке, подсказать общие значения ошибок и задать правильные вопросы по машине. Серьёзную неисправность по переписке не подтвержу.' + safety;
  }
  if (/(?:сколько стоит|стоимость|цена).{0,55}(?:бот|трак[\s-]*бот|trak[\s-]*bot|помощ)|(?:бот|трак[\s-]*бот|trak[\s-]*bot).{0,55}(?:платн|бесплатн|стоит|цена|стоимость)/i.test(first)) {
    return 'Этот личный чат сейчас бесплатный. Дополнительные платные режимы отдельно не включены — без твоего отдельного согласия никаких списаний не будет.' + safety;
  }
  if (/поболта|поговорим|просто пообщ|как настроение/i.test(first)) {
    return 'Можно и просто поболтать. Что интересного сегодня случилось? Только не принимай меня за живого мастера — я всё-таки программа.' + safety;
  }
  if (/шутк|анекдот|пошути/i.test(first)) {
    return 'Небольшая гаражная классика: «Чего молчишь?» — «Не молчу, просто ошибок пока не записал». А вообще, что у тебя нового?' + safety;
  }
  if (/ты туп|не понимаешь|ерунд|бред/i.test(first) && first.length < 120) {
    return 'Может, я не так понял вопрос. Давай без догадок: что именно не совпало, код или симптом? Попробую разобраться точнее.' + safety;
  }

  const startupMentioned = /не завод|не запуска|не схватыв|стартер|запуск двигател|doesn.t start/i.test(first + ' ' + prior);
  if (startupMentioned && /щелк|щёлк|не крутит|молчит|не реагирует|тишина/i.test(first)) {
    return 'Ага, стартер двигатель не проворачивает. При включении зажигания приборы сильно гаснут или всё остаётся как обычно? Есть ли возможность проверить напряжение АКБ без разборки? Не перемыкай клеммы и не лезь под машину на обочине.' + safety;
  }
  if (startupMentioned && /крутит|вращает|вертит/i.test(first) && /не схватыв|не завод|без запуска|не запуска|крутит/i.test(first)) {
    return expert
      ? 'Окей, прокрутка есть, запуска нет. Какие коды записаны в ЭБУ двигателя и есть ли фактические параметры при прокрутке? Не будем приговаривать топливную аппаратуру без замеров.' + safety
      : 'Понял, стартер крутит, а мотор не запускается. Есть ошибки на панели или код из сканера? Напиши его и двигатель. С топливной системой высокого давления без мастера ничего не откручивай.' + safety;
  }
  if (/не завод|не запуска|не схватыв|стартер|запуск двигател|doesn.t start/i.test(first)) {
    return 'Давай разберёмся. Стартер крутит мотор, только щёлкает или вообще молчит? И что за машина — марка, год, двигатель? Начнём с простого, без опасных экспериментов.' + safety;
  }
  if (/аккумулятор|зарядк|генератор|напряжени/i.test(first)) {
    return 'Ясно. Двигатель работает или заглох? Что показывает панель и есть ли код ошибки? Если можешь безопасно измерить напряжение обычным вольтметром, напиши цифру. Генератор по одному симптому менять рано.' + safety;
  }
  if (/привет|здоров|салют|хай|добрый/i.test(first) && first.length < 40) {
    return 'Здорово! Что с машиной? Рассказывай, разберём по порядку.' + safety;
  }
  return expert
    ? 'Слушаю. Пришли марку, год, двигатель, блок и точный код или опиши симптомы и измерения. Где есть подтверждённые данные — покажу; где их нет — так и скажу.' + safety
    : 'Рассказывай, что случилось. Желательно марка, год, симптомы и код ошибки, если есть. По простому подскажу, а сложное без проверок выдумывать не стану.' + safety;
}

export class TrakBotService {
  constructor(private db: Db) {}

  async history(user: AuthUser) {
    // A private conversation. Never joins to broadcasts, order chats or support threads.
    await this.db.query("delete from trakbot_messages where user_id=$1 and created_at < now() - interval '90 days'", [user.id]);
    const rows = await this.db.query(
      'select id::text as id, role, body, action_path, action_label, created_at from trakbot_messages where user_id=$1 order by id desc limit 60',
      [user.id],
    );
    return { messages: rows.reverse(), freePilot: true };
  }

  async clearHistory(user: AuthUser) {
    // Serialize with the final commit of concurrent replies. A deleted thread
    // must not retain half of a user/bot pair after another request commits.
    await this.db.tx(async q => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', ['trakbot:' + user.id]);
      await q.query(`insert into trakbot_history_generation(user_id,generation) values($1,1)
        on conflict(user_id) do update set generation=trakbot_history_generation.generation+1`, [user.id]);
      await q.query('delete from trakbot_messages where user_id=$1', [user.id]);
    });
    return { cleared: true };
  }

  async reply(user: AuthUser, input: string, context: VehicleContext, allowAiProcessing = false) {
    const message = maskPhones(input).text.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, '[VIN скрыт]').trim();
    if (!message || message.length > 700) throw bad('invalid_message', 'Сообщение должно быть от 1 до 700 символов');
    // Reserve a quota slot before any expensive external call. The timestamp
    // ledger is deliberately independent of the user's deletable chat history.
    // Hold the per-account lock only for local SQL, never for provider I/O.
    const generation = await this.db.tx(async q => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', ['trakbot:' + user.id]);
      await q.query("delete from trakbot_request_attempts where user_id=$1 and requested_at <= clock_timestamp() - interval '1 day'", [user.id]);
      const limit = await q.one<{ minute: number; day: number }>(
        "select count(*) filter (where requested_at > clock_timestamp() - interval '1 minute')::int as minute, count(*)::int as day from trakbot_request_attempts where user_id=$1",
        [user.id]);
      if ((limit?.minute ?? 0) >= 10 || (limit?.day ?? 0) >= 150)
        throw bad('trakbot_rate_limit', 'Слишком много сообщений. Попробуйте позже или обратитесь к специалисту.');
      await q.query('insert into trakbot_history_generation(user_id) values($1) on conflict(user_id) do nothing', [user.id]);
      const current = await q.one<{ generation: string }>(
        'select generation::text as generation from trakbot_history_generation where user_id=$1', [user.id]);
      if (!current) throw bad('trakbot_history_changed', 'История изменилась. Отправьте сообщение заново.');
      await q.query('insert into trakbot_request_attempts(user_id) values($1)', [user.id]);
      return current.generation;
    });
    const codes = extractDtcCodes(message);
    const found = codes.length
      ? await this.db.query<Dtc>(
          "select code,protocol,make,title_en,title_ru,detail_ru,detail_en,source_url,review_state from diagnostic_codes where protocol='OBD2' and make='GENERIC' and ecu='' and code=any($1::text[])",
          [codes],
        )
      : [];
    const prior = await this.db.query<{ role: string; body: string }>(
      "select role, body from trakbot_messages where user_id=$1 and role='user' order by id desc limit 8",
      [user.id],
    );
    const specialist = await professionalTechAccess(this.db,user);
    const isNavigationSafe = codes.length === 0 && !SPN_PATTERN.test(message) && !/\bFMI\b/i.test(message);
    let guide = isNavigationSafe ? resolveGuideDestination(message, user.roles) : null;
    if (guide && ['/tech/codes','/techbase/master','/tech/cases'].includes(guide.destination.path) && !specialist) {
      guide = { text: 'Профессиональная ТехБаза доступна подтверждённым специалистам.',
        destination: { path: user.roles.some(r=>r==='master'||r==='service')?'/work/docs':'/techbase/driver', label: 'Доступные материалы' } };
    }
    const previousQuestions = prior.map((r) => r.body);
    const offlineReply = !guide && codes.length === 0
      ? offlineSmallTalk(message, previousQuestions) : null;
    const deterministic = guide?.text ?? composeTrakBotReply(message, found, context, previousQuestions,
      specialist ? 'specialist' : 'driver');
    const llmEligible = !offlineReply && !guide && !nonGenericDtcContext(message, context) &&
      !/тормоз|рулев|подвес|brake|steer/i.test(message) &&
      canUseGroundedAi(allowAiProcessing, found, codes, context) &&
      !SPN_PATTERN.test(message) && !/\bFMI\b/i.test(message);
    const modelSettings = {
      enabled: config.trakbot.llmEnabled && allowAiProcessing,
      apiKey: config.trakbot.llmApiKey,
      model: config.trakbot.llmModel,
      transport: config.trakbot.llmTransport === 'local' ? 'local' as const : 'api' as const,
      localUrl: config.trakbot.llmLocalUrl,
    };
    const generated = llmEligible
      ? await groundedAiAnswer(message, prior.map((r) => r.body), context, found, modelSettings)
      : !offlineReply && !guide && !codes.length && allowAiProcessing
        ? await neutralAiAnswer(message, previousQuestions, modelSettings) : null;
    // Verified field experience is only attached for validated technicians and
    // a matching vehicle. Never use it as a universal repair instruction.
    let caseNotes = '';
    // No "similar successful repair" without complete model, ECU and model year:
    // matching one DTC across vehicle generations is not evidence of identical cause.
    if (specialist && codes.length && !nonGenericDtcContext(message, context) &&
        !SPN_PATTERN.test(message) && !/\bFMI\b/i.test(message) &&
        context.make?.trim() && context.model?.trim() && context.ecu?.trim() &&
        context.year && Number.isInteger(context.year)) {
      if (await professionalTechAccess(this.db,user)) {
        const matches = await this.db.query<{
          make: string; model: string; ecu: string; code: string;
          symptoms: string; checks_performed: string; verified_fix: string;
        }>(
          "select make,model,ecu,code,symptoms,checks_performed,verified_fix from technical_repair_cases where review_state='approved' and code=any($1::text[]) and lower(make)=lower($2) and lower(model)=lower($3) and lower(ecu)=lower($4) and production_year=$5::int order by id desc limit 2",
          [codes, context.make.trim(), (context.model ?? '').trim(), (context.ecu ?? '').trim(), context.year ?? null],
        );
        if (matches.length) {
          caseNotes = '\n\nИз проверенных кейсов коллег для похожей комплектации (не заводская инструкция):\n' +
            matches.map((x) => {
              // Approved legacy field cases may still contain names, VINs or
              // telephone numbers. Publishing the case never authorizes sharing
              // the former participant's contacts in another account's chat.
              const safe = (value: string) => maskPhones(String(value ?? '')).text
                .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, '[VIN скрыт]').slice(0, 500);
              return safe(x.code) + ' · признаки: ' + safe(x.symptoms) +
                '; проверяли: ' + safe(x.checks_performed) +
                '; в том случае помогло: ' + safe(x.verified_fix);
            }).join('\n') +
            '\nСравни конфигурацию и измерения до любых ремонтных действий.';
        }
      }
    }
    const answer = (generated ?? deterministic) + caseNotes;
    const unsupported = SPN_PATTERN.test(message) || /\bFMI\b/i.test(message);
    const mismatch = nonGenericDtcContext(message, context);
    const coverage = unsupported ? 'not_supported' : (mismatch && codes.length) ? 'mismatched_protocol'
      : codes.length ? (codes.every((code) => found.some((row) => row.code === code)) ? 'generic_found' : 'partial_or_missing')
      : 'initial_triage';
    // Billing is deliberately disabled. No authorization or capture is made for an unverified answer.
    return this.db.tx(async (q) => {
      // Clearing the thread while this response was being computed must
      // prevent both messages from reappearing, even after a slow provider.
      await q.query('select pg_advisory_xact_lock(hashtext($1))', ['trakbot:' + user.id]);
      const current = await q.one<{ generation: string }>(
        'select generation::text as generation from trakbot_history_generation where user_id=$1', [user.id]);
      if (current?.generation !== generation)
        throw bad('trakbot_history_changed', 'История изменилась. Отправьте сообщение заново.');
      // The model or catalogue read may have outlived the specialist's approval.
      // Do not persist or return a reply prepared with revoked professional access.
      if(specialist)await requireProfessionalTechAccess(q,user);
      const [userMessage] = await q.query<{ id: string; role: 'user'; body: string; created_at: string }>(
        "insert into trakbot_messages(user_id,role,body) values($1,'user',$2) returning id::text as id,role,body,created_at",
        [user.id, message],
      );
      const [bot] = await q.query<{ id: string; role: string; body: string; action_path: string | null; action_label: string | null; created_at: string }>(
        "insert into trakbot_messages(user_id,role,body,action_path,action_label) values($1,'bot',$2,$3,$4) returning id::text as id,role,body,action_path,action_label,created_at",
        [user.id, answer, guide?.destination.path ?? null, guide?.destination.label ?? null],
      );
      return { userMessage, message: bot, freePilot: true, aiUsed: !!generated, coverage, chargeAllowed: false, handoffSuggested: coverage === 'partial_or_missing' || coverage === 'not_supported' || coverage === 'mismatched_protocol' };
    });
  }

  async expertLookup(user: AuthUser, query: string) {
    await requireProfessionalTechAccess(this.db,user);
    const q = query.trim().slice(0, 60);
    if (q.length < 2 || !/[\p{L}\p{N}]/u.test(q)) return { items: [] };
    // Literal substring matching, not caller-supplied SQL LIKE wildcards:
    // % / _ from a technician's query cannot enumerate an unrelated catalogue.
    const items = await this.db.query(
      `select protocol,make,ecu,code,title_en,title_ru,detail_en,detail_ru,
              causes,symptoms,source_url,source_license,review_state,updated_at
         from diagnostic_codes
        where left(upper(code),length($1))=upper($1)
           or position(lower($2) in lower(title_en))>0
           or position(lower($2) in lower(coalesce(title_ru,'')))>0
        order by case when code = upper($3) then 0 else 1 end, code limit 30`,
      [q, q, q],
    );
    await requireProfessionalTechAccess(this.db,user);
    return { items };
  }
}
