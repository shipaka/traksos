-- All geocoded candidates remain unpublished until explicit review.
alter table sto_directory_sites add column geocode_source text;
alter table sto_directory_sites add column geocode_accuracy text check(geocode_accuracy in ('entrance','building','parcel'));
alter table sto_directory_sites add column geocoded_at timestamptz;
alter table sto_directory_sites add column geocode_matched_address text;
insert into sto_directory_sites(id,name,address,phone,category,lat,lng,services,hours,source) values
('directory:wash-avtoteh-kalinovka','Авто-Тех-Сервис — грузовая мойка','Московская область, г. Видное, д. Калиновка, 4с5','+79057341949','wash',55.523458,37.743238,'["Грузовая мойка","Мойка тягачей и полуприцепов"]'::jsonb,'Круглосуточно (по сайту); заезд по пропуску','https://gruzzmoika.ru/'),
('directory:terra-truck-shushary','Terra Truck','Санкт-Петербург, Шушары, ул. Ленина, 23','+78124562628','sto',59.8037,30.3985,'["Грузовое СТО","Грузовая мойка","Мойка прицепов и полуприцепов"]'::jsonb,'Ежедневно 09:00–21:00 (по сайту)','https://terratruck.ru/servis/mojka-gruzovikov.html'),
('directory:wash-kondratenko-spb','Грузовая автомойка — Кондратенко','Санкт-Петербург, ул. Кондратенко, 3, лит. Б','+78129486366','wash',59.88552,30.338839,'["Грузовая мойка"]'::jsonb,'Круглосуточно (по справочнику)','https://urbanplaces.su/ru_sankt-peterburg/sankt-peterburg/card-1931809-gruzovaya-avtomojka'),
('directory:wash-energetikov-spb','Грузовая автомойка — Энергетиков','Санкт-Петербург, просп. Энергетиков, 19В','+79523678720','wash',59.94499,30.437155,'["Грузовая мойка"]'::jsonb,'Круглосуточно (по справочнику)','https://urbanplaces.su/ru_sankt-peterburg/sankt-peterburg/card-1931321-avtomojka-gruzovogo-i-legkovogo-transporta'),
('directory:wash-prom-perm','Автомойка грузовых автомобилей — Промышленная','Пермский край, Пермь, ул. Промышленная, 137А','+73422039100','wash',57.919719,56.172051,'["Грузовая мойка"]'::jsonb,'Круглосуточно (по справочнику)','https://urbanplaces.su/ru_permskij-kraj/perm-gorodskoj-okrug-perm/card-1528011-avtomojka-dlya-gruzovyih-avtomobilej'),
('directory:wash-m4-lenina','Грузовая автомойка — М4, 1077 км','Ростовская область, хутор Ленина, трасса М4, 1077 км, 4','+79286021020','wash',47.118256,39.855861,'["Грузовая мойка"]'::jsonb,'Круглосуточно (по справочнику)','https://urbanplaces.su/ru_rostovskaya-oblast/aksajskij-rajon-h-lenina/card-4250333-avtomojka'),
('directory:wash-atp-spb','АТП — грузовая мойка','Санкт-Петербург, ул. Автомобильная, 8, лит. В','+79379449408','wash',null,null,'["Грузовая мойка","Химчистка кабин"]'::jsonb,'Круглосуточно (по сайту)','https://avtomoyka-atp15.ru/truck')
on conflict(id) do nothing;
