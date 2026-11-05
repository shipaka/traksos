-- Настройки исполнителя из демо: наценки, ожидание, предоплата, отпуск, что всегда с собой;
-- эвакуатор — что берёт, тип, максимальная масса, «отвечаю за время на сборы»
alter table performer_profiles add column if not exists extras jsonb not null default '{}';
