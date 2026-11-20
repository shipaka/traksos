-- A small, usable set of specialist clubs for the professions already
-- registered in TrakSOS. No fabricated messages, members or demand.
-- Keep the nationwide driver rooms separate from these closed discussions.
insert into community_rooms(slug,title,kind,audience,specialty) values
 ('diag-pro','Профессиональная диагностика','professional','professional','diag'),
 ('pneumatic-pro','Пневматика и тормоза','professional','professional','air'),
 ('engine-pro','Двигатели грузовиков','professional','professional','engine'),
 ('autonomy-pro','Автономные отопители','professional','professional','autonomy'),
 ('tow-pro','Профессиональные эвакуаторщики','professional','professional','tow'),
 ('service-pro','Клуб СТО и рембаз','professional','professional','service')
on conflict(slug) do nothing;
