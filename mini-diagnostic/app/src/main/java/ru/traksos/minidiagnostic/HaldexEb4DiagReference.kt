package ru.traksos.minidiagnostic

// Explicitly visible DIAG++ 2025 p.29 rows and documented named faults.
// Hex labels are
// diagnostic-software identifiers, not established on-wire ECU DTCs.
object HaldexEb4DiagReference {
    const val SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300056_en.pdf#page=29"
    private data class Entry(val code:String,val label:String,val component:String,val condition:String)
    private val rows=listOf(
        Entry("0x01","S1A continuity","Датчик скорости колеса 1A","Обрыв или короткое замыкание в проводке датчика. Проверить разъёмы, коррозию, повреждения проводки и соответствие установленной конфигурации; точное место дефекта требует проверки."),
        Entry("0x03","S1A signal integrity","Датчик скорости колеса 1A","Нарушение достоверности сигнала датчика"),
        Entry("0x04","S1A output","Датчик скорости колеса 1A","Некорректный уровень выходного сигнала датчика"),
        Entry("0x09","S1B continuity","Датчик скорости колеса 1B","Нарушение электрической цепи датчика"),
        Entry("0x0B","S1B signal integrity","Датчик скорости колеса 1B","Нарушение достоверности сигнала датчика"),
        Entry("0x0C","S1B output","Датчик скорости колеса 1B","Некорректный уровень выходного сигнала датчика"),
        Entry("0x11","S2A continuity","Датчик скорости колеса 2A","Нарушение электрической цепи датчика"),
        Entry("0x13","S2A signal integrity","Датчик скорости колеса 2A","Нарушение достоверности сигнала датчика"),
        Entry("0x14","S2A output","Датчик скорости колеса 2A","Некорректный уровень выходного сигнала датчика"),
        Entry("0x19","S2B continuity","Датчик скорости колеса 2B","Нарушение электрической цепи датчика"),
        Entry("0x1B","S2B signal integrity","Датчик скорости колеса 2B","Нарушение достоверности сигнала датчика"),
        Entry("0x1C","S2B output","Датчик скорости колеса 2B","Некорректный уровень выходного сигнала датчика"),
        Entry("0x21","SA SLAVE 1 continuity","Датчик скорости колеса A дополнительного блока 1","Нарушение электрической цепи датчика"),
        Entry("0x23","SA SLAVE 1 signal integrity","Датчик скорости колеса A дополнительного блока 1","Нарушение достоверности сигнала датчика"),
        Entry("0x24","SA SLAVE 1 output","Датчик скорости колеса A дополнительного блока 1","Некорректный уровень выходного сигнала датчика"),
        Entry("0x29","SB SLAVE 1 continuity","Датчик скорости колеса B дополнительного блока 1","Нарушение электрической цепи датчика"),
        Entry("0x2B","SB SLAVE 1 signal integrity","Датчик скорости колеса B дополнительного блока 1","Нарушение достоверности сигнала датчика"),
        Entry("0x2C","SB SLAVE 1 output","Датчик скорости колеса B дополнительного блока 1","Некорректный уровень выходного сигнала датчика"),
        Entry("0x31","SA SLAVE 2 continuity","Датчик скорости колеса A дополнительного блока 2","Нарушение электрической цепи датчика"),
        Entry("0x33","SA SLAVE 2 signal integrity","Датчик скорости колеса A дополнительного блока 2","Нарушение достоверности сигнала датчика"),
        Entry("0x34","SA SLAVE 2 output","Датчик скорости колеса A дополнительного блока 2","Некорректный уровень выходного сигнала датчика"),
        Entry("0x39","SB SLAVE 2 continuity","Датчик скорости колеса B дополнительного блока 2","Нарушение электрической цепи датчика")
    )
    private val byCode=rows.associateBy { it.code }
    private val byLabel=rows.associateBy { it.label }
    // Full Name column of the same 22 visible rows on page 29, not additional faults.
    private val fullNames=mapOf(
        "Wheel sensor 1A continuity" to "0x01",
        "Wheel sensor 1A signal integrity" to "0x03",
        "Wheel sensor 1A output level" to "0x04",
        "Wheel sensor 1B continuity" to "0x09",
        "Wheel sensor 1B signal integrity" to "0x0B",
        "Wheel sensor 1B output level" to "0x0C",
        "Wheel sensor 2A continuity" to "0x11",
        "Wheel sensor 2A signal integrity" to "0x13",
        "Wheel sensor 2A output level" to "0x14",
        "Wheel sensor 2B continuity" to "0x19",
        "Wheel sensor 2B signal integrity" to "0x1B",
        "Wheel sensor 2B output level" to "0x1C",
        "Wheel sensor A (slave 1) continuity" to "0x21",
        "Wheel sensor A (slave 1) signal integrity" to "0x23",
        "Wheel sensor A (slave 1) output level" to "0x24",
        "Wheel sensor B (slave 1) continuity" to "0x29",
        "Wheel sensor B (slave 1) signal integrity" to "0x2B",
        "Wheel sensor B (slave 1) output level" to "0x2C",
        "Wheel sensor A (slave 2) continuity" to "0x31",
        "Wheel sensor A (slave 2) signal integrity" to "0x33",
        "Wheel sensor A (slave 2) output level" to "0x34",
        "Wheel sensor B (slave 2) continuity" to "0x39"
    )
    init {
        require(byCode.size==rows.size && byLabel.size==rows.size)
        require(fullNames.size==rows.size && fullNames.values.toSet()==byCode.keys)
    }
    val fullNameCount get()=fullNames.size
    private const val GUIDE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300056_en.pdf"
    // Extended DTC screenshot, p.26: exact visible names, no numeric identifiers.
    // The guide covers EBS and ABS 4.0; manual reference only, no ECU-specific raw mapping.
    private fun electrical(component:String)=DisplayLookup(component,
        "Электрическая неисправность цепи клапана. Точный вид повреждения не указан; требуется профессиональная проверка тормозной системы.",GUIDE+"#page=26",true)
    private val named=mapOf(
        "Soft Docking" to DisplayLookup("Система безопасного приближения к рампе",
            "Общая неисправность EB+ Soft Docking. DIAG++ в редакции руководства 2025 года не раскрывает конкретную причину; необходима отдельная диагностика системы.",GUIDE+"#page=135",true),
        "BRK apply master electric failure" to electrical("Клапан подачи тормозного давления основного модулятора"),
        "EPRV 21 master hold electric failure" to electrical("Клапан удержания давления EPRV 21 основного модулятора"),
        "EPRV 21 master dump electric failure" to electrical("Клапан сброса давления EPRV 21 основного модулятора"),
        "EPRV 22 master hold electric failure" to electrical("Клапан удержания давления EPRV 22 основного модулятора"),
        "EPRV 22 master dump electric failure" to electrical("Клапан сброса давления EPRV 22 основного модулятора"),
        "AUX 4 OC" to DisplayLookup("Цепь AUX4 · контроль износа накладок",
            "Обрыв цепи. Если AUX4 настроен для контроля износа, сообщение может означать износ тормозных накладок. Проверить фактический износ и цепь датчика; не считать один код доказательством износа.",GUIDE+"#page=59",true),
        "AUX 4 SC" to DisplayLookup("Цепь AUX4 · контроль износа накладок",
            "Короткое замыкание цепи. При подключённом контроле износа это также сигнал нарушения целостности цепи датчиков. Проверить жгут и датчики, не обходить контроль износа.",GUIDE+"#page=61",true),
        "External TPMS" to DisplayLookup("Внешняя система контроля давления шин",
            "В TPMS 1.0 возможны отсутствие связи с приёмником RCU или активное предупреждение о превышении настроенного порога давления либо температуры. Проверить фактическое давление и температуру шин, наличие и подключение RCU; сообщение само по себе не доказывает отказ приёмника. См. также стр. 36 руководства.",GUIDE+"#page=41",true)
    )
    fun lookup(code:String):DisplayLookup? {
        named[code]?.let { return it }
        val r=byCode[code] ?: byLabel[code] ?: fullNames[code]?.let { byCode[it] } ?: return null
        return DisplayLookup(r.component,r.condition,SOURCE+" · DIAG++ "+r.code,true)
    }
    val count get()=rows.size+named.size
    val numericCount get()=rows.size
}
