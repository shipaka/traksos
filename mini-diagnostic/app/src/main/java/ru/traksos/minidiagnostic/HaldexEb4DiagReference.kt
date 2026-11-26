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
    init { require(byCode.size==rows.size && byLabel.size==rows.size) }
    private const val GUIDE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300056_en.pdf"
    private val named=mapOf(
        "AUX 4 OC" to DisplayLookup("Цепь AUX4 · контроль износа накладок",
            "Обрыв цепи. Если AUX4 настроен для контроля износа, сообщение может означать износ тормозных накладок. Проверить фактический износ и цепь датчика; не считать один код доказательством износа.",GUIDE+"#page=59",true),
        "AUX 4 SC" to DisplayLookup("Цепь AUX4 · контроль износа накладок",
            "Короткое замыкание цепи. При подключённом контроле износа это также сигнал нарушения целостности цепи датчиков. Проверить жгут и датчики, не обходить контроль износа.",GUIDE+"#page=61",true),
        "External TPMS" to DisplayLookup("Внешняя система контроля давления шин",
            "Возможна потеря связи с приёмным блоком RCU системы TPMS 1.0. Проверить наличие, питание и подключение приёмника; конкретная причина требует проверки.",GUIDE+"#page=41",true)
    )
    fun lookup(code:String):DisplayLookup? {
        named[code]?.let { return it }
        val r=byCode[code] ?: byLabel[code] ?: return null
        return DisplayLookup(r.component,r.condition,SOURCE+" · DIAG++ "+r.code,true)
    }
    val count get()=rows.size+named.size
    val numericCount get()=rows.size
}
