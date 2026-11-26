package ru.traksos.minidiagnostic

// Research entries only. These are NOT buildable cable diagrams, or authorized profiles.
data class CableResearchEntry(val id:String,val name:String,val place:ConnectionPlace,
    val path:ElectricalPath?,val note:String,val source:String)
object CableResearch {
    private const val VCS = "https://www.wabco-customercentre.com/catalog/docs/8150100083.pdf"
    private const val HALDEX = "https://www.haldex.com/sv/europe/trailer-application-guide/ebs/diagnostic/diag-tools/"
    private const val VIE = "https://vbsauto.ru/wp-content/uploads/2024/10/%D0%9E%D0%BF%D0%B8%D1%81%D0%B0%D0%BD%D0%B8%D0%B5-%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D1%8B_-TEBS.pdf"
    private const val SORL = "https://sorl.ru/manuals/rukovodstvo-dlya-diagnosticheskogo-oborudovaniya-sorl.pdf"
    private const val KNORR_2023 = "https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/HHFAbb20I0EBhB_Y138839-003-EN_WEB.pdf"
    val rows = listOf(
        CableResearchEntry("vcs2-k","WABCO VCS II Standard / Premium / Separate ECU",ConnectionPlace.DIRECT,ElectricalPath.K_LINE,"Разные исполнения имеют разные диагностические контакты. Нужна проверка полного номера блока и жгута.",VCS),
        CableResearchEntry("vcs2-can","WABCO VCS II Premium / Separate ECU",ConnectionPlace.FRONT,ElectricalPath.ISO11992,"CAN имеется не у всех исполнений; диагностика зависит от версии.",VCS),
        CableResearchEntry("wabco-side","WABCO ABS / EBS DIAG",ConnectionPlace.SIDE,ElectricalPath.K_LINE,"Проверить применимость фирменного жгута к конкретному блоку.", "https://www.wabco-customercentre.com/catalog/ru_RU/4463010230"),
        CableResearchEntry("wabco-tebs","WABCO TEBS D / E / iEBS",ConnectionPlace.FRONT,ElectricalPath.ISO11992,"Семейства для исследования; диагностический протокол и кабель ещё не подтверждены.", "https://www.wabco-customercentre.com/catalog/en_GB/4801020000"),
        CableResearchEntry("haldex-front","Haldex EB+",ConnectionPlace.FRONT,ElectricalPath.ISO11992,"Уточнить поколение и диагностический режим.",HALDEX),
        CableResearchEntry("haldex-side","Haldex EB+ SOV",ConnectionPlace.SIDE,ElectricalPath.ISO11898,"Отдельная физическая шина, нужна проверка версии и жгута.",HALDEX),
        CableResearchEntry("knorr-g2","Knorr-Bremse TEBS G2 / iTEBS X",ConnectionPlace.FRONT,ElectricalPath.ISO11992,"Исследовательская позиция, точная совместимость неизвестна.", "https://truckservices.knorr-bremse.com/en/de/products/service-new-parts/electronic-systems/trailer-ebs/"),
        CableResearchEntry("knorr-side-2023","Knorr-Bremse TEBS · Bayonet 5 V CAN",ConnectionPlace.SIDE,ElectricalPath.ISO11898,"Y138839 EN003, стр. 2,4: заводская схема и кабель K010837/EZ1037. Точная ревизия и транспорт требуют проверки.",KNORR_2023),
        CableResearchEntry("haldex-eb4-direct","Haldex EB+ 4.0 · H-CAN",ConnectionPlace.DIRECT,null,"Каталог Haldex: кабель 844511065 к H-CAN. Уровни/протокол не предполагаются автоматически.", "https://www.haldex.com/en/europe/trailer-application-guide/ebs/diagnostic/diag-tools/"),
        CableResearchEntry("haldex-gen3-direct","Haldex EB+ Gen3 · DIAG",ConnectionPlace.DIRECT,null,"Фирменный кабель 814036001; подтверждён порт, не рабочий профиль.",HALDEX),
        CableResearchEntry("knorr-legacy","Knorr-Bremse TEBS4 / ABS",ConnectionPlace.DIRECT,null,"Интерфейс и распиновку устанавливать по модели, без подбора наугад.", "https://www.jaltest.com/en/coverage/2/12/123/remorque/trailer/trailer/"),
        CableResearchEntry("vie-front","VIE / ТСР TEBS CAN 24",ConnectionPlace.FRONT,ElectricalPath.ISO11992,"Руководство VIE, стр. 4–7: WA-3601200 + WA-3601300, 125 кбит/с. Только вариант CAN 24; требуется проверка блока.",VIE),
        CableResearchEntry("vie-subsystem","VIE / ТСР TEBS SUBSYSTEM",ConnectionPlace.DIRECT,null,"Руководство VIE, стр. 5,7: T4463003700, 500 кбит/с; варианты с CAN 24 и без. Электрические уровни и полный pinout ещё требуют сверки.",VIE),
        CableResearchEntry("sorl-tebs","SORL TEBS",ConnectionPlace.DIRECT,null,"Уточнить точный номер блока и оригинальный диагностический жгут.",SORL),
        CableResearchEntry("sorl-abs","SORL ABS",ConnectionPlace.DIRECT,null,"В документации отдельный тестер; интерфейс конкретной модели не подтверждён.",SORL),
        CableResearchEntry("kormee","Ruili KORMEE TEBS",ConnectionPlace.DIRECT,null,"Исследовательский кандидат; диагностический порт ещё не установлен.", "https://patents.google.com/patent/CN115959098B/en")
    )
    fun search(query:String):List<CableResearchEntry> {
        val q=query.trim()
        return rows.filter { q.isEmpty() || it.name.contains(q,ignoreCase=true) || it.id.contains(q,ignoreCase=true) }
    }
}
