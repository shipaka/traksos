-- Dedicated ECU club: experts in truck control units can consult peers
-- without creating a second login role or exposing customer orders.
-- No fabricated members, posts, service coverage or verified manuals.
insert into community_rooms(slug,title,kind,audience,specialty)
values ('ecu-pro','ЭБУ и электронные блоки грузовиков','professional','professional','ecu')
on conflict(slug) do nothing;
