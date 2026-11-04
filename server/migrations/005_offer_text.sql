-- Текст оферты хранится в приложении: видно, какую именно редакцию принял каждый.
alter table offers add column body text;
alter table offers alter column url drop not null;
