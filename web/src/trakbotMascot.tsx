import './trakbotMascot.css';
/**
 * TrackSalesBot/TrakBot character: ONE canonical truck technician across desktop,
 * Android WebView, the guest dock and the private chat.
 * Approved visual direction: option 3 (orange/white truck, charcoal cap, diagnostic tablet).
 * All reactions are decorative render states, never sent as chat messages or billing events.
 */
export const BOT_REACTIONS = [
  { id: 'hello', label: 'Привет!', mark: '✦', face: 'smile' },
  { id: 'typing', label: 'Печатаю', mark: '···', face: 'focus' },
  { id: 'thinking', label: 'Думаю', mark: '?', face: 'focus' },
  { id: 'idea', label: 'Есть идея', mark: '✧', face: 'wink' },
  { id: 'ok', label: 'Окей', mark: '✓', face: 'wink' },
  { id: 'success', label: 'Успех', mark: '★', face: 'happy' },
  { id: 'route', label: 'Маршрут', mark: '↗', face: 'smile' },
  { id: 'service', label: 'Сервис', mark: '⚒', face: 'smile' },
  { id: 'warning', label: 'Внимание', mark: '!', face: 'worried' },
  { id: 'error', label: 'Ошибка', mark: '×', face: 'worried' },
  { id: 'wait', label: 'Подожди', mark: '⌛', face: 'focus' },
  { id: 'loading', label: 'Загружаю', mark: '↻', face: 'focus' },
  { id: 'sorry', label: 'Извини', mark: '♡', face: 'worried' },
  { id: 'thanks', label: 'Спасибо', mark: '♥', face: 'happy' },
  { id: 'support', label: 'На связи', mark: '☎', face: 'smile' },
  { id: 'done', label: 'Готово', mark: '✓', face: 'happy' },
  { id: 'search', label: 'Ищу', mark: '⌕', face: 'focus' },
  { id: 'diagnostic', label: 'Диагностика', mark: '⚙', face: 'focus' },
  { id: 'enroute', label: 'В пути', mark: '➜', face: 'smile' },
  { id: 'arrived', label: 'Прибыл', mark: '⌖', face: 'happy' },
  { id: 'question', label: 'Вопрос', mark: '?', face: 'curious' },
  { id: 'note', label: 'Записал', mark: '✎', face: 'smile' },
  { id: 'great', label: 'Отлично', mark: '★', face: 'wink' },
  { id: 'party', label: 'Ура', mark: '✳', face: 'happy' },
  { id: 'calm', label: 'Спокойно', mark: '☼', face: 'smile' },
  { id: 'explain', label: 'Объясняю', mark: '≡', face: 'smile' },
  { id: 'stop', label: 'Стоп', mark: '!', face: 'serious' },
  { id: 'important', label: 'Важно', mark: '‼', face: 'serious' },
  { id: 'solved', label: 'Решение', mark: '✓', face: 'wink' },
  { id: 'night', label: 'Доброй ночи', mark: '☾', face: 'calm' },
] as const;

export type BotReactionId = (typeof BOT_REACTIONS)[number]['id'];
type Face = (typeof BOT_REACTIONS)[number]['face'];

const byId = new Map<string, (typeof BOT_REACTIONS)[number]>(BOT_REACTIONS.map((reaction) => [reaction.id, reaction]));

/** Choose an appropriate expression from the *bot's verified text*, not the user's prompt.
 * Risk cues take precedence: decoration must never imply a repair or booking was completed.
 */
export function botReactionFor(body: string): BotReactionId {
  const s = body.toLocaleLowerCase('ru-RU');
  if (/не продолжай движение|не продолжать движение|останови[тс]|немедленно|опасн|тормоз|рулев|возгорани|пожар/.test(s)) return 'stop';
  if (/предупрежден|осторожн|риск|внимани/.test(s)) return 'warning';
  if (/не наш[её]л|неизвестн|не смог|нет достоверн|недоступн|не подтвержд|не могу определить/.test(s)) return 'thinking';
  if (/ошибк[аи]|неисправност|код p[0-9]|spn|fmi|dtc/.test(s)) return 'diagnostic';
  if (/записан|оформлен|выполнен|готово|успешно/.test(s)) return 'done';
  if (/маршрут|дорог|навигат|проехать/.test(s)) return 'route';
  if (/сто|ремонт|мастер|сервис/.test(s)) return 'service';
  if (/ищу|поиск|найти/.test(s)) return 'search';
  if (/спасибо|благодар/.test(s)) return 'thanks';
  if (/извин|сожалени/.test(s)) return 'sorry';
  if (/доброй ночи|спокойной ночи/.test(s)) return 'night';
  if (/отличн|здорово|супер/.test(s)) return 'great';
  if (/есть идея|можно попробовать|вариант решени/.test(s)) return 'idea';
  if (/важно|обязательно/.test(s)) return 'important';
  if (/давай разбер|поясню|расскажу|объясню/.test(s)) return 'explain';
  if (/вопрос|уточни|подскажи/.test(s)) return 'question';
  if (/помогу|на связи|поддержк/.test(s)) return 'support';
  if (/привет|здорово|добрый день/.test(s)) return 'hello';
  // Stable, non-random quiet expressions for ordinary messages.
  const quiet: BotReactionId[] = ['ok', 'note', 'calm', 'explain', 'hello', 'thinking'];
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash * 31) + s.charCodeAt(i)) | 0;
  return quiet[(hash >>> 0) % quiet.length];
}

export function TrakBotMascot({
  reaction = 'hello', size = 'regular', active = false
}: { reaction?: BotReactionId; size?: 'small'|'regular'|'large'; active?: boolean }) {
  const info = byId.get(reaction) ?? BOT_REACTIONS[0];
  const face: Face = info.face;
  const happy = face === 'happy' || face === 'smile' || face === 'wink';
  const serious = face === 'serious' || face === 'worried';
  const eyesUp = face === 'curious' || face === 'focus';
  return <span className={'trakbot-mascot trakbot-mascot--' + size + ' trakbot-mascot--' + reaction + (active ? ' is-active' : '')}
    title={info.label} aria-hidden="true">
    <svg className="trakbot-mascot-truck" viewBox="0 0 124 122" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <ellipse cx="60" cy="113" rx="54" ry="6" fill="#050b16" opacity=".25"/>
      {/* Body, rear truck box and wheels: unchanged in every state. */}
      <path d="M6 47Q6 42 12 42H46V98H8Q4 98 4 92V53Q4 47 6 47Z" fill="#292e3b" stroke="#131720" strokeWidth="3"/>
      <path d="M8 82H43V91H8Z" fill="#ff7515"/>
      <path d="M10 48H35" stroke="#647181" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M9 64H26" stroke="#ff7515" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="25" cy="99" r="12" fill="#151920" stroke="#535965" strokeWidth="2"/>
      <circle cx="25" cy="99" r="5.5" fill="#bac5cd"/>
      <circle cx="85" cy="101" r="13" fill="#151920" stroke="#535965" strokeWidth="2"/>
      <circle cx="85" cy="101" r="6" fill="#bac5cd"/>
      {/* White/orange cab-over truck from approved technician concept. */}
      <path d="M37 39Q37 25 54 25H89Q112 25 116 45L119 93Q119 101 109 102H37Q30 102 30 94V54Q30 44 37 39Z"
        fill="#f3f5f6" stroke="#343b44" strokeWidth="3.2"/>
      <path d="M32 76L44 75L49 100H33Z" fill="#ff7515"/>
      <path d="M101 83L118 80L118 96L108 101H103Z" fill="#ff7515"/>
      {/* Dark work cap and trademark orange piping. */}
      <path d="M41 35Q41 15 72 14Q98 14 110 30L112 41H39Z" fill="#252a34" stroke="#181b23" strokeWidth="3"/>
      <path d="M43 38Q64 32 110 39" stroke="#ff7919" strokeWidth="5" strokeLinecap="round"/>
      <path d="M48 25H98" stroke="#585e68" strokeWidth="1.5" opacity=".6"/>
      <text x="55" y="32" fill="#fff" fontSize="9.3" fontWeight="900">Trak</text>
      <text x="76" y="32" fill="#ff7919" fontSize="9.3" fontWeight="900">SOS</text>
      {/* Windshield and its expression: only the face changes. */}
      <rect x="41" y="41" width="69" height="38" rx="11" fill="#f9fbfc" stroke="#444b57" strokeWidth="3"/>
      <path d={serious ? 'M50 53L67 57M82 57L101 53' : eyesUp ? 'M49 52Q58 45 67 52M83 52Q92 45 101 52' : 'M49 51Q58 46 67 51M83 51Q92 46 101 51'}
        stroke="#272b35" strokeWidth="3.7" strokeLinecap="round"/>
      {face === 'calm' ? <>
        <path d="M51 63Q59 67 66 63M85 63Q93 67 101 63" stroke="#212936" strokeWidth="3.3" strokeLinecap="round"/>
      </> : <>
        <ellipse cx="59" cy="64" rx="7.7" ry="9.5" fill="#fff"/>
        {face !== 'wink' && <ellipse cx="92" cy="64" rx="7.7" ry="9.5" fill="#fff"/>}
        <ellipse cx="60" cy={eyesUp ? 61 : 65} rx="4.8" ry="7" fill="#252b35"/>
        {face === 'wink' ? <path d="M85 63Q93 67 101 62" stroke="#252b35" strokeWidth="3.4" strokeLinecap="round"/> :
          <ellipse cx="93" cy={eyesUp ? 61 : 65} rx="4.8" ry="7" fill="#252b35"/>}
        <circle cx="61.6" cy={eyesUp ? 59 : 63} r="1.5" fill="#fff"/>
        {face !== 'wink' && <circle cx="94.6" cy={eyesUp ? 59 : 63} r="1.5" fill="#fff"/>}
      </>}
      {/* Grill / mouth */}
      {serious || face === 'focus' || face === 'curious'
        ? <path d={face === 'worried' ? 'M67 87Q77 82 88 88' : 'M65 87H91'} stroke="#313640" strokeWidth="3.2" strokeLinecap="round"/>
        : <path d="M64 85Q78 98 93 83Q90 94 79 95Q70 95 64 85Z" fill="#333943" stroke="#21242d" strokeWidth="1.6"/>}
      <path d="M47 98H99" stroke="#333945" strokeWidth="4.8" strokeLinecap="round"/>
      <path d="M53 105H97" stroke="#ff7515" strokeWidth="3.5" strokeLinecap="round"/>
      <rect x="37" y="91" width="16" height="7" rx="3" fill="#ffe9ae" stroke="#ffb555"/>
      <rect x="100" y="91" width="15" height="7" rx="3" fill="#ffe9ae" stroke="#ffb555"/>
      {/* Little diagnostic tablet remains the recognisable technician prop. */}
      <g transform="rotate(-8 107 92)">
        <rect x="96" y="77" width="25" height="31" rx="4" fill="#252a33" stroke="#f98422" strokeWidth="2"/>
        <path d="M101 89h3l2-4 4 7 3-3h3" stroke="#ff9d24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M102 99h13" stroke="#d6dce6" strokeWidth="2" strokeLinecap="round" opacity=".75"/>
      </g>
      <path d="M89 103Q95 96 100 99" stroke="#edf1f3" strokeWidth="6" strokeLinecap="round"/>
    </svg>
    <span className="trakbot-mascot-symbol">{info.mark}</span>
  </span>;
}

export function TrakBotReactionGallery() {
  return <details className="trakbot-reactions-gallery">
    <summary>30 живых реакций помощника</summary>
    <div className="trakbot-reactions-grid">
      {BOT_REACTIONS.map((reaction) => <div key={reaction.id} className="trakbot-reaction-item">
        <TrakBotMascot reaction={reaction.id} size="small"/>
        <span>{reaction.label}</span>
      </div>)}
    </div>
    <p className="note">Реакции меняют только оформление ответа TrakBot. Статусы заявок, диагностика и деньги от них не зависят.</p>
  </details>;
}
