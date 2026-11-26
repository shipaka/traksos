package ru.traksos.minidiagnostic

// Explicit pairs in SmartBoard OEM documentation, not raw wire mapping.
object WabcoEExactReference {
    const val SOURCE="https://www.wabco-customercentre.com/catalog/docs/8150101363.pdf#page=50"
    private const val DRIVER="https://www.wabco-customercentre.com/catalog/docs/8150101383.pdf#page=25"
    fun lookup(code:String):DisplayLookup? = when(code) {
        "002/05" -> DisplayLookup("Датчик скорости колеса B","Обрыв питающей цепи датчика",SOURCE,true)
        "001/07" -> DisplayLookup("Датчик скорости колеса A",
            "Ошибка расстояния/зазора датчика. Руководство водителя неоднозначно формулирует тип 07; увеличенный воздушный зазор — возможная причина по системному руководству, не установленная неисправность. Уточнить по версии ЭБУ и диагностическому отчёту.",
            DRIVER+" · также 8150102603, раздел 10 (индексированный текст); 8150101363, таблица 8-4",false)
        else -> null
    }
    val count get()=2
}
