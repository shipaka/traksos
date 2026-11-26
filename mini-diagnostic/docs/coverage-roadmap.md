# Реестр целевых систем Mini Diagnostic — 26.11.2026

Владелец разрешил расширять список максимально на основании доступной документации; необходимо сообщать конкретные системы. 26 именованных европейских/китайских систем и поколений в основной исследовательской области, 2 китайских кандидата без точной модели и 2 американских направления (всего 30 строк реестра). Не рекламировать эти строки как совместимость. Точный список и источники также в CoverageRoadmap.kt. Программный реестр не подключён к выбору активного диагностического профиля.

| Производитель | Системы | Состояние |
|---|---|---|
| WABCO / ZF | TEBS D/E | Частичный справочник отображаемых кодов SmartBoard, сырые DTC и транспорт не подтверждены |
| WABCO / ZF | TEBS C, iEBS | Найдена документация о системах; протокол не реализован |
| WABCO / ZF | Vario C, VCS, VCS II | Изучать диагностический интерфейс отдельно |
| Knorr-Bremse | TEBS G2.0/G2.1/G2.2, iTEBS X | Документация о системах; протоколы и коды не реализованы |
| Knorr-Bremse | TEBS4 (CAN и K-line изучать раздельно), A18, KB3-TA, KB4-TA, KB4-TA D | Отдельная проверка физического интерфейса |
| Haldex | EB+ Gen1/Gen2/Gen3/4.0 | Документация диагностических средств; совместимость с нашей розеткой не подтверждена |
| Haldex | U-ABS, ABS 4.0, MODAL, MODULAR, MGX | Интерфейсы исследовать раздельно |
| VIE | TEBS | Найдены руководства; протокол и каталог не реализованы |
| KORMEE, SORL | Точные модели прицепных систем ещё не установлены | Кандидаты, не заявлять поддержку |
| Bendix, Haldex | TABS-6, PLC Select/Plus | Будущий рынок; не считать подходящими для 24 В и ISO 7638 |

Приоритет первой аппаратной версии: WABCO D/E, Knorr G2, VIE TEBS, Haldex EB+; затем современные iEBS/iTEBS X/EB+4.0 и старые ABS при наличии совместимого физического интерфейса. Список приоритетов — инженерное решение для ограничения стоимости. Не добавлять K-line/PLC/12 В без отдельного согласования электрической части. Разъём ISO 7638 сам по себе не подтверждает доступность CAN или диагностики. Для каждого будущего профиля необходимы источник, точная идентификация ЭБУ, электрический интерфейс, транспорт, запрос/ответ и проверка на стенде. Чтение и очистка проверяются раздельно; очистка только после ремонта, без параметрирования или активации тормозов. Ни одна система ещё не подтверждена на нашем устройстве.

Источники: [ZF iEBS](https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/), [ZF TEBS C/D](https://www.wabco-customercentre.com/catalog/en_GB/4801020000), [ZF Vario/VCS](https://www.wabco-customercentre.com/catalog/en_US/4461050510), [Knorr TEBS](https://truckservices.knorr-bremse.com/en/de/products/service-new-parts/electronic-systems/trailer-ebs/), [Knorr ABS manual](https://manualzz.com/doc/42773168/knorr-bremse-kb4ta-d--trailer-abs-product-manual), [Jaltest перечень систем](https://www.jaltest.com/en/coverage/2/12/123/remorque/trailer/trailer/), [Haldex диагностика](https://www.haldex.com/sv/europe/trailer-application-guide/ebs/diagnostic/diag-tools/), [Haldex ABS](https://www.haldex.com/en/europe/trailer-application-guide/abs/abs-4.0/retrofit-guide/), [VIE](https://vbsauto.ru/literatura/). Для KORMEE/SORL сведения поставщиков предварительные; для SORL найдено общее описание ABS/EBS, прицепная модель требует подтверждения. Для американских систем: [Bendix](https://www.manualslib.com/manual/392710/bendix-tabs-6-trailer-abs-module.html), [Haldex PLC](https://manualzz.com/doc/6303407/haldex-l30030-installation-and-service-manual).
