import { readFile } from 'node:fs/promises';
// No public/static asset route. Images are delivered only in the authorized master payload.
export const TECHBASE_FAMILIES = [
  [
    "Scania",
    [
      "3-я серия",
      "4-я серия",
      "P",
      "G",
      "R",
      "T",
      "S",
      "L"
    ]
  ],
  [
    "Volvo",
    [
      "F10",
      "F12",
      "F16",
      "FH",
      "FH16",
      "FM",
      "FMX",
      "FL",
      "FE"
    ]
  ],
  [
    "MAN",
    [
      "F90",
      "F2000",
      "M2000",
      "TGA",
      "TGL",
      "TGM",
      "TGS",
      "TGX"
    ]
  ],
  [
    "DAF",
    [
      "95",
      "85",
      "75",
      "LF",
      "CF",
      "XF",
      "XD",
      "XG",
      "XG+"
    ]
  ],
  [
    "Renault",
    [
      "Major",
      "Magnum",
      "Premium",
      "Midlum",
      "Kerax",
      "T",
      "C",
      "K",
      "D"
    ]
  ],
  [
    "Mercedes-Benz",
    [
      "SK",
      "Actros",
      "Actros L",
      "Axor",
      "Atego",
      "Arocs",
      "Antos",
      "Econic"
    ]
  ],
  [
    "КАМАЗ",
    [
      "5320",
      "5410",
      "5511",
      "4310",
      "65115",
      "6520",
      "6460",
      "5490",
      "54901"
    ]
  ],
  [
    "МАЗ",
    [
      "5335",
      "5432",
      "6422",
      "5551",
      "5440",
      "6430",
      "5340",
      "6312",
      "6501"
    ]
  ],
  [
    "Iveco",
    [
      "EuroTech",
      "EuroStar",
      "EuroCargo",
      "Stralis",
      "Trakker",
      "S-Way",
      "X-Way",
      "T-Way"
    ]
  ],
  [
    "Sitrak",
    [
      "C7H",
      "C9H"
    ]
  ],
  [
    "Shacman",
    [
      "F2000",
      "F3000",
      "X3000",
      "X5000",
      "X6000"
    ]
  ],
  [
    "FAW",
    [
      "J5",
      "J6",
      "J7"
    ]
  ],
  [
    "Foton",
    [
      "Auman GTL",
      "Auman EST"
    ]
  ],
  [
    "HOWO",
    [
      "HOWO",
      "A7",
      "T5G",
      "T7H"
    ]
  ]
] as const;
export const TECHBASE_CATEGORIES = ['Пневматика','Электрика и ЭБУ','Двигатель','КПП и ретардер','Ходовая и механика','Прицепы','Автономное оборудование','Шиномонтаж'] as const;
export const TECHBASE_ILLUSTRATED = [
  {
    "id": "iso-7638-1",
    "title": "ISO 7638-1 — 7 контактов ABS/EBS, 24 В",
    "system": "EBS / ABS",
    "kind": "Распиновка",
    "make": null,
    "models": [],
    "scope": "Только маркированный ISO 7638-1 (24 В), семиконтактный вариант. Не распиновка блока EBS. Для 5-контактного ABS контакты 6–7 отсутствуют. Не определять контакт по форме этой таблицы.",
    "body": "Назначение, стандартный цвет изоляции и сечение контактов; при ремонте сверить литой номер гнезда и документацию установленного изделия. Цвет старого жгута не доказывает назначение.",
    "source": "ERICH JAEGER, ISO 7638-1/-2:2018",
    "url": "https://www.erich-jaeger.com/en-US/products/standards/iso-7638-1/iso-7638-1-and-2-scope-and-application",
    "pins": [
      [
        "1",
        "+ электромагнитных клапанов",
        "красный",
        "4"
      ],
      [
        "2",
        "+ электроники",
        "чёрный",
        "1,5"
      ],
      [
        "3",
        "− электроники",
        "жёлтый",
        "1,5"
      ],
      [
        "4",
        "− электромагнитных клапанов",
        "коричневый",
        "4"
      ],
      [
        "5",
        "Сигнал предупреждения",
        "белый",
        "1,5"
      ],
      [
        "6",
        "CAN-H",
        "белый/зелёный",
        "1,5"
      ],
      [
        "7",
        "CAN-L",
        "белый/коричневый",
        "1,5"
      ]
    ],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "category": "Прицепы",
    "related": [
      "iso-12098",
      "ebs-functional"
    ]
  },
  {
    "id": "iso-12098",
    "title": "ISO 12098 — 15 контактов прицепа, 24 В",
    "system": "Электрика прицепа",
    "kind": "Распиновка",
    "make": null,
    "models": [],
    "scope": "Только идентифицированный разъём ISO 12098; не ISO 7638, не переходник с нестандартной коммутацией. Функции 10–12 сверить по редакции и оборудованию.",
    "body": "Назначение и стандартные цвета контактов по таблице производителя. Шина данных этого разъёма не является шиной тормозов ISO 7638.",
    "source": "ERICH JAEGER, ISO 12098",
    "url": "https://www.erich-jaeger.com/it/products/standards/iso-12098/iso-12098-scope-and-application",
    "pins": [
      [
        "1",
        "Левый указатель поворота",
        "жёлтый",
        "1,5"
      ],
      [
        "2",
        "Правый указатель поворота",
        "зелёный",
        "1,5"
      ],
      [
        "3",
        "Задний противотуманный фонарь",
        "синий",
        "1,5"
      ],
      [
        "4",
        "Общий обратный провод",
        "белый",
        "2,5"
      ],
      [
        "5",
        "Левые габариты и освещение номера",
        "чёрный",
        "1,5"
      ],
      [
        "6",
        "Правые габариты и освещение номера",
        "коричневый",
        "1,5"
      ],
      [
        "7",
        "Стоп-сигналы",
        "красный",
        "1,5"
      ],
      [
        "8",
        "Фонарь заднего хода",
        "розовый",
        "1,5"
      ],
      [
        "9",
        "Постоянное питание",
        "оранжевый",
        "2,5"
      ],
      [
        "10",
        "Разблокировка инерционного тормоза / блокировка управляемой оси",
        "серый",
        "1,5"
      ],
      [
        "11",
        "Помощь при трогании",
        "белый/чёрный",
        "1,5"
      ],
      [
        "12",
        "Подъём оси",
        "белый/синий",
        "1,5"
      ],
      [
        "13",
        "Общий обратный провод данных",
        "белый/красный",
        "2,5"
      ],
      [
        "14",
        "CAN-H",
        "белый/зелёный",
        "1,5"
      ],
      [
        "15",
        "CAN-L",
        "белый/коричневый",
        "1,5"
      ]
    ],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "category": "Прицепы",
    "related": [
      "iso-7638-1",
      "trailer-architecture"
    ]
  },
  {
    "id": "ebs-functional",
    "title": "EBS — принцип работы тормозной системы",
    "system": "EBS / ABS",
    "kind": "Функциональная схема",
    "make": null,
    "models": [],
    "scope": "Общий принцип пневматической EBS; не OEM-схема, не схема проводов, не монтажная инструкция.",
    "body": "Запрос торможения обрабатывается электроникой; данные движения помогают управлять давлением. Для реальной диагностики требуется модель EBS и её документация.",
    "source": "ZF, Electronic Braking System",
    "url": "https://www.zf.com/products/en/cv/products_64730.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "category": "Пневматика",
    "related": [
      "ebs-modulator",
      "wheel-speed",
      "iso-7638-1"
    ]
  },
  {
    "id": "connector-orientation",
    "title": "Разъём — стороны, гнёзда и фиксация",
    "system": "Электрика / ECU",
    "kind": "Иллюстрация",
    "make": null,
    "models": [],
    "scope": "Условный корпус, не конкретная модель разъёма и не расположение контактов реального изделия.",
    "body": "Сторона сопряжения отличается от стороны проводов. Проверяют маркировку корпуса и положение фиксатора; TPA фиксирует положение контактов, CPA — сопряжение корпуса.",
    "source": "TE Connectivity, NTSEAL FAQ",
    "url": "https://www.te.com/en/faqs/ntseal-connector-faq.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "category": "Электрика и ЭБУ",
    "related": [
      "wheel-speed",
      "ecas-control"
    ]
  },
  {
    "id": "volvo-fh-fm-battery-2017",
    "title": "Volvo FH / FM — варианты расположения АКБ",
    "system": "Питание / АКБ",
    "kind": "Расположение узлов",
    "make": "Volvo",
    "models": [
      "FH",
      "FM"
    ],
    "scope": "Варианты батарейной системы, представленной Volvo в декабре 2017 года; не подтверждение комплектации конкретного FH/FM и не электромобиль.",
    "body": "Производитель описывает стартерные батареи слева и гелевые батареи сзади либо объединённый ящик слева. Определять фактический вариант по документации шасси и осмотру.",
    "source": "Volvo Trucks, 13.12.2017, New battery system",
    "url": "https://www.volvotrucks.com/en-en/news-stories/press-releases/2017/dec/pressrelease-171213.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "category": "Электрика и ЭБУ",
    "related": [
      "connector-orientation"
    ]
  },
  {
    "id": "air-preparation",
    "title": "Подготовка воздуха: компрессор и осушитель",
    "category": "Пневматика",
    "system": "Подготовка воздуха",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Компрессор создаёт поток сжатого воздуха, блок подготовки управляет его обработкой и подачей. Реальное расположение клапанов и контуров зависит от шасси.",
    "source": "ZF, Electronic Air Processing Units",
    "url": "https://www.zf.com/products/en/cv/products_64543.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "ebs-functional",
      "air-ecas",
      "air-prep-control"
    ]
  },
  {
    "id": "air-prep-control",
    "title": "Электронное управление подготовкой воздуха",
    "category": "Электрика и ЭБУ",
    "system": "Подготовка воздуха",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Электронные APU могут управлять работой компрессора. Состав датчиков и цепи питания сверяют по номеру изделия.",
    "source": "ZF, Electronic Air Processing Units",
    "url": "https://www.zf.com/products/en/cv/products_64543.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "air-preparation",
      "connector-orientation"
    ]
  },
  {
    "id": "air-ecas",
    "title": "ECAS: регулирование высоты подвески",
    "category": "Пневматика",
    "system": "Пневмоподвеска",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "При наличии электронной подвески клапаны управляют наполнением и выпуском воздуха. Изображение не задаёт номера пневмопортов.",
    "source": "ZF, OptiRide ECAS",
    "url": "https://www.zf.com/products/en/cv/products_64705.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "ecas-control",
      "air-preparation"
    ]
  },
  {
    "id": "ecas-control",
    "title": "ECAS: датчик уровня и управление клапаном",
    "category": "Электрика и ЭБУ",
    "system": "Пневмоподвеска",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Датчик сообщает информацию о положении подвески; электронное управление регулирует исполнительные клапаны. Номера контактов и тип сигнала зависят от датчика.",
    "source": "ZF, OptiRide ECAS",
    "url": "https://www.zf.com/products/en/cv/products_64705.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "air-ecas",
      "connector-orientation"
    ]
  },
  {
    "id": "wheel-speed",
    "title": "Датчик скорости колеса ABS/EBS",
    "category": "Электрика и ЭБУ",
    "system": "EBS / ABS",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Датчики различаются по принципу и интерфейсу. Не определять пассивный или активный тип по количеству проводов; точные параметры нужны из документации.",
    "source": "ZF, ProductFinder Commercial Vehicles",
    "url": "https://www.zf.com/products/en/cv/productfinder/cv.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "ebs-functional",
      "connector-orientation"
    ]
  },
  {
    "id": "ebs-modulator",
    "title": "Модулятор EBS: электронная и воздушная части",
    "category": "Пневматика",
    "system": "EBS / ABS",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "В EBS электронная обработка помогает дозировать торможение. Иллюстрация не описывает резервный контур, монтаж или положение портов.",
    "source": "ZF, Electronic Braking System",
    "url": "https://www.zf.com/products/en/cv/products_64730.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "ebs-functional",
      "wheel-speed",
      "air-preparation"
    ]
  },
  {
    "id": "crank-sensor",
    "title": "Датчик частоты вращения коленвала",
    "category": "Двигатель",
    "system": "Датчики двигателя",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Система управления использует информацию о вращении и угловом положении коленвала. Реальное место, рабочий зазор и тип датчика зависят от двигателя.",
    "source": "Bosch, Crankshaft speed sensor",
    "url": "https://www.bosch-mobility.com/en/solutions/sensors/crankshaft-speed-sensor/",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "connector-orientation"
    ]
  },
  {
    "id": "boost-sensor",
    "title": "Датчик давления и температуры наддува",
    "category": "Двигатель",
    "system": "Датчики двигателя",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Комбинированный датчик передаёт сведения о давлении и температуре. Не присваивать номера выводов по изображению условного корпуса.",
    "source": "Bosch, Boost-pressure and temperature sensor",
    "url": "https://www.bosch-mobility.com/en/solutions/sensors/boost-pressure-and-temperature-sensor/",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "connector-orientation",
      "crank-sensor"
    ]
  },
  {
    "id": "amt-control",
    "title": "Автоматизированная КПП: управление переключением",
    "category": "КПП и ретардер",
    "system": "Коробка передач",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Пример автоматизированной трансмиссии, в которой переключение и работа сцепления координируются электроникой. Не схема конкретной КПП.",
    "source": "ZF, TraXon",
    "url": "https://www.zf.com/products/en/cv/products_76430.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "connector-orientation"
    ]
  },
  {
    "id": "scania-bci",
    "title": "Scania: интерфейс дополнительного оборудования BCI",
    "category": "Электрика и ЭБУ",
    "system": "Интерфейс кузова",
    "kind": "Функциональная иллюстрация",
    "make": "Scania",
    "models": [
      "P",
      "G",
      "R",
      "S",
      "L"
    ],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "На оборудованных BCI автомобилях производитель описывает внешние CAN-запросы и конфигурируемые функции. На новых электрических архитектурах интерфейс может отличаться. Не относится автоматически ко всем годам.",
    "source": "Scania Bodybuilder, BICT",
    "url": "https://bodybuilder.scania.com/trucks/en/tools-and-services/electric-configuration/logikscheman-foer-bict.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "connector-orientation",
      "scania-bci-speed"
    ]
  },
  {
    "id": "scania-bci-speed",
    "title": "Scania: запрос частоты вращения через BCI",
    "category": "Электрика и ЭБУ",
    "system": "Интерфейс кузова",
    "kind": "Функциональная иллюстрация",
    "make": "Scania",
    "models": [
      "P",
      "G",
      "R",
      "S",
      "L"
    ],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Официальная справка описывает управление частотой вращения через BCI и настройку параметров. Здесь не приводятся кадры CAN, адреса, пины или условия активации.",
    "source": "Scania Bodybuilder, Engine speed control using CAN",
    "url": "https://bodybuilder.scania.com/trucks/en/tools-and-services/electric-configuration/logikscheman-foer-bict/reglering-av-motorvarvtal-med-can.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-bci",
      "crank-sensor"
    ]
  },
  {
    "id": "scania-super-brake",
    "title": "Scania Super: CRB и ретардер R4700D",
    "category": "КПП и ретардер",
    "system": "Вспомогательное торможение",
    "kind": "Функциональная иллюстрация",
    "make": "Scania",
    "models": [
      "P",
      "G",
      "R",
      "S",
      "L"
    ],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Для Super производитель описывает опциональный компрессионный тормоз CRB и R4700D. Это не схема старых Scania и не подтверждение установки обоих узлов.",
    "source": "Scania, Super Powertrain",
    "url": "https://www.scania.com/uk/en/home/products/trucks/super-powertrain.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "ebs-functional",
      "amt-control"
    ]
  },
  {
    "id": "volvo-fh-gas-retarder",
    "title": "Volvo FH на газе: VEB и ретардер",
    "category": "КПП и ретардер",
    "system": "Вспомогательное торможение",
    "kind": "Функциональная иллюстрация",
    "make": "Volvo",
    "models": [
      "FH"
    ],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "На странице FH с газовым двигателем производитель описывает Volvo Engine Brake и ретардер. Уточнять комплектацию, поколение и вид двигателя.",
    "source": "Volvo Trucks, FH gas-powered",
    "url": "https://www.volvotrucks.com/en-en/trucks/gas-powered/volvo-fh-gas-powered.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "ebs-functional",
      "amt-control"
    ]
  },
  {
    "id": "actros-l-retarder",
    "title": "Actros L 1855 LS: моторный тормоз и ретардер",
    "category": "КПП и ретардер",
    "system": "Вспомогательное торможение",
    "kind": "Функциональная иллюстрация",
    "make": "Mercedes-Benz",
    "models": [
      "Actros L"
    ],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "В комплектации опубликованного Actros L 1855 LS указаны моторный тормоз M5V и масляный ретардер B3K. Не переносить на Axor или иные Actros.",
    "source": "Mercedes-Benz Trucks, Actros L 1855 LS 4×2",
    "url": "https://www.mercedes-benz-trucks.com/int/en/events/iaa/all-vehicles/actros-l-1855-ls-4x2.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "ebs-functional",
      "amt-control"
    ]
  },
  {
    "id": "kamaz-5490-air-index",
    "title": "КАМАЗ-5490: выбор пневматической схемы",
    "category": "Пневматика",
    "system": "Идентификация системы",
    "kind": "Функциональная иллюстрация",
    "make": "КАМАЗ",
    "models": [
      "5490"
    ],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Производитель публикует пневматические схемы семейства 5490. Эта карточка показывает порядок идентификации, а не монтаж конкретного автомобиля. OEM-схема не скопирована.",
    "source": "КАМАЗ, электронная документация",
    "url": "https://guide.kamaz.ru/news/1868",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "air-preparation",
      "ebs-modulator",
      "air-ecas"
    ]
  },
  {
    "id": "maz-configuration",
    "title": "МАЗ: идентификация двигателя и КПП",
    "category": "Двигатель",
    "system": "Идентификация системы",
    "kind": "Функциональная иллюстрация",
    "make": "МАЗ",
    "models": [
      "5440",
      "6430",
      "5340",
      "6312"
    ],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "В открытом перечне есть руководства для разных исполнений 5440 и 6430. Подбор технической карты по обозначению семейства недостаточен. Карточка не утверждает одинаковую комплектацию.",
    "source": "МАЗКОМ, руководства по эксплуатации",
    "url": "https://mazcom.ru/about/info/",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "crank-sensor",
      "amt-control",
      "air-ecas"
    ]
  },
  {
    "id": "tpms-functional",
    "title": "TPMS: контроль давления в шинах",
    "category": "Шиномонтаж",
    "system": "TPMS",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Система TPMS отслеживает давление и предупреждает водителя. Тип датчика, его расположение и способ связи определяются исполнением.",
    "source": "ZF, OptiTire",
    "url": "https://www.zf.com/products/en/cv/products_64623.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "wheel-speed"
    ]
  },
  {
    "id": "heater-functional",
    "title": "Автономный воздушный отопитель",
    "category": "Автономное оборудование",
    "system": "Отопитель",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Автономный отопитель обеспечивает обогрев кабины. Воздух для кабины и продукты сгорания относятся к разным трактам. Подключение топлива, проводов и выхлопа не показано.",
    "source": "Webasto, Air Top 2000 STC",
    "url": "https://www.webasto.com/en-us/heating/air-heater/air-top-2000-stc.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "connector-orientation"
    ]
  },
  {
    "id": "trailer-architecture",
    "title": "Прицеп: тормозные и электрические соединения",
    "category": "Прицепы",
    "system": "Соединения тягача",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочный материал. Не точная схема проводки, не номера контактов/портов, не подтверждение применимости по VIN. Проверить модификацию, поколение и документацию.",
    "body": "Электрический интерфейс освещения и служебного оборудования отделён от ABS/EBS. Проверить стандарт разъёма перед подбором таблицы.",
    "source": "ERICH JAEGER, ISO 12098",
    "url": "https://www.erich-jaeger.com/it/products/standards/iso-12098/iso-12098-scope-and-application",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "iso-12098",
      "iso-7638-1",
      "ebs-functional"
    ]
  },
  {
    "id": "man-tipmatic",
    "title": "MAN TGX/TGS: управление TipMatic",
    "category": "КПП и ретардер",
    "system": "Коробка передач",
    "kind": "Функциональная иллюстрация",
    "make": "MAN",
    "models": [
      "TGX",
      "TGS"
    ],
    "scope": "Справочная иллюстрация, не точная схема монтажа и не подтверждение применимости по VIN. Сверять модификацию и документацию.",
    "body": "В зависимости от программы TipMatic координирует переключения и работу сцепления; MAN также описывает использование моторного тормоза. Не переносить на более ранние поколения или механическую КПП.",
    "source": "MAN, TipMatic",
    "url": "https://www.man.eu/mea/en/about-us/innovations/assistance-systems/automated-gearbox-functions/tipmatic.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "amt-control",
      "ebs-functional"
    ]
  },
  {
    "id": "daf-mx-brake",
    "title": "DAF XF/XG/XG+: MX Engine Brake",
    "category": "КПП и ретардер",
    "system": "Вспомогательное торможение",
    "kind": "Функциональная иллюстрация",
    "make": "DAF",
    "models": [
      "XF",
      "XG",
      "XG+"
    ],
    "scope": "Справочная иллюстрация, не точная схема монтажа и не подтверждение применимости по VIN. Сверять модификацию и документацию.",
    "body": "В новом поколении DAF производитель описывает сочетание MX Engine Brake и прогнозного контроля скорости на спуске. Конкретный набор оборудования определяется комплектацией, схема проводов не показана.",
    "source": "DAF, The power of efficiency",
    "url": "https://startthefuture.daf.com/en-gb/efficiency",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "amt-control",
      "ebs-functional"
    ]
  },
  {
    "id": "renault-de13r",
    "title": "Renault T/C/K: DE13 R и Optibrake+",
    "category": "Двигатель",
    "system": "Вспомогательное торможение",
    "kind": "Функциональная иллюстрация",
    "make": "Renault",
    "models": [
      "T",
      "C",
      "K"
    ],
    "scope": "Справочная иллюстрация, не точная схема монтажа и не подтверждение применимости по VIN. Сверять модификацию и документацию.",
    "body": "Для нового силового агрегата DE13 R производитель указывает Optibrake+ и новое поколение Optidriver. Это материал про описанное исполнение 2026 года, не про Renault Premium.",
    "source": "Renault Trucks, New powertrain",
    "url": "https://www.renault-trucks.com/en/newsroom/press-releases/new-powertrain",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "amt-control",
      "ebs-functional"
    ]
  },
  {
    "id": "axle-functional",
    "title": "Ведущий мост: передача крутящего момента",
    "category": "Ходовая и механика",
    "system": "Мосты и оси",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочная иллюстрация, не точная схема монтажа и не подтверждение применимости по VIN. Сверять модификацию и документацию.",
    "body": "Общий принцип обычного ведущего моста. Конструкция дифференциала, передаточное число, регулировка и моменты затяжки зависят от исполнения.",
    "source": "ZF, Chassis",
    "url": "https://www.zf.com/products/en/cv/productfinder/chassis.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "wheel-speed",
      "tpms-functional"
    ]
  },
  {
    "id": "steering-functional",
    "title": "Рулевое управление: передача усилия",
    "category": "Ходовая и механика",
    "system": "Рулевое управление",
    "kind": "Функциональная иллюстрация",
    "make": null,
    "models": [],
    "scope": "Справочная иллюстрация, не точная схема монтажа и не подтверждение применимости по VIN. Сверять модификацию и документацию.",
    "body": "Функциональная карта обычного рулевого управления; конкретный усилитель, рулевые тяги и кинематика отличаются. Не описывает регулировку или демонтаж.",
    "source": "ZF, Chassis",
    "url": "https://www.zf.com/products/en/cv/productfinder/chassis.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "axle-functional"
    ]
  }
] as const;
export async function readTechBaseIllustrations(){
 const cards=await Promise.all(TECHBASE_ILLUSTRATED.map(async card=>({...card,image:await readFile(new URL('../../data/techbase-illustrated/'+card.id+'.svg',import.meta.url),'utf8')})));
 return {version:'2026-11-25-b2',families:TECHBASE_FAMILIES,categories:TECHBASE_CATEGORIES,cards};
}
