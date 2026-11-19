-- TrakBot pilot: private conversations and a licensed, provenance-aware DTC catalogue.
-- No public-feed hooks, no paid charges and no manufacturer-specific guessing.
create table if not exists diagnostic_codes (
  protocol text not null default 'OBD2',
  make text not null default 'GENERIC',
  ecu text not null default '',
  code text not null,
  title_en text not null,
  title_ru text,
  detail_en text,
  detail_ru text,
  causes jsonb not null default '[]'::jsonb,
  symptoms jsonb not null default '[]'::jsonb,
  source_url text not null,
  source_license text not null,
  review_state text not null default 'unverified',
  updated_at timestamptz not null default now(),
  primary key (protocol, make, ecu, code)
);
create index if not exists diagnostic_codes_code_lookup on diagnostic_codes (code);
create table if not exists trakbot_messages (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check(role in ('user','bot')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists trakbot_messages_user_history on trakbot_messages(user_id, id desc);

-- Original concise Russian explanations, not copied from a manufacturer manual.
-- External imported records never overwrite this small manually curated pilot.
insert into diagnostic_codes(protocol,make,ecu,code,title_en,title_ru,detail_ru,source_url,source_license,review_state)
values
('OBD2','GENERIC','','P0087','Fuel rail/system pressure too low','Низкое давление в топливной рампе','Блок фиксирует давление топлива ниже ожидаемого. Код сам по себе не доказывает неисправность насоса или форсунок.','TrakSOS pilot editorial','original','pilot'),
('OBD2','GENERIC','','P0299','Turbocharger/supercharger underboost','Недостаточное давление наддува','Фактический наддув ниже требуемого. Причину нельзя установить по одному коду.','TrakSOS pilot editorial','original','pilot'),
('OBD2','GENERIC','','P0300','Random/multiple cylinder misfire detected','Пропуски воспламенения в нескольких цилиндрах','Зафиксированы пропуски воспламенения. Причины могут различаться в зависимости от двигателя и условий.','TrakSOS pilot editorial','original','pilot'),
('OBD2','GENERIC','','P0401','Exhaust gas recirculation insufficient flow','Недостаточный поток EGR','Блок обнаружил недостаточный поток рециркуляции отработавших газов. Причина требует проверки.','TrakSOS pilot editorial','original','pilot'),
('OBD2','GENERIC','','P0420','Catalyst system efficiency below threshold','Низкая эффективность каталитической системы','Контроль эффективности каталитической системы выявил отклонение. Это не является однозначным указанием на замену катализатора.','TrakSOS pilot editorial','original','pilot'),
('OBD2','GENERIC','','P0562','System voltage low','Низкое напряжение бортовой сети','Напряжение питания оказалось ниже порога, заложенного в блоке. Уточните условия появления кода и состояние электропитания.','TrakSOS pilot editorial','original','pilot'),
('OBD2','GENERIC','','U0100','Lost communication with ECM/PCM','Потеря связи с блоком двигателя','Другой блок сообщает о потере связи с электронным блоком управления двигателем. Нужна проверка контекста сети и питания.','TrakSOS pilot editorial','original','pilot'),
('OBD2','GENERIC','','P0101','Mass or volume air flow circuit range/performance','Недостоверный сигнал расходомера воздуха','Измерение расхода воздуха не соответствует ожидаемым параметрам. Источник отклонения требует диагностики.','TrakSOS pilot editorial','original','pilot'),
('OBD2','GENERIC','','P0191','Fuel rail pressure sensor circuit range/performance','Недостоверный сигнал датчика давления топлива','Сигнал датчика давления топлива выходит за ожидаемую зависимость. Не означает автоматически неисправность самого датчика.','TrakSOS pilot editorial','original','pilot'),
('OBD2','GENERIC','','P0201','Injector circuit cylinder 1','Неисправность электрической цепи форсунки цилиндра 1','Зафиксирована электрическая неисправность цепи форсунки первого цилиндра. Требуется уточнение двигателя и блока управления.','TrakSOS pilot editorial','original','pilot')
on conflict do nothing;
