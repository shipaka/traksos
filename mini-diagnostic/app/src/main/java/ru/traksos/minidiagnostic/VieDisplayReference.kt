package ru.traksos.minidiagnostic

// Displayed decimal pairs only, not a wire protocol or an identification method.
// Applies to the reference revision, not automatically to every VIE/TCP ECU.
data class VieDisplayDtc(val code:String,val component:String,val condition:String,val section:String)
object VieDisplayReference {
    const val SOURCE = "https://vbsauto.ru/literatura/"
    const val DOCUMENT = "TEBS Diagnostic Trouble Codes V1.01 RUS; DTC list v1.0, pp. 6–7"
    const val PDF = "https://694026.selcdn.ru/aspmaster1/system/attachment/attachment/1463/TEBS-________-_____-______________-V1.01-RUS.pdf"
    private val sensorEntries = listOf(3 to "E",4 to "F",5 to "C",6 to "D").flatMapIndexed { i,(id,letter) ->
        listOf(1 to "Увеличенный зазор",3 to "Замыкание на питание",4 to "Замыкание на массу",
            5 to "Разрыв цепи",6 to "КЗ цепи").mapIndexed { j,(type,condition) ->
            VieDisplayDtc("$id/$type","Датчик скорости колеса $letter",condition,"A1.${i*5+j+1}")
        }
    }
    private fun row(code:String,component:String,condition:String,n:Int) = VieDisplayDtc(code,component,condition,"A1.$n")
    private val other = listOf(
        row("9/5","Клапан модулятора","Разрыв цепи",21),
        row("62/5","Датчик давления модулятора","Разрыв цепи",22),
        row("69/5","Внутренний датчик нагрузки","Разрыв цепи",23),
        row("75/12","Контроль износа","Износ накладок",24),
        row("77/5","Датчик задаваемого давления","Разрыв цепи",25),
        row("77/12","Датчик задаваемого давления","Давление вне нормы",26),
        row("88/11","Датчик поперечного ускорения","Неисправность",27),
        row("88/12","Датчик поперечного ускорения","Недостоверное значение",28),
        row("109/14","ABS","Установлен бит памяти",29),
        row("141/5","Клапан подъёмной оси 2","Разрыв цепи",30),
        row("142/5","Клапан подъёмной оси 1","Разрыв цепи",31),
        row("144/1","Датчик давления питания","Низкое значение",32),
        row("144/5","Датчик давления питания","Разрыв цепи",33),
        row("220/2","Обмен данными","Нет пневматической тормозной линии автопоезда",34),
        row("220/9","Обмен данными","Сбой CAN прицепа",35),
        row("251/3","Электропитание","Высокое напряжение",36),
        row("251/4","Электропитание","Низкое напряжение",37),
        row("253/12","Конфигурация","Нет параметризации либо ошибка контрольной суммы",38),
        row("253/14","Ввод в эксплуатацию","EOL не завершён либо не пройден",39),
        row("254/12","Модулятор","Внутренний сбой",40),
        row("254/15","Модулятор","Сервисное состояние",41)
    )
    private val index=(sensorEntries+other).associateBy { it.code }
    val count:Int get()=index.size
    fun lookup(family:EcuFamily,displayCode:String):VieDisplayDtc? =
        if(family==EcuFamily.VIE_TEBS) index[displayCode] else null
    fun entries(family:EcuFamily):List<VieDisplayDtc> =
        if(family==EcuFamily.VIE_TEBS) index.values.toList() else emptyList()
}
