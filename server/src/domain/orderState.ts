// Машина состояний заявки. Кто какой переход может сделать.
//
// searching → accepted → en_route → arrived → working → awaiting_confirmation → completed
//                                       └──────────────────┘ (мастер может сразу назвать сумму)
// отмена возможна до completed; no_performer — никто не взял, клиент может повторить поиск.

export type OrderStatus =
  | 'searching' | 'accepted' | 'en_route' | 'arrived' | 'working'
  | 'awaiting_confirmation' | 'completed' | 'cancelled' | 'no_performer';

export type Actor = 'client' | 'performer' | 'system' | 'admin';

export type Action =
  | 'accept' | 'depart' | 'arrive' | 'start_work' | 'propose_amount'
  | 'confirm_amount' | 'dispute_amount' | 'cancel' | 'expire' | 'retry';

const table: Record<Action, { from: OrderStatus[]; to: OrderStatus; by: Actor[] }> = {
  accept: { from: ['searching'], to: 'accepted', by: ['performer'] },
  depart: { from: ['accepted'], to: 'en_route', by: ['performer'] },
  arrive: { from: ['accepted', 'en_route'], to: 'arrived', by: ['performer'] },
  start_work: { from: ['arrived'], to: 'working', by: ['performer'] },
  propose_amount: { from: ['arrived', 'working', 'awaiting_confirmation'], to: 'awaiting_confirmation', by: ['performer'] },
  confirm_amount: { from: ['awaiting_confirmation'], to: 'completed', by: ['client'] },
  dispute_amount: { from: ['awaiting_confirmation'], to: 'working', by: ['client'] },
  cancel: { from: ['searching', 'accepted', 'en_route', 'arrived', 'working', 'awaiting_confirmation', 'no_performer'], to: 'cancelled', by: ['client', 'performer', 'admin'] },
  expire: { from: ['searching'], to: 'no_performer', by: ['system'] },
  retry: { from: ['no_performer'], to: 'searching', by: ['client'] },
};

export class TransitionError extends Error {
  constructor(public action: Action, public status: OrderStatus, public actor: Actor) {
    super(`Нельзя выполнить «${action}» в статусе «${status}» от имени ${actor}`);
    this.name = 'TransitionError';
  }
}

export function transition(status: OrderStatus, action: Action, actor: Actor): OrderStatus {
  const t = table[action];
  if (!t.from.includes(status) || !(t.by.includes(actor) || actor === 'admin')) {
    throw new TransitionError(action, status, actor);
  }
  return t.to;
}

export function canDo(status: OrderStatus, actor: Actor): Action[] {
  return (Object.keys(table) as Action[]).filter((a) => table[a].from.includes(status) && table[a].by.includes(actor));
}

export const statusLabels: Record<OrderStatus, string> = {
  searching: 'Ищем исполнителя',
  accepted: 'Исполнитель принял заявку',
  en_route: 'В пути',
  arrived: 'На месте',
  working: 'Работает',
  awaiting_confirmation: 'Ждёт подтверждения суммы',
  completed: 'Готово',
  cancelled: 'Отменена',
  no_performer: 'Никто не взял заявку',
};
