// Unified, presentation-only insurance status language for client, partner and garage.
// This module never changes order state, payments, offers, identity or authorizations.
export const INSURANCE_STAGES = [
  'received', 'preparing', 'offers_sent', 'selected', 'processing', 'policy_sent',
] as const;

export type InsuranceStage = typeof INSURANCE_STAGES[number];
export type InsuranceTone = 'waiting' | 'working' | 'action' | 'done' | 'alert';

type InsuranceMessage = {
  label: string;
  detail: string;
  tone: InsuranceTone;
  next: string;
};

const client: Record<InsuranceStage, InsuranceMessage> = {
  received: {
    label: 'Заявка отправлена страховому агенту',
    detail: 'Анкета получена системой и передана выбранному партнёру. Ожидаем начала расчёта.',
    tone: 'waiting', next: 'Следующий этап — агент проверит анкету',
  },
  preparing: {
    label: 'Агент готовит предложения',
    detail: 'Страховой партнёр принял заявку и рассчитывает доступные варианты вручную.',
    tone: 'working', next: 'Следующий этап — сравнение предложений',
  },
  offers_sent: {
    label: 'Предложения готовы — выберите вариант',
    detail: 'Страховые компании и цены появились в этом деле. Выберите подходящий вариант для оформления.',
    tone: 'action', next: 'Нужен ваш выбор',
  },
  selected: {
    label: 'Вы выбрали страховое предложение',
    detail: 'Ваш выбор передан агенту. Ожидаем подтверждения и начала оформления.',
    tone: 'waiting', next: 'Следующий этап — оформление полиса',
  },
  processing: {
    label: 'Полис оформляется',
    detail: 'Агент оформляет документы в страховой компании и подготовит итоговый PDF.',
    tone: 'working', next: 'Следующий этап — готовый полис',
  },
  policy_sent: {
    label: 'Полис готов',
    detail: 'Агент прикрепил PDF. Откройте дело и скачайте готовый полис.',
    tone: 'done', next: 'Скачайте документ и проверьте данные',
  },
};
const partner: Record<InsuranceStage, InsuranceMessage> = {
  received: {label:'Получена новая заявка',detail:'Клиент передал анкету грузовика. Проверьте данные и примите дело в работу.',tone:'action',next:'Примите заявку для расчёта'},
  preparing: {label:'Подготовка предложений',detail:'Рассчитайте варианты и отправьте их клиенту. Расчёт выполняется вручную.',tone:'working',next:'Отправьте варианты страхования'},
  offers_sent: {label:'Предложения отправлены клиенту',detail:'Ждём, пока клиент изучит цены и подтвердит подходящий вариант.',tone:'waiting',next:'Ожидаем выбора клиента'},
  selected: {label:'Клиент выбрал страховой вариант',detail:'Предложение подтверждено клиентом. Примите его и начните оформление полиса.',tone:'action',next:'Примите выбранный вариант'},
  processing: {label:'Полис на оформлении',detail:'Завершите оформление у страховой компании и прикрепите итоговый PDF.',tone:'working',next:'Загрузите готовый полис'},
  policy_sent: {label:'Полис отправлен клиенту',detail:'PDF-полис прикреплён в дело. Клиент может скачать документ.',tone:'done',next:'Документ доступен клиенту'},
};
const generic: Record<string, InsuranceMessage> = {
  submitted:{label:'Заявка подана',detail:'Заявка зарегистрирована в TrakSOS и ожидает дальнейшего рассмотрения.',tone:'waiting',next:'Ожидается проверка заявки'},
  in_review:{label:'Заявка на рассмотрении',detail:'Специалист проверяет сведения для передачи заявки партнёру.',tone:'working',next:'Ожидается решение специалиста'},
  need_documents:{label:'Нужны дополнительные документы',detail:'Для продолжения проверьте запрос и комментарий специалиста.',tone:'action',next:'Предоставьте запрошенные сведения'},
  sent_to_partner:{label:'Заявка передана страховому агенту',detail:'Партнёр получил заявку и приступит к обработке.',tone:'waiting',next:'Ожидается ответ агента'},
  completed:{label:'Заявка завершена',detail:'Услуга отмечена выполненной. Проверьте документы и историю.',tone:'done',next:'Проверьте результаты'},
  rejected:{label:'По заявке получен отказ',detail:'Посмотрите комментарий специалиста и причину решения.',tone:'alert',next:'Проверьте причину отказа'},
  cancelled:{label:'Заявка отменена',detail:'Заявка не обрабатывается.',tone:'alert',next:'Можно подать новую заявку'},
};

export function insurancePresentation(
  insuranceStage: string | null | undefined,
  serviceStatus?: string | null,
  audience: 'client' | 'partner' = 'client',
): InsuranceMessage {
  if (serviceStatus === 'rejected' || serviceStatus === 'cancelled')
    return generic[serviceStatus];
  if (insuranceStage && INSURANCE_STAGES.includes(insuranceStage as InsuranceStage))
    return (audience === 'partner' ? partner : client)[insuranceStage as InsuranceStage];
  // Legacy manually assigned requests don't have a multi-step insurance stage.
  // Keep their historical business labels while making the partner's next action clear.
  if (audience === 'partner' && serviceStatus === 'completed')
    return {...generic.completed,label:'Полис оформлен'};
  if (audience === 'partner' && serviceStatus === 'sent_to_partner')
    return {label:'Новая заявка ожидает решения',detail:'Откройте заявку, проверьте документы и определите следующий шаг.',tone:'action',next:'Рассмотрите поступившую заявку'};
  return generic[serviceStatus || 'submitted'] ?? generic.submitted;
}

export function insuranceStepIndex(stage: string | null | undefined): number {
  return INSURANCE_STAGES.indexOf(stage as InsuranceStage);
}


/**
 * Presentation-only queue grouping. Distinguishes items awaiting the agent's
 * decision from items already in process, without changing persisted statuses.
 * Legacy non-threaded partner cases remain actionable.
 */
export type InsuranceQueueGroup = 'action' | 'active' | 'closed';
export function insuranceQueueGroup(
  stage: string | null | undefined,
  status: string | null | undefined,
): InsuranceQueueGroup {
  if (status === 'completed' || status === 'rejected' || status === 'cancelled')
    return 'closed';
  if (stage === 'received' || stage === 'selected' || !stage)
    return 'action';
  return 'active';
}

export function isOpenInsuranceRequest(status: string | null | undefined): boolean {
  return status !== 'completed' && status !== 'rejected' && status !== 'cancelled';
}
