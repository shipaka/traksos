package ru.traksos.minidiagnostic

// SD-13-4767 US 004, 2015, printed pp11–13. Standard/Premium only.
// 12 V market: informational lookup; no PLC, J1587 hardware, or active commands.
data class BendixDisplayEntry(val blink:String,val component:String,val condition:String,
    val sid:Int,val fmis:Set<Int>,val page:Int)
object BendixTabs6Reference {
    const val SOURCE="https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/hdTZdpMPI0EBhB_SD-13-4767_US_004.pdf"
    private val rows=buildList<BendixDisplayEntry> {
        fun entry(code:String,c:String,d:String,sid:Int,fmis:Set<Int>,page:Int) {
            add(BendixDisplayEntry(code,c,d,sid,fmis,page))
        }
        listOf("SL","SR","SAL","SAR").forEachIndexed { i,s ->
            val c="Колёсный датчик $s"
            val n=i+2
            entry("$n/1",c,"Чрезмерный зазор",i+1,setOf(0),11)
            entry("$n/2",c,"Пропадание сигнала",i+1,setOf(1),11)
            entry("$n/3",c,"Помехи в сигнале",i+1,setOf(2),11)
            entry("$n/4",c,"КЗ или обрыв",i+1,setOf(4,5),11)
            entry("$n/5",c,"Диаметр шины вне допуска",i+1,setOf(13),11)
            if(i>=2) entry("$n/6",c,"Ошибка конфигурации",i+1,setOf(13),12)
        }
        entry("6/1","Питание","Перенапряжение",251,setOf(3),12)
        entry("6/2","Питание","Пониженное напряжение",251,setOf(4),12)
        entry("6/3","Питание","Чрезмерное сопротивление цепи",251,setOf(13),12)
        for(i in 1..3) {
            val c="Модулятор MOD$i"
            val n=i+6
            val electrical=setOf(3,4,5,6,12)
            entry("$n/1","$c · клапан удержания","КЗ или обрыв",41+i,electrical,12)
            entry("$n/2","$c · выпускной клапан",if(i==3) "КЗ" else "КЗ или обрыв",47+i,electrical,12)
            entry("$n/3",c,"Динамическая неисправность",6+i,setOf(7),12)
            if(i>=2) entry("$n/4",c,"Ошибка конфигурации клапана",6+i,setOf(13),12)
        }
        entry("10/1","MOD1/2","КЗ на массу нижнего ключа",7,setOf(4),12)
        entry("10/2","MOD3","КЗ на массу нижнего ключа",9,setOf(4),12)
        entry("10/3","Все модуляторы","Динамическая неисправность",7,setOf(7),12)
        entry("10/4","ABS","Чрезмерная активность",1,setOf(7),12)
        entry("11/1","ЭБУ","Внутренняя ошибка",254,setOf(12),12)
        entry("11/2","ЭБУ","Ошибка конфигурации",254,setOf(13),12)
        entry("12/1","Диагностическая линия J1587","КЗ или обрыв",250,setOf(3,4,5,6,12),13)
        entry("13/1","Лампа ABS","КЗ или обрыв",81,setOf(3,4,5,6,12),13)
        entry("14/1","Тормозные накладки","Сигнал износа",70,setOf(1),13)
        entry("14/2","ТО","Истёк сервисный интервал",104,setOf(0),13)
    }
    private val byBlink=rows.associateBy { it.blink }
    init { check(byBlink.size==rows.size) }
    fun lookup(code:String)=byBlink[code]
    // Reverse lookup deliberately returns all candidates; SID/FMI can be ambiguous.
    fun bySidFmi(sid:Int,fmi:Int):List<BendixDisplayEntry> =
        rows.filter { it.sid==sid && fmi in it.fmis }
    val count get()=rows.size
}
