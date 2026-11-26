package ru.traksos.minidiagnostic

// Exact messages from SORL electronic trailer ABS tester; not blink counts,
// bare group numbers, wire DTCs or confirmation of ECU version.
object SorlTrailerTesterReference {
    const val SOURCE="https://sorl.ru/manuals/rukovodstvo-polzovatelya-dlya-portativnogo-diagnosticheskogo-kompleksa-abs-sorl.pdf?v="
    private data class Entry(val component:String,val condition:String,val page:Int)
    private val rows=buildMap<String,Entry> {
        put("2.1 Нет КМ",Entry("Клапан модулятора","Не обнаружен клапан; проверить подключение и цепь",12))
        put("2.1 КЗ КМ",Entry("Клапан модулятора","Короткое замыкание цепи клапана",12))
        put("2.1 Ош. клапана",Entry("Клапан модулятора","Сбой клапана без уточнения характера",12))
        put("2.2 Нет КУ",Entry("Ускорительный клапан","Не обнаружен клапан; проверить подключение и цепь",12))
        put("2.2 КЗ КУ",Entry("Ускорительный клапан","Короткое замыкание цепи клапана",12))
        put("2.3 Нет М Л",Entry("Левый модулятор","Не обнаружен модулятор; проверить подключение",12))
        put("2.3 КЗ М Л",Entry("Левый модулятор","Короткое замыкание цепи модулятора",12))
        put("2.4 Нет М П",Entry("Правый модулятор","Не обнаружен модулятор; проверить подключение",12))
        put("2.4 КЗ М П",Entry("Правый модулятор","Короткое замыкание цепи модулятора",12))
        for(n in 1..4) {
            val sensor="Датчик скорости колеса "+n
            put("3.$n Нет Д №$n",Entry(sensor,"Датчик не обнаружен; проверить подключение",13))
            put("3.$n КЗ Д №$n",Entry(sensor,"Короткое замыкание цепи датчика",13))
            put("4.$n Зазор Д №$n",Entry(sensor,"Нарушение зазора между датчиком и импульсным кольцом",13))
            put("4.$n Сигнал Д №$n",Entry(sensor,"Ненадёжное соединение датчика; проверить разъём и проводку",13))
        }
        put("8.2 Низк. напр.",Entry("Питание ABS","Недостаточное напряжение; порог в таблице не указан",14))
        put("8.3 Выс. напр.",Entry("Питание ABS","Повышенное напряжение; порог в таблице не указан",14))
    }
    private val screenKeys=(1..4).associate { n -> "3.$n Нет Д $n" to "3.$n Нет Д №$n" }
    fun lookup(code:String):DisplayLookup? {
        val key=screenKeys[code] ?: code
        val r=rows[key] ?: return null
        return DisplayLookup(r.component,r.condition,SOURCE+"#page="+r.page+
            " · тестер 36302900020"+(if(code in screenKeys) "; вариант экрана стр.7" else ""),true)
    }
    val count get()=rows.size
}
