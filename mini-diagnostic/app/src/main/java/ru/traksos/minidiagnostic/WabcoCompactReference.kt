package ru.traksos.minidiagnostic

// Manual display of the original Compact Tester II, not a trailer-specific DTC table.
// The two independent fields do not prove that the pair is valid for an ECU.
object WabcoCompactReference {
    const val SOURCE="https://www.wabco-customercentre.com/catalog/docs/8150101073.pdf"
    private val paths=buildMap<Char,String> {
        for((i,letter) in ('A'..'F').withIndex()) put(('1'.code+i).toChar(),"Датчик колеса $letter")
        for((i,letter) in ('A'..'F').withIndex()) put("789ACE"[i],"Модулятор колеса $letter")
        put('F',"Дифференциальный клапан")
        put('H',"Ретардер / ISS")
        put('P',"Управление двигателем / интерфейс")
        put('J',"Generic I/O")
        put('O',"Насос рециркуляции")
        put('d',"Реле клапана")
        put('U',"Переключатель челночного клапана")
        put('L',"ЭБУ")
    }
    private val types=mapOf('1' to "Большой зазор", '2' to "Дефект ротора",
        '3' to "Недостоверный сигнал", '4' to "Неверный размер шины", '5' to "Обрыв",
        '6' to "Внутреннее КЗ", '7' to "КЗ на питание", '8' to "КЗ на массу",
        '9' to "КЗ / внешнее питание / КЗ катушки", 'A' to "Ошибка времени",
        'C' to "Проскальзывание", 'E' to "Перенапряжение", 'F' to "Пониженное напряжение",
        'H' to "Реле или положение переключателя", 'P' to "Неисправный компонент",
        'O' to "Заклинивание насоса", 'd' to "Датчик давления",
        'U' to "Ошибка конфигурации ЭБУ", 'L' to "Контрольная лампа ABS")
    fun lookup(code:String):DisplayLookup? {
        if(code.length!=3 || code[2] !in '1'..'9') return null
        val path=paths[code[0]] ?: return null
        val type=types[code[1]] ?: return null
        val count=if(code[2]=='9') "9 или более" else code[2].toString()
        return DisplayLookup(path,"$type; число регистраций по дисплею: $count",SOURCE,false)
    }
    val fieldCount get()=paths.size+types.size
}
data class PartRange(val targetId:String,val first:Long,val last:Long,val linkLayer:String)
object WabcoPartReference {
    // Manufacturer table, printed p8. Numeric range membership is a lead, not part existence.
    val ranges=listOf(
        PartRange("zf-vario-c",4461050010L,4461050520L,"JED 677"),
        PartRange("zf-vcs",4461080300L,4461080500L,"JED 677"),
        PartRange("zf-vcs",4005000300L,4005000670L,"JED 677"),
        PartRange("zf-tcs-i",4725000010L,4725000210L,"SAE J1587"),
        PartRange("zf-tcs-ii",4005001010L,4005001060L,"SAE J1587"),
        PartRange("zf-vcs-ii",4461080700L,4461080890L,"KWP2000"),
        PartRange("zf-vcs-ii",4005000700L,4005000890L,"KWP2000")
    )
    fun find(input:String):List<PartRange> {
        if(input.length>120 || input.any { it !in '0'..'9' && it!=' ' && it!='-' }) return emptyList()
        val number=input.filter { it in '0'..'9' }
        if(number.length!=10 || !number.endsWith("0")) return emptyList()
        val n=number.toLong()
        return ranges.filter { n in it.first..it.last }
    }
}
