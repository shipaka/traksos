package ru.traksos.minidiagnostic

// Manual observations only, separate code spaces, no live ECU communication.
object KnorrSorlReference {
    const val KNORR_SOURCE="https://www.befa.gr/wp-content/uploads/2018/11/KB4TA.pdf"
    const val SORL_SOURCE="https://ru.scribd.com/document/702659426/"
    // Y250910 EN Rev 001, September 2016, pp4–5, PDF indices 63–64.
    // Visually checked grouped rows; omit conflicting AUXIO 12/13 labels and non-fault 1/1.
    private val kb=buildMap<String,Pair<String,String>> {
        val sensorFaults=listOf("Большой зазор","Потеря сигнала","Помехи сигнала",
            "КЗ или обрыв","Недопустимое различие размеров шин","Ошибка конфигурации датчиков")
        listOf("SL","SR","SAL","SAR").forEachIndexed { i,sensor ->
            sensorFaults.forEachIndexed { j,condition ->
                put("${i+2}/${j+1}","Колёсный датчик "+sensor to condition)
            }
        }
        put("6/1","Питание" to "Повышенное напряжение")
        put("6/2","Питание" to "Пониженное напряжение")
        put("6/3","Питание" to "Высокое сопротивление цепи ISO 7638, контакт 1")
        listOf("M22","M21","AUXIO1 / модулятор 2").forEachIndexed { i,component ->
            put("${i+7}/2",component to "КЗ или обрыв выпускного соленоида")
            put("${i+7}/3",component to "Ошибка установки клапана ABS")
            put("${i+7}/4",component to "Ошибка конфигурации клапана")
        }
        put("10/1","Общие цепи" to "Внутреннее КЗ на массу")
        put("10/2","AUXIO1 / модулятор 2" to "КЗ на массу")
        put("10/3","Модулятор ABS" to "Динамический сбой всех клапанов")
        put("10/4","ABS" to "Чрезмерная активность")
        put("10/5","AUXIO1 / модулятор 2" to "КЗ на питание")
        put("11/1","ЭБУ" to "Внутренняя ошибка")
        put("11/2","ЭБУ" to "Ошибка конфигурации")
        put("14/2","Обслуживание" to "Превышен сервисный интервал")
    }
    // SORL trailer ABS operating manual, table 2, pp14–15; two HTML copies agree.
    // Scope limited to the documented family; exact ECU part/revision not yet established.
    private val sl=buildMap<String,Pair<String,String>> {
        put("2.1","Клапан модулятора" to "Неисправность катушки либо КЗ/обрыв проводки")
        put("2.2","Ускорительный клапан" to "Неисправность катушки либо КЗ/обрыв проводки")
        for(i in 1..4) {
            put("3.$i","Датчик, гнездо $i" to "КЗ или обрыв катушки/проводки")
            put("4.$i","Датчик, гнездо $i" to "Неверный зазор до ротора")
        }
    }
    fun knorr(code:String)=kb[code]
    fun sorl(code:String)=sl[code]
    val knorrCount get()=kb.size
    val sorlCount get()=sl.size
}
