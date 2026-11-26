package ru.traksos.minidiagnostic

// Display namespace only. Component IDs are decimal strings, never raw UDS DTCs.
// Selected documented entries; this is not a complete manufacturer table.
data class SmartBoardComponent(val code: String,val titleRu: String,val source: String)
data class SmartBoardFaultType(val code: String,val titleRu: String,val source: String)
data class SmartBoardMessage(val component: SmartBoardComponent?,val faultType: SmartBoardFaultType?)
object SmartBoardReference {
    const val SOURCE = "https://www.wabco-customercentre.com/catalog/docs/8150101383.pdf"
    const val SOURCE_TYPES = SOURCE+"#page=28"
    internal fun componentSource(code:String,legacyD:Boolean=false):String = SOURCE+"#page="+when {
        code in setOf("220","251","253","254") -> 27
        legacyD || code.toInt()<=93 -> 25
        code.toInt()<=165 -> 26
        else -> 27
    }
    private val shared = ('A'..'F').mapIndexed { i, letter ->
        SmartBoardComponent("00"+(i+1),"Колёсный датчик "+letter,componentSource("00"+(i+1)))
    } + listOf(
        SmartBoardComponent("009","Модулятор прицепа: цепь управления клапанами",componentSource("009")),
        SmartBoardComponent("069","Встроенный датчик осевой нагрузки",componentSource("069")),
        SmartBoardComponent("075","Датчик износа тормозных накладок",componentSource("075")),
        SmartBoardComponent("077","Внутренний датчик заданного давления",componentSource("077")),
        SmartBoardComponent("078","Внешний датчик заданного давления",componentSource("078")),
        SmartBoardComponent("088","Датчик бокового ускорения",componentSource("088")),
        SmartBoardComponent("220","Связь тягача с прицепом",componentSource("220")),
        SmartBoardComponent("251","Электропитание",componentSource("251")),
        SmartBoardComponent("253","Настройки параметров",componentSource("253")),
        SmartBoardComponent("254","Модулятор прицепа",componentSource("254"))
    )
    private fun components(vararg rows: Pair<String,String>) =
        rows.map { SmartBoardComponent(it.first,it.second,componentSource(it.first)) }
    private val d = (shared + components(
        "007" to "Модулятор прицепа",
        "010" to "Релейный клапан EBS/ABS",
        "058" to "Модулятор прицепа",
        "059" to "Модулятор прицепа",
        "061" to "Релейный клапан EBS",
        "062" to "Релейный клапан EBS: измерение давления",
        "081" to "Пневматическая управляющая магистраль",
        "083" to "Датчик давления питания",
        "221" to "Питание датчиков модулятора 24 В",
        "232" to "Питание датчиков модулятора 5 В",
        "246" to "Выключатель тормозного клапана прицепа"
    )+SmartBoardSystemReference.driverExtras(true)).associateBy { it.code }
    private val e = (shared + components(
        "007" to "Релейный клапан EBS/ABS: управление соленоидами",
        "010" to "Модулятор прицепа: управление соленоидами",
        "058" to "Релейный клапан EBS: резервирование",
        "059" to "Релейный клапан EBS: измерение давления",
        "061" to "Модулятор прицепа: резервирование",
        "062" to "Модулятор прицепа: датчики давления",
        "080" to "Внутренний датчик управляющего давления",
        "081" to "Датчик тормозного давления оси C–D",
        "083" to "Переключатель 2 длины прицепа"
    )+SmartBoardSystemReference.driverExtras(false)).associateBy { it.code }
    private val types = listOf(
        "00" to "Значение выше допустимого",
        "01" to "Значение ниже допустимого",
        "02" to "Некорректные или нестабильные данные",
        "03" to "Перенапряжение либо замыкание на плюс 24 В",
        "04" to "Недостаточное напряжение либо замыкание на массу",
        "05" to "Обрыв питающего проводника",
        "06" to "Превышение тока либо замыкание цепи на массу",
        "07" to "Чрезмерный зазор или расстояние",
        "08" to "Проскальзывание",
        "09" to "Сбой сигнала",
        "10" to "Резкое изменение сигнала",
        "11" to "Нужна дополнительная информация о неисправности",
        "12" to "Нужна дополнительная информация о неисправности",
        "13" to "Ошибка характеристики",
        "14" to "Особая неисправность: нужны подробности",
        "15" to "Нужны подробности неисправности"
    ).associate { it.first to SmartBoardFaultType(it.first,it.second,SOURCE_TYPES) }
    private fun index(family: EcuFamily): Map<String,SmartBoardComponent> = when(family) {
        EcuFamily.WABCO_TEBS_D -> d
        EcuFamily.WABCO_TEBS_E -> e
        else -> emptyMap()
    }
    fun lookup(family: EcuFamily,displayCode: String): SmartBoardComponent? = index(family)[displayCode]
    fun entries(family: EcuFamily): List<SmartBoardComponent> = index(family).values.sortedBy { it.code }
    fun decode(family: EcuFamily,displayComponent:String,displayType:String):SmartBoardMessage {
        if(index(family).isEmpty()) return SmartBoardMessage(null,null)
        return SmartBoardMessage(lookup(family,displayComponent),types[displayType])
    }
}
