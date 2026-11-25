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
  },
  {
    "id": "scania-r-pressure-limit",
    "title": "Scania R — Клапан ограничения давления",
    "category": "Пневматика",
    "system": "Подготовка воздуха",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Ограничивает давление на защищённой стороне; в каталоге дополнительного оборудования есть 1914109. Определить номер клапана и рабочий диапазон по документации; не регулировать по условному рисунку.",
    "source": "Scania Bodybuilder / Pneumatic system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "air-preparation"
    ]
  },
  {
    "id": "scania-r-check-valve",
    "title": "Scania R — Обратный клапан",
    "category": "Пневматика",
    "system": "Подготовка воздуха",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Пропускает воздух в заданном направлении; пример номера Scania 1912297. Направление определяется маркировкой корпуса, не цветом трубки.",
    "source": "Scania Bodybuilder / Pneumatic system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-pressure-limit",
      "air-preparation"
    ]
  },
  {
    "id": "scania-r-air-reservoir",
    "title": "Scania R — Дополнительный воздушный ресивер",
    "category": "Пневматика",
    "system": "Подготовка воздуха",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Резервуар хранит запас сжатого воздуха; в перечне есть стальное и алюминиевое исполнения. Уточнить контур, паспорт ресивера, крепление и допустимое давление.",
    "source": "Scania Bodybuilder / Pneumatic system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "air-preparation",
      "scania-r-check-valve"
    ]
  },
  {
    "id": "scania-r-air-fitting-straight",
    "title": "Scania R — Прямое соединение пневмотрубок",
    "category": "Пневматика",
    "system": "Пневмолинии",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Соединяет две трубки по одной оси; варианты фитинга отличаются исполнением. Не определять диаметр по рисунку; сравнить наружный диаметр и маркировку.",
    "source": "Scania Bodybuilder / Pneumatic system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-air-fitting-angle",
      "scania-r-air-insert"
    ]
  },
  {
    "id": "scania-r-air-fitting-angle",
    "title": "Scania R — Угловое соединение 45° / 90°",
    "category": "Пневматика",
    "system": "Пневмолинии",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Позволяет изменить направление трассы; Scania различает угловые варианты. Проверить угол, размер и допустимый радиус изгиба трубки.",
    "source": "Scania Bodybuilder / Pneumatic system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-air-fitting-straight",
      "scania-r-air-insert"
    ]
  },
  {
    "id": "scania-r-air-fitting-branch",
    "title": "Scania R — Разветвитель T / Y",
    "category": "Пневматика",
    "system": "Пневмолинии",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Тройник образует разветвление трубопровода; он сам не управляет очередностью наполнения. Отличить тройник от многоконтурного защитного клапана; не соединять контуры без схемы.",
    "source": "Scania Bodybuilder / Pneumatic system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-air-fitting-straight",
      "scania-r-pressure-limit"
    ]
  },
  {
    "id": "scania-r-air-fitting-cross",
    "title": "Scania R — Четырёхходовое соединение",
    "category": "Пневматика",
    "system": "Пневмолинии",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Существуют крестообразные и блочные соединители на четыре направления. Не считать все порты взаимозаменяемыми: проверить тип внутренней коммутации.",
    "source": "Scania Bodybuilder / Pneumatic system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-air-fitting-branch"
    ]
  },
  {
    "id": "scania-r-air-insert",
    "title": "Scania R — Вставное соединение трубки",
    "category": "Пневматика",
    "system": "Пневмолинии",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В перечне Scania предусмотрены разные размеры вставок под пневмотрубки. Размер и тип соединения проверять отдельно; использовать разрешённую ремонтную процедуру.",
    "source": "Scania Bodybuilder / Pneumatic system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-air-fitting-straight"
    ]
  },
  {
    "id": "scania-r-air-body-outlet",
    "title": "Scania R — Вывод сжатого воздуха для надстройки",
    "category": "Пневматика",
    "system": "Пневмолинии",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Выделенный интерфейс для оборудования имеет предусмотренную заглушку. Не подбирать точку подключения по сходству с тормозной магистралью.",
    "source": "Scania Bodybuilder / Pneumatic system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-pressure-limit",
      "scania-r-air-reservoir"
    ]
  },
  {
    "id": "scania-r-level-remote",
    "title": "Scania R — Пульт изменения уровня кузова",
    "category": "Пневматика",
    "system": "Пневмоподвеска",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В каталоге выделены пульты для кабины и для надстройки; связь зависит от исполнения. Сопоставить пульт с C234/P2 и документацией шасси; не подавать питание на неизвестный контакт.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "air-ecas",
      "ecas-control"
    ]
  },
  {
    "id": "scania-r-level-memory",
    "title": "Scania R — Запоминание уровня подвески M1/M2",
    "category": "Пневматика",
    "system": "Пневмоподвеска",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Профили запомненной высоты относятся к функциям управления уровнем. Уточнить конфигурацию пневмоподвески; под кузовом работать только при механическом страховании.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-level-remote",
      "air-ecas"
    ]
  },
  {
    "id": "scania-r-level-normal",
    "title": "Scania R — Возврат к нормальному уровню",
    "category": "Пневматика",
    "system": "Пневмоподвеска",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Отдельная команда возвращает выбранный уровень к нормальному режиму. Не подменять калибровку датчиков принудительной подачей питания на клапаны.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-level-memory",
      "ecas-control"
    ]
  },
  {
    "id": "scania-r-load-transfer",
    "title": "Scania R — Перераспределение нагрузки на оси",
    "category": "Пневматика",
    "system": "Пневмоподвеска",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Функция изменения нагрузки отличается от обычного изменения общей высоты. Проверить тип тележки, допустимую осевую нагрузку и наличие опции.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-level-normal",
      "air-ecas"
    ]
  },
  {
    "id": "scania-r-tag-axle-lift",
    "title": "Scania R — Подъём поддерживающей оси",
    "category": "Пневматика",
    "system": "Пневмоподвеска",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Подъём вспомогательной оси предусмотрен для некоторых конфигураций тележки. Не считать команду разрешением на подъём при любой нагрузке; сверить документацию.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-load-transfer",
      "scania-r-level-remote"
    ]
  },
  {
    "id": "scania-r-tail-lift-power",
    "title": "Scania R — C157 — питание гидроборта",
    "category": "Электрика и ЭБУ",
    "system": "Кузовной жгут",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В перечне удлинительных жгутов гидроборта C157 относится к силовому питанию (2449795). Номер контакта и допустимая нагрузка не определяются одним обозначением C157.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-tail-lift-earth",
      "scania-r-tail-lift-control"
    ]
  },
  {
    "id": "scania-r-tail-lift-earth",
    "title": "Scania R — C152 — обратная цепь гидроборта",
    "category": "Электрика и ЭБУ",
    "system": "Кузовной жгут",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Для гидроборта указан отдельный жгут массы C152 (2449796). Не использовать случайную точку рамы вместо согласованного подключения.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-tail-lift-power",
      "scania-r-tail-lift-control"
    ]
  },
  {
    "id": "scania-r-tail-lift-control",
    "title": "Scania R — C159 — управление гидробортом",
    "category": "Электрика и ЭБУ",
    "system": "Кузовной жгут",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Жгут 2449797 связан с активацией гидроборта через C159. Силовая цепь и управляющая цепь различны. Сверить вариант и межблокировки.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-tail-lift-power",
      "scania-r-tail-lift-earth"
    ]
  },
  {
    "id": "scania-r-c494-distribution",
    "title": "Scania R — C494 — распределение жгута надстройки",
    "category": "Электрика и ЭБУ",
    "system": "Кузовной жгут",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "C494 связывается с наружным кузовным жгутом через группу C486/C487/C488. Обозначение соединителя не определяет назначения каждой жилы; сверить опции.",
    "source": "Scania Bodybuilder / BICT",
    "url": "https://bodybuilder.scania.com/trucks/en/tools-and-services/electric-configuration/logikscheman-foer-bict.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-bci",
      "scania-r-din-connectors"
    ]
  },
  {
    "id": "scania-r-din-connectors",
    "title": "Scania R — C486 / C487 / C488 — наружные соединители",
    "category": "Электрика и ЭБУ",
    "system": "Кузовной жгут",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Три соединителя кузовного жгута имеют собственные номера; их нельзя путать. Проверять маркировку корпуса и схему опционального жгута, а не цвет на иллюстрации.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-c494-distribution",
      "connector-orientation"
    ]
  },
  {
    "id": "scania-r-c259-message",
    "title": "Scania R — C259 — запрос сообщения на панели",
    "category": "Электрика и ЭБУ",
    "system": "BCI / ICL",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "В примере BICT вывод C259:1 может быть настроен для сообщения на ICL. Это опциональное назначение в примере, не постоянная распиновка. Проверить BICT.",
    "source": "Scania Bodybuilder / Driver's information",
    "url": "https://bodybuilder.scania.com/trucks/en/tools-and-services/electric-configuration/logikscheman-foer-bict/foerarinformation.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-bci",
      "scania-r-c494-distribution"
    ]
  },
  {
    "id": "scania-r-c259-speed",
    "title": "Scania R — C259 — внешний запрос оборотов",
    "category": "Электрика и ЭБУ",
    "system": "BCI / двигатель",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "В опубликованном примере входы C259 используются для запроса частоты вращения. Входы программируемые; не назначать номера по модели кабины или подавать напряжение без документации.",
    "source": "Scania Bodybuilder / Engine speed control",
    "url": "https://bodybuilder.scania.com/trucks/en/tools-and-services/electric-configuration/logikscheman-foer-bict/fjaerraktivering-av-motorvarvtal.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-bci-speed",
      "scania-r-c259-message"
    ]
  },
  {
    "id": "scania-r-c493-network",
    "title": "Scania R — C493 — внешний интерфейс CAN",
    "category": "Электрика и ЭБУ",
    "system": "BCI / CAN",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Внешний CAN кузовного оборудования подключается через C493 к интерфейсу BCI. Текст источника неоднозначен по полярности; CAN-H/L и номера контактов здесь не публикуются.",
    "source": "Scania Bodybuilder / Engine speed control using CAN",
    "url": "https://bodybuilder.scania.com/trucks/en/tools-and-services/electric-configuration/logikscheman-foer-bict/reglering-av-motorvarvtal-med-can.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-bci-speed",
      "scania-r-can-termination"
    ]
  },
  {
    "id": "scania-r-can-termination",
    "title": "Scania R — Оконечный элемент CAN",
    "category": "Электрика и ЭБУ",
    "system": "BCI / CAN",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В комплекте расширения указан терминатор 120 Ом, артикул 2204973. Это номинал детали, не измерение всей сети. Схему сегмента определять по комплектации.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-c493-network",
      "scania-r-expansion-unit"
    ]
  },
  {
    "id": "scania-r-expansion-unit",
    "title": "Scania R — Блок расширения кузовной электроники",
    "category": "Электрика и ЭБУ",
    "system": "BCI / расширение",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В документации комплект расширения включает блок и разъёмную арматуру. Подтвердить наличие блока и его версию; не добавлять терминаторы наугад.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-can-termination",
      "scania-r-vo39"
    ]
  },
  {
    "id": "scania-r-vo39",
    "title": "Scania R — 39-контактный корпус VO",
    "category": "Электрика и ЭБУ",
    "system": "BCI / расширение",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В установочном комплекте предусмотрен 39-контактный соединитель VO. Условный рисунок не показывает расположение 39 гнёзд; пины нужны из разрешённого чертежа.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-expansion-unit",
      "scania-r-connector-seal"
    ]
  },
  {
    "id": "scania-r-connector-seal",
    "title": "Scania R — Уплотнение и заглушка незанятого гнезда",
    "category": "Электрика и ЭБУ",
    "system": "Разъёмы",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Герметизация пустого гнезда и уплотнение жилы — разные элементы. Подбирать уплотнение по типу корпуса и сечению провода.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-vo39",
      "connector-orientation"
    ]
  },
  {
    "id": "scania-r-connector-terminal",
    "title": "Scania R — Плоские клеммы разных размеров",
    "category": "Электрика и ЭБУ",
    "system": "Разъёмы",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Размер контактной части и диапазон сечения жилы — независимые параметры. Не заменять контакт по визуальному сходству: сверить артикул и размер.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-connector-seal",
      "connector-orientation"
    ]
  },
  {
    "id": "scania-r-fuse-ato",
    "title": "Scania R — Предохранители ATO",
    "category": "Электрика и ЭБУ",
    "system": "Питание и защита",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В каталоге приведена серия ножевых ATO с несколькими номиналами. Номинал определяется конкретной цепью и схемой; цвет сам по себе не разрешает замену.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-fuse-mega",
      "scania-r-relay-types"
    ]
  },
  {
    "id": "scania-r-fuse-mega",
    "title": "Scania R — Силовые предохранители MEGA / MAXI",
    "category": "Электрика и ЭБУ",
    "system": "Питание и защита",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В силовых цепях Scania описаны предохранители MEGA и MAXI разных исполнений. Не заменять предохранитель перемычкой и не увеличивать номинал без разрешённой документации.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-fuse-ato",
      "scania-r-relay-types"
    ]
  },
  {
    "id": "scania-r-relay-types",
    "title": "Scania R — Микро-, мини- и силовые реле",
    "category": "Электрика и ЭБУ",
    "system": "Питание и защита",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Каталог разделяет реле и держатели по типоразмеру. Проверить напряжение катушки, коммутацию контактов и номинал; универсальной распиновки нет.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-fuse-ato",
      "scania-r-connector-terminal"
    ]
  },
  {
    "id": "scania-r-fuse-label",
    "title": "Scania R — Наклейка блока реле и предохранителей",
    "category": "Электрика и ЭБУ",
    "system": "Питание и защита",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Scania предлагает разные версии информационных наклеек электрических блоков. Сопоставить обозначение электрического блока и редакцию карты; не переносить позиции между поколениями.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-fuse-ato",
      "scania-r-relay-types"
    ]
  },
  {
    "id": "scania-r-switch-direct",
    "title": "Scania R — Прямой и программируемый выключатель",
    "category": "Электрика и ЭБУ",
    "system": "Клавиши кабины",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Панели программируемых клавиш и держатели прямого подключения различаются. Одинаковый символ на клавише не доказывает одинаковую электрическую схему.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-bci",
      "scania-r-switch-momentary"
    ]
  },
  {
    "id": "scania-r-switch-momentary",
    "title": "Scania R — Фиксируемая и возвратная клавиша",
    "category": "Электрика и ЭБУ",
    "system": "Клавиши кабины",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Некоторые клавиши фиксируют положение, другие возвращаются после отпускания. Сверить схему конкретного переключателя и тип входа; не замыкать выводы наугад.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-switch-direct"
    ]
  },
  {
    "id": "scania-r-battery-master",
    "title": "Scania R — Выключатель аккумуляторной батареи",
    "category": "Электрика и ЭБУ",
    "system": "Питание и защита",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В каталоге описан отдельный орган управления выключателем батареи. Положение клавиши не подтверждает отсутствие напряжения на всех цепях.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-fuse-mega",
      "scania-r-jump-socket"
    ]
  },
  {
    "id": "scania-r-jump-socket",
    "title": "Scania R — C377 — предусмотренная точка внешнего питания",
    "category": "Электрика и ЭБУ",
    "system": "Питание и защита",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Руководство рекомендует использовать C377 при наличии штатной точки запуска. Не применять процедуру дизельной машины к электромобилю; сверить руководство конкретного шасси.",
    "source": "Scania Bodybuilder / Driver's manual",
    "url": "https://bodybuilder.scania.com/trucks/en/instructions/drivers-manual.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-battery-master",
      "scania-r-fuse-mega"
    ]
  },
  {
    "id": "scania-r-camera-interface",
    "title": "Scania R — Камера и соединительная коробка",
    "category": "Электрика и ЭБУ",
    "system": "Обзорность",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В списке оборудования описана соединительная коробка камеры с защитой объектива. Не путать видеокабель, питание и управляющий интерфейс; схема зависит от комплектации.",
    "source": "Scania Bodybuilder / Electrical system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Electrical_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-c494-distribution"
    ]
  },
  {
    "id": "scania-r-mirror-heating",
    "title": "Scania R — Клавиша обогрева зеркал",
    "category": "Электрика и ЭБУ",
    "system": "Обзорность",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Выключатель обогрева зеркал существует как отдельное исполнение. Уточнить тип зеркала и управления нагревом; не считать любую клавишу прямым силовым выходом.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-switch-direct",
      "scania-r-fuse-ato"
    ]
  },
  {
    "id": "scania-r-aux-light",
    "title": "Scania R — Дополнительное рабочее освещение",
    "category": "Электрика и ЭБУ",
    "system": "Освещение",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В перечне разделены рабочие фонари кабины и задней части рамы. Не объединять штатные и дополнительные цепи без проверки схемы надстройки.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-switch-direct",
      "scania-r-c494-distribution"
    ]
  },
  {
    "id": "scania-r-reverse-alarm",
    "title": "Scania R — Сигнализация заднего хода",
    "category": "Электрика и ЭБУ",
    "system": "Обзорность",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Каталог содержит разные варианты органов управления звуковым предупреждением при движении назад. Проверять конфигурацию и безопасность; не отключать предупреждение для устранения ошибки.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-switch-momentary",
      "scania-r-camera-interface"
    ]
  },
  {
    "id": "scania-r-icl-messages",
    "title": "Scania R — ICL — индикация функций кузова",
    "category": "Электрика и ЭБУ",
    "system": "BCI / ICL",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Сообщения надстройки могут выводиться на приборную панель через настроенную логику. Различать команду, подтверждение состояния и диагностический отказ.",
    "source": "Scania Bodybuilder / Driver's information",
    "url": "https://bodybuilder.scania.com/trucks/en/tools-and-services/electric-configuration/logikscheman-foer-bict/foerarinformation.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-c259-message",
      "scania-bci"
    ]
  },
  {
    "id": "scania-r-ext-switch",
    "title": "Scania R — EXT — разрешение внешнего управления",
    "category": "Электрика и ЭБУ",
    "system": "BCI / управление",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "EXT относится к функциям управления за пределами кабины, доступным по комплектации. Не обходить условия безопасности и не воспринимать включение EXT как разрешение всех исполнительных функций.",
    "source": "Scania Bodybuilder / Driver's manual",
    "url": "https://bodybuilder.scania.com/trucks/en/instructions/drivers-manual.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-bci",
      "scania-r-c259-speed"
    ]
  },
  {
    "id": "scania-r-eg-pto",
    "title": "Scania R — EG — отбор мощности от коробки передач",
    "category": "КПП и ретардер",
    "system": "КОМ",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Коробочный отбор мощности получает вращение от трансмиссии. Определить тип КОМ и условия включения; рисунок не задаёт электрические или воздушные порты.",
    "source": "Scania Bodybuilder / Driver's manual",
    "url": "https://bodybuilder.scania.com/trucks/en/instructions/drivers-manual.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-ek-pto",
      "scania-r-ed-pto",
      "amt-control"
    ]
  },
  {
    "id": "scania-r-ek-pto",
    "title": "Scania R — EK — отбор мощности от двигателя",
    "category": "КПП и ретардер",
    "system": "КОМ",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Тип EK расположен между двигателем и коробкой и получает привод от двигателя. Проверить исполнение и условия включения по инструкции. Не применять правила EG.",
    "source": "Scania Bodybuilder / Driver's manual",
    "url": "https://bodybuilder.scania.com/trucks/en/instructions/drivers-manual.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-eg-pto",
      "scania-r-ed-pto"
    ]
  },
  {
    "id": "scania-r-ed-pto",
    "title": "Scania R — ED — привод от шестерён двигателя",
    "category": "КПП и ретардер",
    "system": "КОМ",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "ED относится к отбору мощности от привода двигателя. Команда может управлять гидравликой, а не вращением самого привода; проверить вариант.",
    "source": "Scania Bodybuilder / Driver's manual",
    "url": "https://bodybuilder.scania.com/trucks/en/instructions/drivers-manual.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-ek-pto",
      "scania-r-eg-pto"
    ]
  },
  {
    "id": "scania-r-em5-pto",
    "title": "Scania R — EM5 P1 — электромеханический КОМ",
    "category": "КПП и ретардер",
    "system": "КОМ",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Для EM5 P1 описана логика интерфейса BCI и внешнего CAN. Только для оборудования с EM5 P1; не заменяет схему обычного дизельного R.",
    "source": "Scania Bodybuilder / EM5P1",
    "url": "https://bodybuilder.scania.com/trucks/en/tools-and-services/electric-configuration/logikscheman-foer-bict/tipper-application.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-bci",
      "scania-r-c493-network"
    ]
  },
  {
    "id": "scania-r-exhaust-brake",
    "title": "Scania R — Моторное торможение выпускным тормозом",
    "category": "КПП и ретардер",
    "system": "Вспомогательное торможение",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "В описаниях двигателей R указаны возможности выпускного тормоза. Отличить выпускной тормоз от компрессионного CRB и гидравлического ретардера; точный клапан по двигателю.",
    "source": "Scania / R-series specifications",
    "url": "https://www.scania.com/uk/en/home/products/trucks/r-series/r-series-specifications.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-super-brake",
      "ebs-functional"
    ]
  },
  {
    "id": "scania-r-retarder-range",
    "title": "Scania R — Ретардер — дополнительное замедление",
    "category": "КПП и ретардер",
    "system": "Вспомогательное торможение",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Ретардер предлагается совместно с определёнными вариантами коробок передач R. Уточнить номер коробки и замедлителя; не считать рычаг прямым электрическим приводом клапана.",
    "source": "Scania / R-series specifications",
    "url": "https://www.scania.com/uk/en/home/products/trucks/r-series/r-series-specifications.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-exhaust-brake",
      "scania-super-brake"
    ]
  },
  {
    "id": "scania-r-opticruise-family",
    "title": "Scania R — Opticruise — семейства коробок",
    "category": "КПП и ретардер",
    "system": "Коробка передач",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "В спецификациях представлены различные платформы автоматизированной трансмиссии. Не смешивать G25/G33/G38 со старыми коробками. Поколение и номер КПП обязательны.",
    "source": "Scania / R-series specifications",
    "url": "https://www.scania.com/uk/en/home/products/trucks/r-series/r-series-specifications.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "amt-control",
      "scania-r-retarder-range"
    ]
  },
  {
    "id": "scania-r-coolant-external",
    "title": "Scania R — Контур внешнего жидкостного отопления",
    "category": "Двигатель",
    "system": "Охлаждение",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Для надстройки предусмотрены варианты подачи и возврата охлаждающей жидкости. Сверить двигатель и наличие ретардера, прежде чем выбирать соединение.",
    "source": "Scania Bodybuilder / Cooling system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Cooling_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-coolant-thermostat",
      "scania-r-coolant-retarder"
    ]
  },
  {
    "id": "scania-r-coolant-thermostat",
    "title": "Scania R — Термостат внешнего контура",
    "category": "Двигатель",
    "system": "Охлаждение",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В перечне внешнего отопления указан термостат; он относится к жидкостному контуру. Не переносить номер детали на основной термостат двигателя.",
    "source": "Scania Bodybuilder / Cooling system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Cooling_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-coolant-external"
    ]
  },
  {
    "id": "scania-r-coolant-retarder",
    "title": "Scania R — Охлаждение: исполнение с ретардером",
    "category": "Двигатель",
    "system": "Охлаждение",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Для дизеля с ретардером и без него предусмотрены разные фланцевые трубы внешнего контура. Уточнить конфигурацию до подбора патрубка; общая карта не указывает монтажный маршрут.",
    "source": "Scania Bodybuilder / Cooling system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Cooling_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-coolant-external",
      "scania-r-retarder-range"
    ]
  },
  {
    "id": "scania-r-fuel-cooler",
    "title": "Scania R — Охладитель топлива",
    "category": "Двигатель",
    "system": "Топливная система",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В перечне имеется отдельный охлаждающий агрегат топлива и его электрическая подготовка. Сверить двигатель, исполнение и наличие агрегата; не путать с охладителем наддува.",
    "source": "Scania Bodybuilder / Fuel system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Fuel_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-fuel-cooler-control",
      "boost-sensor"
    ]
  },
  {
    "id": "scania-r-fuel-cooler-control",
    "title": "Scania R — Управление охладителем топлива",
    "category": "Электрика и ЭБУ",
    "system": "Топливная система",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В комплекте описан термовыключатель и отдельные жгуты. Проверить маркировку термовыключателя и электрическую схему; не предполагать порядок пинов.",
    "source": "Scania Bodybuilder / Fuel system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Fuel_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-fuel-cooler",
      "connector-orientation"
    ]
  },
  {
    "id": "scania-r-fuel-marking",
    "title": "Scania R — Маркировка допустимого топлива",
    "category": "Двигатель",
    "system": "Топливная система",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Разные наклейки топливного бака обозначают разные допуски топлива. Не выводить совместимость с топливом из внешнего вида бака; сверить руководство двигателя.",
    "source": "Scania Bodybuilder / Fuel system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Fuel_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-fuel-cooler"
    ]
  },
  {
    "id": "scania-r-fuel-hose",
    "title": "Scania R — Топливные трубки и соединения",
    "category": "Двигатель",
    "system": "Топливная система",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В перечне перемещения бака описаны трубки нескольких размеров. Это не магистрали высокого давления впрыска; выбирать детали по конкретной низконапорной системе.",
    "source": "Scania Bodybuilder / Fuel system, p. 1",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Fuel_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-fuel-marking",
      "scania-r-fuel-cooler"
    ]
  },
  {
    "id": "scania-r-scr-tank",
    "title": "Scania R — Бак реагента SCR",
    "category": "Двигатель",
    "system": "Очистка выхлопа",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Документ надстройки показывает несколько вариантов размещения бака реагента. Проверить экологический класс и конфигурацию рамы; не путать с баком дизеля.",
    "source": "Scania Bodybuilder / Aftertreatment system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Aftertreatment_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-scr-lines",
      "scania-r-scr-quality"
    ]
  },
  {
    "id": "scania-r-scr-lines",
    "title": "Scania R — Подача и возврат реагента",
    "category": "Двигатель",
    "system": "Очистка выхлопа",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Для разных исполнений есть подающая и обратная линии, включая варианты обогрева. Не считать шланги взаимозаменяемыми: проверить длину, разъём и наличие обогрева.",
    "source": "Scania Bodybuilder / Aftertreatment system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Aftertreatment_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-scr-tank",
      "scania-r-scr-heater"
    ]
  },
  {
    "id": "scania-r-scr-heater",
    "title": "Scania R — Обогрев магистралей реагента",
    "category": "Электрика и ЭБУ",
    "system": "Очистка выхлопа",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Часть вариантов шлангов реагента имеет электрический обогрев. Не подавать напряжение на неопознанный нагреватель; сверить схему и параметры исполнения.",
    "source": "Scania Bodybuilder / Aftertreatment system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Aftertreatment_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-scr-lines",
      "scania-r-scr-quality"
    ]
  },
  {
    "id": "scania-r-scr-quality",
    "title": "Scania R — Датчик качества реагента и жгут EEC",
    "category": "Электрика и ЭБУ",
    "system": "Очистка выхлопа",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Описаны разные жгуты между EEC и баком для вариантов с датчиком качества и без него. Наличие датчика не подтверждается количеством видимых жил. Уточнить артикул жгута.",
    "source": "Scania Bodybuilder / Aftertreatment system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Aftertreatment_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-scr-tank",
      "scania-r-scr-heater"
    ]
  },
  {
    "id": "scania-r-nox-sensor",
    "title": "Scania R — NOx — датчик оксидов азота",
    "category": "Двигатель",
    "system": "Очистка выхлопа",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В документации есть отдельная тема размещения NOx-датчика для Euro IV/V. Точный номер датчика, положение и интерфейс зависят от экологического класса и двигателя.",
    "source": "Scania Bodybuilder / Aftertreatment system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Aftertreatment_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-scr-quality",
      "scania-r-silencer-location"
    ]
  },
  {
    "id": "scania-r-silencer-location",
    "title": "Scania R — Варианты расположения глушителя",
    "category": "Ходовая и механика",
    "system": "Выхлоп и рама",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В каталоге описаны передняя, средняя и задняя зоны установки выхлопного агрегата. Условные зоны не являются координатами на конкретном R; сверить вариант шасси.",
    "source": "Scania Bodybuilder / Aftertreatment system",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Aftertreatment_system.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-nox-sensor",
      "scania-r-scr-tank"
    ]
  },
  {
    "id": "scania-r-cab-tilt",
    "title": "Scania R — Механизм опрокидывания кабины",
    "category": "Ходовая и механика",
    "system": "Кабина",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Руководство описывает ручное и электрическое исполнения механизма. Не работать под промежуточно поднятой кабиной; нужна штатная фиксация и инструкция.",
    "source": "Scania Bodybuilder / Driver's manual",
    "url": "https://bodybuilder.scania.com/trucks/en/instructions/drivers-manual.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-cab-tilt-control"
    ]
  },
  {
    "id": "scania-r-cab-tilt-control",
    "title": "Scania R — Управление подъёмом кабины",
    "category": "Электрика и ЭБУ",
    "system": "Кабина",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "При электрическом исполнении используются органы управления и дистанционный пульт. Команда не равна разрешению движения кабины; не обходить блокировки.",
    "source": "Scania Bodybuilder / Driver's manual",
    "url": "https://bodybuilder.scania.com/trucks/en/instructions/drivers-manual.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-cab-tilt"
    ]
  },
  {
    "id": "scania-r-wheel-safety",
    "title": "Scania R — Колесо, ступица и опора шасси",
    "category": "Шиномонтаж",
    "system": "Колёса",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Руководство выделяет риск при подъёме пневмоподвешенного шасси. Не находиться под автомобилем, удерживаемым лишь домкратом или воздухом; параметры крепежа по модели.",
    "source": "Scania Bodybuilder / Driver's manual",
    "url": "https://bodybuilder.scania.com/trucks/en/instructions/drivers-manual.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "wheel-speed",
      "air-ecas"
    ]
  },
  {
    "id": "scania-r-acc",
    "title": "Scania R — ACC — адаптивный круиз-контроль",
    "category": "Электрика и ЭБУ",
    "system": "ADAS",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Функция регулирует скорость с учётом дистанции до транспортного средства. Не принимать отсутствие ошибки за подтверждение калибровки; проверять исполнение датчиков.",
    "source": "Scania / Safety",
    "url": "https://www.scania.com/uk/en/home/products/attributes/safety.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-aeb",
      "scania-r-ldw"
    ]
  },
  {
    "id": "scania-r-aeb",
    "title": "Scania R — AEB — автоматическое экстренное торможение",
    "category": "Электрика и ЭБУ",
    "system": "ADAS",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Система помогает снизить риск столкновения торможением. Не обходить защитные функции и не проверять торможение на дороге без предусмотренной процедуры.",
    "source": "Scania / Safety",
    "url": "https://www.scania.com/uk/en/home/products/attributes/safety.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-acc",
      "ebs-functional"
    ]
  },
  {
    "id": "scania-r-ldw",
    "title": "Scania R — LDW — предупреждение об уходе из полосы",
    "category": "Электрика и ЭБУ",
    "system": "ADAS",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "LDW предупреждает об уходе из полосы; комплектации различаются. Уточнить вариант системы и требования к калибровке, не подменять проверку отключением.",
    "source": "Scania / Safety",
    "url": "https://www.scania.com/uk/en/home/products/attributes/safety.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-acc",
      "scania-r-aeb"
    ]
  },
  {
    "id": "scania-r-mois",
    "title": "Scania R — MOIS — контроль зоны перед кабиной",
    "category": "Электрика и ЭБУ",
    "system": "ADAS",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Современная система предупреждает о людях рядом с передней частью грузовика при начале движения. Не переносить на раннюю R; подтвердить наличие функции и положение датчиков.",
    "source": "Scania / Truck safety systems",
    "url": "https://www.scania.com/group/en/home/products-and-services/trucks/truck-safety.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-aeb",
      "scania-r-camera-interface"
    ]
  },
  {
    "id": "scania-r-door-warning",
    "title": "Scania R — Предупреждение при открытии двери",
    "category": "Электрика и ЭБУ",
    "system": "ADAS",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Применимость определяется описанным вариантом оборудования и документацией шасси.",
    "body": "Для Dynamic R описано предупреждение о приближении велосипедиста сзади. Уточнить современную комплектацию и наличие датчика; старые R не включены автоматически.",
    "source": "Scania / Dynamic R-series",
    "url": "https://www.scania.com/group/en/home/products-and-services/trucks/r-series/dynamic-r-series.html",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-mois",
      "scania-r-camera-interface"
    ]
  },
  {
    "id": "scania-r-aux-heater-switch",
    "title": "Scania R — Клавиша автономного отопителя",
    "category": "Автономное оборудование",
    "system": "Отопитель",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В каталоге встречаются различные исполнения управления дополнительным отопителем. Не путать тип отопителя и схему управления; артикул клавиши не определяет распиновку агрегата.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "heater-functional",
      "scania-r-switch-direct"
    ]
  },
  {
    "id": "scania-r-trailer-lift",
    "title": "Scania R — Управление подъёмной осью прицепа",
    "category": "Прицепы",
    "system": "Пневмоподвеска",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Для прицепа предусмотрен отдельный орган управления подъёмной осью. Это не схема TEBS; подтвердить производителя прицепа и модулятора.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-tag-axle-lift",
      "iso-7638-1"
    ]
  },
  {
    "id": "scania-r-trailer-brake-request",
    "title": "Scania R — Клавиша торможения прицепа",
    "category": "Прицепы",
    "system": "Тормоза",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "В перечне клавиш выделена функция тормоза прицепа. Не предполагать прямое управление воздухом: логика зависит от оборудования и поколения.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "ebs-functional",
      "iso-7638-1"
    ]
  },
  {
    "id": "scania-r-trailer-parking",
    "title": "Scania R — Стояночный тормоз прицепа",
    "category": "Прицепы",
    "system": "Тормоза",
    "kind": "Карточка узла / функции",
    "make": "Scania",
    "models": [
      "R"
    ],
    "scope": "Тематическая карточка для поиска по Scania R; наличие узла, поколения, точная применимость, пины и цвета проводов не подтверждены. Источник описывает оборудование/детали Scania для надстроек, не все шасси R.",
    "body": "Предусмотрена отдельная индикация или клавиша стояночного тормоза прицепа. Не путать стояночный и рабочий тормоз; монтажную схему определяет конкретное шасси и прицеп.",
    "source": "Scania Bodybuilder / Switches and driver information",
    "url": "https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Switches_and_driver_information.pdf",
    "pins": [],
    "sourceCheckedOn": "2026-11-25",
    "rights": "original_illustration",
    "fitment": "not_confirmed",
    "reviewStatus": "source_checked_expert_pending",
    "related": [
      "scania-r-trailer-brake-request",
      "ebs-functional"
    ]
  }
] as const;
export async function readTechBaseIllustrations(){
 const cards=await Promise.all(TECHBASE_ILLUSTRATED.map(async card=>({...card,image:await readFile(new URL('../../data/techbase-illustrated/'+card.id+'.svg',import.meta.url),'utf8')})));
 return {version:'2026-11-25-c',families:TECHBASE_FAMILIES,categories:TECHBASE_CATEGORIES,cards};
}
