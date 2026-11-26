package ru.traksos.minidiagnostic

// Manual reference only: normalized observed codes, no lamp sampling or electrical activation.
object AdditionalAbsReference {
    const val HALDEX_SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf"
    const val EKRAN_SOURCE="https://ru.scribd.com/document/499456384/"
    // Haldex U-ABS Installation Guide 2013, pp69–70. Only supported active fault blink codes.
    // Exclude N/A, non-fault states, and entries explicitly marked unimplemented.
    private val h=buildMap<String,Pair<String,String>> {
        listOf("1A","1B","2A","2B").forEachIndexed { i,s ->
            val sensor="Датчик колеса S"+s
            put("0"+(i+1),sensor to "Обрыв или КЗ проводки")
            put("1"+(i+1),sensor to "Избыточный зазор")
            put("2"+(i+1),sensor to "Нестабильное выходное напряжение")
        }
        for(i in 1..3) put("4"+i,"Клапан 2."+i to "Медленное восстановление скорости колеса")
        for((prefix,condition) in listOf(6 to "Обрыв",7 to "КЗ на массу",8 to "КЗ на плюс")) {
            for(i in 1..2) {
                put("$prefix$i","Клапан удержания 2."+i to condition)
                put("$prefix"+(i+6),"Клапан выпуска 2."+i to condition)
            }
        }
        put("80","Цепи клапанов" to "Утечка тока / нарушение изоляции")
        put("90","Питание ЭБУ" to "Просадка при включении соленоида")
        put("91","Питание соленоидов" to "Нет внутреннего напряжения")
        put("92","Питание ЭБУ" to "Напряжение выше 32 В")
        put("93","Реле ЭБУ" to "Короткое замыкание")
        put("99","ЭБУ ABS" to "Ошибка контрольной суммы")
    }
    // Ekran manufacturer's brief service instruction, version 19.09.2018, appendix V, table V.1.
    // Table's 0/0 indication is excluded: it must never be interpreted as a roadworthiness certificate.
    private val e=buildMap<String,Pair<String,String>> {
        for(axle in 1..2) {
            for((offset,side) in listOf(0 to "L",4 to "R")) {
                val wheel="Датчик колеса "+axle+side
                put("$axle/"+(offset+1),wheel to "Недостоверная скорость")
                put("$axle/"+(offset+2),wheel to "Короткое замыкание")
                put("$axle/"+(offset+3),wheel to "Обрыв")
            }
        }
        val conditions=listOf("Обрыв впуска либо КЗ на плюс","КЗ впуска на массу",
            "Обрыв выпуска либо КЗ на плюс","КЗ выпуска на массу",
            "КЗ между цепями впуска и выпуска","Иная неисправность")
        for(group in 3..5) conditions.forEachIndexed { i,condition ->
            put("$group/"+(i+1),"Модулятор М"+(group-2) to condition)
        }
        put("6/1","Конфигурация ABS" to "Не соответствует заданной")
        put("6/2","Электропитание" to "Пониженное при включении")
        put("6/3","Электропитание" to "Пониженное при движении")
        put("6/4","ЭБУ" to "Внутренняя ошибка")
    }
    fun haldex(code:String):Pair<String,String>?=h[code]
    fun ekran(code:String):Pair<String,String>?=e[code]
    val haldexCount get()=h.size
    val ekranCount get()=e.size
}
