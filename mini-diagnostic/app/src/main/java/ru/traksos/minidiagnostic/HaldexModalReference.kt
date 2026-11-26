package ru.traksos.minidiagnostic

// 700095-EN pp18–19, DDU/TODD display namespace only, not a blink or wire protocol.
// MODAL and MODULAR share the manufacturer's table; specific configuration may omit channels.
object HaldexModalReference {
    const val SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/abs-system/700095-EN.pdf"
    private val rows=buildMap<String,Pair<String,String>> {
        listOf("1A","1B","2A","2B","3A","3B").forEachIndexed { i,s ->
            val sensor="Датчик колеса $s"
            put("0"+(i+1),sensor to "Обрыв или КЗ цепи")
            put("1"+(i+1),sensor to "Слабый сигнал")
            put("2"+(i+1),sensor to "Периодическое снижение сигнала")
        }
        put("08","Реле ретардера" to "Обрыв цепи")
        put("09","Реле ретардера" to "Короткое замыкание")
        put("20","Зубчатый ротор ABS" to "Несоответствующий тип ротора")
        put("40","Датчики колёс" to "Перепутаны соединения по сторонам оси")
        listOf("красный","синий","жёлтый").forEachIndexed { i,color ->
            put((41+i).toString(),"Колесо канала ($color)" to "Замедленное восстановление скорости")
            for((base,condition) in listOf(61 to "Обрыв",71 to "КЗ",81 to "КЗ на плюс или малое сопротивление")) {
                put((base+i).toString(),"Клапан удержания ($color)" to condition)
                // 88 is also the display segment check: omit from fault-only lookup.
                if(base+i+6!=88) put((base+i+6).toString(),"Выпускной клапан ($color)" to condition)
            }
        }
        put("80","Соленоиды / жгут" to "Нарушение изоляции")
        put("90","Питание ЭБУ" to "Просадка под нагрузкой соленоида: ниже 18 В для 24-вольтовой системы, ниже 9 В для 12-вольтовой")
        put("91","Питание ISO 7638" to "Неисправность цепи контакта 1 или предохранителя")
        put("92","Питание ЭБУ (24 В)" to "Выше 32 В; значение для 12 В требует уточнения")
        put("93","ЭБУ" to "Внутренний сбой")
        put("99","ЭБУ" to "Внутренний сбой")
        put("CF","Конфигурация ABS" to "Недопустимое сочетание датчиков и соленоидов")
        put("OA","Соленоид COLAS" to "Обрыв")
        put("OC","Соленоид COLAS" to "КЗ")
        put("OE","Цепь контрольной лампы" to "Обрыв или КЗ; возможна неисправность лампы")
    }
    fun lookup(code:String):Pair<String,String>?=rows[code]
    val count get()=rows.size
}
