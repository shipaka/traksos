# TrakSOS — аудит источников грузовой ТехБазы и дат модельных рядов
Дата проверки: **17 ноября 2026**. Ветка: \`feature/vehicle-reference-versioned-20261117\`, PR #143.

## Жёсткое разделение предметов

1. **Легковые:** только \`марка → модель\` из лицензированного каталога VehiclesDB, год можно ввести как необязательное поле владельца. Ни схемы легковых, ни ремонтные процедуры по легковым **не загружаем**. ТехБаза по VIN легковых не обещается.
2. **Грузовики и тягачи:** подробный каталог моделей, независимые свидетельства первичных регистраций, только подтверждённые даты начала производства; официальный портал производителя, профессиональные системы, EBS, ABS, электрика, пневматика, шасси, двигатель и ремонтные инструкции через официальные ссылки.
3. **Прицепы и полуприцепы:** официальные сведения производителей прицепных осей, EBS/ABS, подвески, седельно-сцепных устройств и оригинальные ссылки на мануалы. Данные о конкретном прицепе не считаются проверенными без идентификаторов изделия.
4. **Водитель:** открытые памятки безопасности и возможность обсуждать неисправности в отдельном сообществе (PR #111); **не** получает закрытые схемы, распиновки ЭБУ, алгоритмы ремонта тормозов и права профессионального специалиста.
5. **Мастер:** профессиональные ссылки доступны только после проверки роли специалиста; действующий администратор имеет доступ через свою админскую роль независимо от текущего переключателя кабинета. Не создаётся скрытого доступа по телефонному номеру.

## Лицензированная машинная база VehiclesDB

- Название: [VehiclesDB](https://vehiclesdb.com/).
- Открытая лицензия набора: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — допускает распространение, адаптацию и коммерческое использование при указании авторства, текста лицензии, ссылки на источник и изменений. **Уведомления оригинальных реестров остаются обязательными**.
- Источник и версия: [GitHub](https://github.com/vehiclesdb/vehiclesdb), \`2026.11.11\`, упакованный JSON git blob \`c83f03e1c56384d8ff58fd8667635ecac88bc2c5\`. Сводный исходный каталог грузовиков имеет git blob \`a9264a14d38e407b8ad21537e47f850745bef585\`.
- В TrackSOS \`server/data/vehiclesdb_2026_11_11.json\` хранит **8 460 моделей** — 6 000 легковых, 1 213 грузовиков, 809 фургонов, 438 автобусов. Включены 499 марок без мопедов/мотоциклов. Записи с невалидными ключами не импортированы до отдельной нормализации.
- \`server/data/vehiclesdb_truck_evidence_2026_11_11.json\` содержит **1 213 привязанных к грузовым моделям** строк источников и свидетельств: отдельные страны, обозначения оригинальных реестров, найденные даты первой регистрации и опциональные даты жизненного цикла.
- **Важное юридическое и техническое различие:** \`registration_years.first/last\` — только даты **первых регистраций**, а не фактические годы выпуска серии. Они не ограничивают выбор водителем года. \`lifecycle.year_start/year_end\` выводится только если отдельно указано в оригинальном нормализованном каталоге; в текущей грузовой части таких записей всего несколько. Никакого «официально подтверждён по VIN» и «применимая запчасть» из этой статистики не выводится.
- Полные уведомления об авторах исходных реестров: \`server/data/vehiclesdb_ATTRIBUTION.md\`. Лицензия \`server/data/vehiclesdb_LICENSE.txt\`. В UI обязательно оставлять «Vehicle data by VehiclesDB» + ссылку, а также доступ к уведомлениям и дату версии. Уведомления нельзя удалять даже при платной лицензии на бренд VehiclesDB.

## Два режима источников

**РЕЖИМ A — \`LICENSE_VERIFIED\`**. Произведения из Wikimedia Commons, где на странице файла указаны автор, конкретная открытая лицензия, постоянная ссылка, источник и условия. В карточке сохраняются автор и лицензия; если оригинал модифицирован, требуется указать, что именно изменено, а для CC BY-SA выполнить условия ShareAlike.

Уже проверенные:
- [Alternator_1.svg](https://commons.wikimedia.org/wiki/File:Alternator_1.svg) — Egmason, CC BY 3.0, общая учебная схема, **не** автомобильная электросхема.
- [Differential_gear_(PSF).png](https://commons.wikimedia.org/wiki/File:Differential_gear_(PSF).png) — Pearson Scott Foresman, передано в public domain, схема дифференциала.
- [AANSLUITSCHEMA_ALTERNATOR-geconverteerd(1).pdf](https://commons.wikimedia.org/wiki/File:AANSLUITSCHEMA_ALTERNATOR-geconverteerd(1).pdf) — IstasRené, CC BY-SA 4.0, учебная авторская схема подключения генератора.
- Файл \`Diesel_technology_-_SCR.svg\` имеет пометку Commons CC BY-SA 4.0 и автора Cjp24, **но в качестве источника указан материал VDA**. До отдельной проверки производного права он находится в \`hold_upstream\` и **не появляется пользователям**.

**РЕЖИМ B — \`LINK_VERIFIED\` / \`LINK_ONLY\`**. Производитель сам публикует портал или документы, но **право на просмотр и скачивание не равно праву на сохранение, зеркалирование, перепродажу и распространение в TrackSOS**. Поэтому сохраняем только URL портала, проверенный владелец, дату, категории, модельные семейства, регион и сведения о регистрации/оплате. PDF и OEM электрические схемы остаются на стороне производителя.

## Официальные ресурсы (25 ссылок в каталог)

Точный JSON-реестр с метаданными: \`server/data/vehicle_technical_sources.json\`.
Каждая запись содержит URL, \`owner\`, \`rights\`, \`sourceStatus\`, \`checkedOn\`,
\`vehicleClasses\`, \`subsystem\`, \`region\`, \`modelFamilyKeywords\`,
\`documentSections\`, \`confirmedFitment=false\`, ограничения доступа.
Система отказывает в заявлении о применимости без отдельной проверки модели, года, VIN, двигателя, блока EBS и редакции инструкции.

| Изготовитель | Официальный ресурс и что искать | Особенности |
|---|---|---|
| Scania | [Bodybuilder](https://bodybuilder.scania.com/trucks/en/home.html), [RMI/TIS/SWS](https://www.scania.com/group/en/home/products-and-services/services/rmi/scania-rmi-portal.html), [пакет документации](https://www.scania.com/group/en/home/products-and-services/services/rmi/information-package.html) | SWS/электросхемы с проверкой шасси, лицензируемый доступ |
| Volvo Trucks | [Европейские Bodybuilder Instructions](https://www.volvotrucks.co.uk/en-gb/trucks/features/bodybuilding.html), [североамериканские схемы](https://www.volvotrucks.ca/en-ca/parts-and-services/services/body-builder-support/wiring-diagrams/) | США/Канада **не** равны европейским FH/FM; у Volvo прямо указан запрет воспроизведения без разрешения |
| Mercedes-Benz Trucks | [Bodybuilder Portal](https://bb-portal.mercedes-benz-trucks.com/en/GLOBAL), [RMI/XENTRY](https://service-info-int.mercedes-benz-trucks.com/eu/en/technical-publishing.html) | Actros/Arocs/Atego, часть документов платная |
| MAN | [MANTED, ABBI, сервисный портал](https://www.man.eu/bodybuilder/en/bodybuilder/portals.html) | TGX/TGS/TGM/TGL, ограничения доступа |
| DAF | [Bodybuilder Information](https://www.dafbbi.com/en), [RMI/PACCAR](https://rmi.daf.com/en/faq-rmi/general) | BBI выделяет \`MY2005\`, \`MY2017\`, New Generation — **разделы каталога**, не универсальные диапазоны выпуска |
| Renault Trucks | [Bodybuilder](https://bodybuilder.renault-trucks.com/en/user/login) | Обычно требуется VIN/номер заказа и аккаунт |
| IVECO | [Body Builder Site](https://newibb.iveco.com/en/Pages/Home.aspx) | Официальная документация, доступ по правилам производителя |
| Knorr-Bremse | [TruckServices](https://truckservices.knorr-bremse.com/en/de/products/technical-documentation/), [кабинет](https://mytruckservices.knorr-bremse.com/) | iTEBS X, SyD7, сервисные системы, поиск по компоненту |
| ZF / WABCO | [ZF Technical Information](https://aftermarket.zf.com/us/aftermarket-portal/our-catalog/technical-information/), [WABCO Solution Centre](https://wabco-solutioncentre.com/en_US/cc/aftermarket-service-and-support/) | EBS/ABS и сервисные инструкции, регион и версия блока критичны |
| BPW | [Download Center](https://www.bpw.de/en/service/downloads), [осевые расчёты/чертежи](https://www.bpw.co.uk/services-and-support/technical) | Оси и подвеска полуприцепов, различие модификаций |
| SAF-HOLLAND | [Download Center](https://safholland.com/us/en/service/download-center) | Североамериканские руководства, не переносить на ЕС/РФ |
| JOST | [Библиотека](https://production.jost-world.com/en/products/pdf-downloads/), [ремонтные ссылки](https://service-and-parts.jost-world.com/en/technicalsupportcentre/repair-solutions.html) | Седла, сцепки, опорные стойки, подбор по серии |
| Schmitz Cargobull | [Сервисный портал](https://www.cargobull-serviceportal.de/applications/serviceportal/default.aspx) | Прицепы/полуприцепы, часть разделов для партнёров |
| Haldex | [Trailer Application Guide](https://www.haldex.com/en/europe/trailer-application-guide/), [документация](https://www.haldex.com/en/europe/services/technical-documentation/) | EB+ Gen3/4.0, ABS/EBS, исходная схема требует проверки |

В сумме **25 индивидуальных OEM ссылок** (включая отдельные порталы и зеркала тематик), **3 открыто лицензированных учебных изображения/документа** и **1 запись на юридической проверке**.

## Граница применения и контроль публикации

- Публикуем только проверенные карточки \`sourceStatus=link_verified | license_verified\`; \`hold_upstream\` не проходит фильтр сервера и не отображается даже администратору как уже разрешённый документ.
- Ни один индекс производителя не является подтверждением применимости «точно по этой машине». \`confirmedFitment=false\` во всех карточках.
- Таблица документаций DAF \`MY2005\`, \`MY2017\` — редакции по разделам производителя; не фиксируем их как границы выпуска каждой машины.
- Детальные записи о грузовой модели доступны через отдельный API \`/api/vehicle-reference/truck-evidence\`. По легковым такого API нет и подробные технические поля не создаются.
- Водитель не получает OEM-порталы: ему показываются только короткие памятки безопасности. Роль мастера проверяется по статусу подтверждения, администратор — по действующим реальным ролям пользователя, без исключений по номеру или устройству.
- На следующем этапе PR #111 объединить две ТехБазы и дедуплицировать карточки по каноническому URL + автор/лицензия. **Не сливать #143 и #111 без ручного разрешения конфликтов** в формах и маршрутах.
- Нужны отдельные права правообладателя для хранения OEM PDF, каталогов распиновок и оригинальных заводских схем в самом TrackSOS. Пока доступны только авторизованные переходы на сайты производителей.
- Заявка на отсутствующую модель уходит админу и не публикуется автоматически. Архив действующих автомобилей не переписывается.

## Проверки

В общем CI после большого пакета:
- доменные unit-тесты с real PostgreSQL и проверкой ролей, лицензий, отказа в копировании, закрытия \`hold_upstream\`;
- тесты контрактов \`truck-evidence\`, производителя и источника дат первой регистрации;
- web сборка, Android debug APK и эмуляторы, smoke;
- нагрузка 200 смешанных ролей в изолированной среде.

**Важно:** это GitHub PR, а не подтверждение публикации на рабочем VPS.
