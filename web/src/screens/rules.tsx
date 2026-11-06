// Правила площадки — для всех; исполнителю — его комиссия и подтверждённые нарушения. Оспорить — всегда открыто.
import { useState } from 'react';
import { get } from '../api.ts';
import { useLoad, useMe, Back } from '../ui.tsx';
import { usePrices } from './client.tsx';

type Item = [string, string];

export function Rules() {
  const { me, mode } = useMe();
  const { pricing: p } = usePrices();
  const st = useLoad(() => (mode === 'performer' ? get('/api/performer/standing') : Promise.resolve(null)), [mode]);
  const [open, setOpen] = useState<string | null>(null);
  const common: Item[] = [
    ['Работает тот, кто прошёл проверку', 'Исполнители проходят проверку: паспорт, ИНН, фото машины и инструмента. Рембазы — ИНН компании, вывеска, въезд и ремзона. Без проверки заявки не приходят.'],
    ['Честно к обеим сторонам', 'Оценивают друг друга обе стороны. Оспорить можно любой отзыв о себе и любое ограничение — модератор смотрит заявку, суммы и чат и решает. Неподтверждённые споры никому не идут в минус.'],
    ['Работа мимо площадки', 'Номера в чате скрываются. Договорённости оплатить мимо площадки нарушают правила: при споре вас нечем защитить — нет ни переписки, ни подтверждённой суммы.'],
    ['Сверка работ', 'После работы клиент видит перечень, который указал исполнитель, и подтверждает его. Если сделано не то или больше согласованного — открывается спор.'],
    ['Персональные данные', 'Данные хранятся в России. Скачать, исправить или удалить — в «Персональных данных» в профиле.'],
  ];
  const performer: Item[] = [
    ['Как считается комиссия', `С заказов через ТракSOS удерживается ${p?.performerCommissionPct ?? 5}%. За наличные — долг по комиссии; при долге выше лимита новые заявки не приходят, пока не погасите.`],
    ['Неприезд — самое серьёзное нарушение', 'Взяли заявку — приезжайте. Не можете — нажмите «Не смогу приехать» как можно раньше: клиенту сразу найдём другого. Неприезд без предупреждения снижает рейтинг и уровень.'],
    ['Опоздания', 'Обещанное время — ваше время на сборы плюс дорога. Задерживаетесь — «Опаздываю»: клиент увидит новое время.'],
    ['Консультации и точность подсказок', 'Ошибка по телефону — не нарушение. Точность считается сама по отметкам мастеров на выезде и видна только вам.'],
    ['Что влияет на порядок в поиске', 'Знание марки клиента, рейтинг, расстояние, цена и опыт. Избранные клиенты видят вас первыми.'],
    ['Распорядок и вызовы', 'Заявки приходят в рабочие часы распорядка. В конце дня вас снимает с линии само — до утра или пока не выйдете сами.'],
    ['Если клиент не заплатил', 'Откройте спор из заявки или напишите в поддержку — модератор разберётся. Клиента можно отметить «Не брать» — его заявки к вам больше не придут.'],
  ];
  const sections: [string, Item[]][] = mode === 'performer' ? [['Исполнителю', performer], ['Для всех', common]] : [['Для всех', common]];
  const d = st.data;
  return (
    <main>
      <Back to={mode === 'performer' ? 'work/me' : 'profile'} label="Назад" />
      <div><h1>Правила площадки</h1><div className="sub">Коротко и по делу. Полный текст — в оферте{mode === 'performer' ? ' и агентском договоре' : ''}.</div></div>
      {mode === 'performer' && d && (
        <div className="grid2">
          <div className="card tile"><span className="label">Ваша комиссия</span><span className="tile-value">{p?.performerCommissionPct ?? 5}%</span></div>
          <div className="card tile"><span className="label">Нарушений за 90 дней</span><span className="tile-value" style={{ color: d.drops + d.lostDisputes ? 'var(--warn)' : undefined }}>{d.drops + d.lostDisputes}</span><span className="note">неприезды и проигранные споры</span></div>
        </div>
      )}
      {sections.map(([title, items]) => (
        <div key={title} className="stack">
          <span className="label">{title}</span>
          {items.map(([h, t]) => (
            <div key={h} className="card">
              <button className="between" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, textAlign: 'left', font: 'inherit' }} aria-expanded={open === h} onClick={() => setOpen(open === h ? null : h)}>
                <b>{h}</b><span aria-hidden="true">{open === h ? '−' : '+'}</span>
              </button>
              {open === h && <span className="note" style={{ color: 'var(--fg)', lineHeight: 1.5 }}>{t}</span>}
            </div>
          ))}
        </div>
      ))}
      {me && <a className="btn ghost" href="#/appeal">Оспорить нарушение или блокировку</a>}
      <a className="note" href="#/offer/client">Оферта для клиентов</a>
      {(mode === 'performer' || mode === 'service') && <a className="note" href="#/offer/performer">Агентский договор</a>}
    </main>
  );
}
