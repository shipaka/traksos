package ru.traksos.minidiagnostic

// Preliminary exact display pairs from indexed text of bulletin 4007de0 (2004).
// Original page not visually verified. Never use for live ECU decoding.
object WabcoCdBulletinReference {
    const val SOURCE="https://www.yumpu.com/de/document/view/32824356/elektrische-fehler-in-der-trailer-ebs"
    private val rows=mapOf(
        "077/03" to ("Датчик заданного давления" to "Повышенное напряжение либо КЗ на питание"),
        "077/04" to ("Датчик заданного давления" to "Пониженное напряжение либо КЗ на массу"),
        "077/13" to ("Датчик заданного давления" to "Нарушение характеристики датчика"),
        "078/00" to ("Внешний датчик заданного давления или тормозной клапан прицепа" to "Значение слишком высокое; узел зависит от конфигурации"),
        "078/03" to ("Внешний датчик заданного давления или тормозной клапан прицепа" to "Повышенное напряжение либо КЗ на питание"),
        "078/04" to ("Внешний датчик заданного давления или тормозной клапан прицепа" to "Пониженное напряжение либо КЗ на массу"),
        "221/03" to ("Питание датчиков модулятора 24 В" to "Повышенное напряжение либо КЗ на питание"),
        "221/04" to ("Питание датчиков модулятора 24 В" to "Пониженное напряжение либо КЗ на массу"),
        "246/04" to ("Выключатель тормозного клапана прицепа" to "Пониженное напряжение либо КЗ на массу"),
        "246/05" to ("Выключатель тормозного клапана прицепа" to "Обрыв подводящей цепи")
    )
    val count get()=rows.size
    fun lookup(code:String):DisplayLookup? {
        if(!Regex("[0-9]{2,3}/[0-9]{2}").matches(code)) return null
        val (spn,fmi)=code.split("/")
        val r=rows[spn.padStart(3,'0')+"/"+fmi] ?: return null
        return DisplayLookup(r.first,"Предварительно: "+r.second+". Сверить оригинал бюллетеня и версию ПО C1–D.",SOURCE,false)
    }
}
