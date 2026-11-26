package ru.traksos.minidiagnostic

// Four additional diagnostic display labels, OEM Gen3 guide pp. 110–111.
// Not raw diagnostic bytes; no alias expansion or inference across generations.
object HaldexGen3DiagReference {
    private const val SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300018_ru.pdf"
    private data class Entry(val component:String,val condition:String,val page:Int)
    private val rows=mapOf(
        "Brake apply solenoid unspecified fault" to Entry("Соленоид подачи тормозного давления","Нарушение в цепи управления; вид электрического сбоя не уточнён",110),
        "Excessive reservoir pressure" to Entry("Давление в ресивере","Превышен порог 9,75 бар согласно этой редакции руководства",110),
        "ECU shutdown FET" to Entry("Электронный блок управления","Внутренняя неисправность ЭБУ",111),
        "External TPMS" to Entry("Внешняя система контроля давления шин","Аппаратная неисправность системы; требуется уточнение элемента",111)
    )
    fun lookup(code:String):DisplayLookup? {
        val r=rows[code] ?: return null
        return DisplayLookup(r.component,r.condition,SOURCE+"#page="+r.page,true)
    }
    val count get()=rows.size
}
