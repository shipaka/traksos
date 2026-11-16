const LABELS: Record<string, string> = {
  created: 'Заявка создана',
  owner_approval_requested: 'Запрошено подтверждение владельца',
  owner_approved: 'Владелец подтвердил заявку',
  owner_rejected: 'Владелец отклонил заявку',
  dispatch_started: 'Начался поиск исполнителя',
  ringing: 'Исполнителю отправлен вызов',
  accepted: 'Исполнитель принял заявку',
  depart: 'Исполнитель отметил выезд',
  arrive: 'Исполнитель отметил прибытие',
  start_work: 'Исполнитель отметил начало работы',
  amount_proposed: 'Исполнитель предложил итоговую стоимость',
  amount_confirmed: 'Стоимость подтверждена',
  amount_disputed: 'Открыт спор по стоимости',
  consult_finished: 'Консультация завершена',
  completed: 'Заявка завершена',
  finish: 'Исполнитель отметил завершение работы',
  confirm: 'Клиент подтвердил завершение',
  cancelled: 'Заявка отменена',
  retry: 'Поиск исполнителя запущен повторно',
  performer_dropped: 'Исполнитель отказался от выезда',
};
type Event = { type: string; created_at: string; actor_id?: string | null; data?: unknown };
export function OrderTimeline({ events, createdAt, acceptedAt, arrivedAt, completedAt, isAdmin }: {
  events?: Event[]; createdAt?: string; acceptedAt?: string | null;
  arrivedAt?: string | null; completedAt?: string | null; isAdmin: boolean;
}) {
  const entries = (events ?? []).filter(e => e && Object.prototype.hasOwnProperty.call(LABELS, e.type) &&
    typeof e.created_at === 'string' && !Number.isNaN(Date.parse(e.created_at)))
    .map(e => ({ label: LABELS[e.type], at: e.created_at, source: 'event' }));
  // Legacy orders may have timestamps but no corresponding event.
  // Do not fabricate a button press: clearly identify stored status timestamps.
  const legacy = [
    { label: 'Заявка создана', at: createdAt, event: 'created' },
    { label: 'Заявка принята исполнителем', at: acceptedAt, event: 'accepted' },
    { label: 'Зафиксировано прибытие', at: arrivedAt, event: 'arrive' },
    { label: 'Заявка завершена · время из статуса', at: completedAt, event: 'amount_confirmed' },
  ];
  for (const item of legacy) {
    const matching = item.event === 'amount_confirmed'
      ? ['amount_confirmed', 'completed', 'confirm'] : [item.event];
    if (item.at && !Number.isNaN(Date.parse(item.at)) && !(events ?? []).some(e => e && matching.includes(e.type) &&
      typeof e.created_at === 'string' && !Number.isNaN(Date.parse(e.created_at)))) {
      entries.push({ label: item.label.includes('время из статуса') ? item.label : item.label + ' · время из статуса', at: item.at, source: 'status' });
    }
  }
  // Stable ordering preserves server event order when timestamps are equal.
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const timeLabel = (at: string) => {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? 'Время не определено' :
      new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
  };
  return <section className="card stack" aria-label="Хронология этапов заявки">
    <div className="between"><b>Хронология заявки</b><span className="pill">Серверные отметки</span></div>
    <p className="note">Время записано сервером и показано в часовом поясе устройства. Нажатие кнопки и фактическое прибытие — разные вещи; спорные события требуют проверки.</p>
    {!entries.length ? <p className="note">Событий пока нет.</p> :
      <ol className="tl">{entries.map((entry, index) => <li key={index}>
        <i className={index === entries.length - 1 ? 'now' : 'ok'}/>
        <div><b>{entry.label}</b>
          <small style={{display:'block'}}>{timeLabel(entry.at)}</small>
          {isAdmin && entry.source === 'status' && <small>Восстановлено из сохранённого статуса</small>}
        </div>
      </li>)}</ol>}
  </section>;
}
