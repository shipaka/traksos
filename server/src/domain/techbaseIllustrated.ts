import { readFile } from 'node:fs/promises';
// No public/static asset route. Images are delivered only in the authorized master payload.
export const TECHBASE_FAMILIES = [
  [
    "Scania",
    [
      "R",
      "P",
      "G"
    ]
  ],
  [
    "Volvo",
    [
      "FH",
      "FM"
    ]
  ],
  [
    "MAN",
    [
      "TGX",
      "TGA",
      "TGS"
    ]
  ],
  [
    "DAF",
    [
      "XF",
      "CF"
    ]
  ],
  [
    "Renault",
    [
      "Premium",
      "T"
    ]
  ],
  [
    "Mercedes-Benz",
    [
      "Actros",
      "Axor"
    ]
  ],
  [
    "КАМАЗ",
    [
      "5490",
      "54901"
    ]
  ]
] as const;
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
    "reviewStatus": "source_checked_expert_pending"
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
    "reviewStatus": "source_checked_expert_pending"
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
    "reviewStatus": "source_checked_expert_pending"
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
    "reviewStatus": "source_checked_expert_pending"
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
    "reviewStatus": "source_checked_expert_pending"
  }
] as const;
export async function readTechBaseIllustrations(){
  const cards=await Promise.all(TECHBASE_ILLUSTRATED.map(async card=>({ ...card, image: await readFile(new URL('../../data/techbase-illustrated/'+card.id+'.svg',import.meta.url),'utf8') })));
  return { version:'2026-11-25-a', families:TECHBASE_FAMILIES, cards };
}
