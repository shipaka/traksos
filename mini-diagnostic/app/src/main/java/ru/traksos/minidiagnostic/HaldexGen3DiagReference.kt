package ru.traksos.minidiagnostic

// Four additional diagnostic display labels, OEM Gen3 guide pp. 110–111.
// Manual display aliases are separate from the four additional fault entries; no raw decoding.
object HaldexGen3DiagReference {
    private const val SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300018_ru.pdf"
    private data class Entry(val component:String,val condition:String,val page:Int)
    private val rows=mapOf(
        "Brake apply solenoid unspecified fault" to Entry("Соленоид подачи тормозного давления","Нарушение в цепи управления; вид электрического сбоя не уточнён",110),
        "Excessive reservoir pressure" to Entry("Давление в ресивере","Превышен порог 9,75 бар согласно этой редакции руководства",110),
        "ECU shutdown FET" to Entry("Электронный блок управления","Руководство Gen3 указывает внутреннюю неисправность. При наличии CAN Hub также проверить применимость бюллетеня PB0268M: сообщение ECU SHUTDOWN может быть связано с отдельным CAN Hub; не делать вывод о замене модулятора по одному сообщению.",111),
        "External TPMS" to Entry("Внешняя система контроля давления шин","Аппаратная неисправность системы; требуется уточнение элемента",111)
    )
    private const val EN_COPY="https://www.iridiumzv.sk/files/2017-03-28-171329-EB_3_in__tala__n___manu__l.pdf#page=110"
    // The English OEM guide groups wheels/channels. Never infer which member is faulty.
    private val aliases=buildMap<String,Entry> {
        for (axle in listOf("1","2")) {
            val component="Датчик скорости колеса "+axle+"A или "+axle+"B"
            put("Wheel sensor ${axle}A or ${axle}B continuity",Entry(component,"Обрыв или КЗ цепи датчика; конкретное колесо не определено",110))
            put("Wheel sensor ${axle}A or ${axle}B signal integrity",Entry(component,"Нарушение достоверности сигнала; конкретное колесо не определено",110))
            put("Wheel sensor ${axle}A or ${axle}B output level",Entry(component,"Нарушение работы сигнальной цепи; конкретное колесо не определено",110))
        }
        for ((mode,component) in listOf("hold" to "Клапан удержания давления", "dump" to "Клапан сброса давления")) {
            val c=component+" EPRV 21 или 22"
            for ((suffix,description) in listOf(
                "short circuit" to "Короткое замыкание",
                "open circuit" to "Обрыв цепи",
                "short to B+" to "Замыкание на питание",
                "unspecified fault" to "Ошибка управления без уточнения вида"
            )) put("EPRV 21 or 22 $mode solenoid $suffix",Entry(c,description+"; конкретный канал не определён",110))
        }
        val pressure="Датчик выходного давления EPRV 21 или 22"
        put("EPRV 21 or 22 delivery sensor short circuit",Entry(pressure,"Короткое замыкание; конкретный канал не определён",110))
        put("EPRV 21 or 22 delivery open circuit",Entry(pressure,"Обрыв цепи; конкретный канал не определён",110))
        put("EPRV 21 or 22 slow wheel recovery",Entry("Модулятор EPRV 21 или 22","Замедленное восстановление скорости одного колеса; канал не определён",110))
    }
    val aliasCount get()=aliases.size
    fun lookup(code:String):DisplayLookup? {
        aliases[code]?.let { return DisplayLookup(it.component,it.condition,EN_COPY,false) }
        val r=rows[code] ?: return null
        return DisplayLookup(r.component,r.condition,SOURCE+"#page="+r.page+
            (if(code=="ECU shutdown FET") " · дополнительно "+HaldexAuxReference.HUB_SOURCE else ""),true)
    }
    val count get()=rows.size
}
