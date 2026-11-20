-- Supplier technical reference portals for commercial-truck and trailer
-- braking systems, verified from their OFFICIAL sites on 2026-11-17.
-- Link-only: no WABCO/ZF, Knorr-Bremse or Haldex OEM PDFs are copied.
insert into community_knowledge_sources
(slug,title,source_kind,coverage,make,model,subsystem,description,safety_note,
 tags,source_url,preview_url,attribution_author,license_code,license_url,
 rights_verified_on,technical_status) values
('zf-wabco-tech-downloads',
 'ZF / WABCO: официальные руководства по EBS, ABS и датчикам',
 'manufacturer_portal','manufacturer','ZF',null,'Тормоза / EBS',
 'Официальная страница ZF Commercial Vehicles с техническими публикациями WABCO, включая EBS, ABS, датчики скорости колёс и прицепные системы. Это внешние ссылки; доступность, регион и допустимость перепубликации проверяются у ZF.',
 'Официальный портал правообладателя, а не разрешение копировать заводские PDF. Подбирайте точную систему по шильдику, номеру блока и актуальной ревизии документа.',
 array['zf','wabco','ebs','abs','тормоза','датчик скорости','прицеп','диагностика']::text[],
 'https://www.zf.com/products/en/cv/footer/downloads/downloads.html',null,
 'ZF Friedrichshafen AG','LINK_ONLY',null,date '2026-11-17','portal_link'),
('knorr-bremse-tech-manuals',
 'Knorr-Bremse: техдокументация по тормозным системам',
 'manufacturer_portal','manufacturer','Knorr-Bremse',null,'Тормоза / EBS',
 'Официальный портал TruckServices для сервисных руководств, программ диагностики и технических бюллетеней Knorr-Bremse. Часть документов и сервисов доступна через регистрацию в кабинете правообладателя.',
 'Публикуем только внешний адрес. Не используйте руководство для другого поколения EBS/ECU или типоразмера тормоза без подтверждённой маркировки изделия.',
 array['knorr','knorr-bremse','ebs','пневматика','тормоза','диагностика','суппорт']::text[],
 'https://truckservices.knorr-bremse.com/en/gb/services/technical-documentation/',null,
 'Knorr-Bremse TruckServices','LINK_ONLY',null,date '2026-11-17','portal_link'),
('haldex-trailer-tag',
 'Haldex: Trailer Application Guide, EBS/ABS прицепов',
 'manufacturer_portal','manufacturer','Haldex',null,'Прицепы / EBS',
 'Официальный справочник Haldex по тормозам прицепов, Trailer EBS EB+, ABS, пневматическим системам и диагностике. Версии EB+ и конкретные подключения различаются — выбирайте документацию только по маркировке компонента.',
 'Схемы остаются на сайте Haldex; TrackSOS не копирует PDF и не подменяет заводскую проверку применимости. Доступность зависит от региона и условий портала.',
 array['haldex','eb+','ebs','abs','прицеп','saf-holland','пневматика','схемы']::text[],
 'https://www.haldex.com/en/europe/trailer-application-guide/',null,
 'Haldex / SAF-HOLLAND','LINK_ONLY',null,date '2026-11-17','portal_link')
on conflict (slug) do nothing;
