package ru.traksos.minidiagnostic

// Synthetic preview only. No measurement, no real ECU status, no hardware access.
enum class DemoElectricalCase(val title:String) {
    NORMAL("Нормальный обмен"), SAG("Просадка питания"), NO_POWER("Нет питания"),
    NO_RETURN("Потеря массы"), NO_CAN("Нет обмена CAN")
}
data class ElectricalPreview(
    val supplyMv:Int?, val minimumMv:Int?, val returnOk:Boolean?,
    val canTraffic:Boolean?, val canErrors:Int?, val reason:String?
) {
    val canRunDemo get()=reason==null && supplyMv!=null && returnOk==true && canTraffic==true
}
object DemoElectricalPreview {
    fun snapshot(connected:Boolean,scenario:DemoElectricalCase):ElectricalPreview {
        if(!connected) return ElectricalPreview(null,null,null,null,null,"Демо-адаптер отключён")
        return when(scenario) {
            DemoElectricalCase.NORMAL -> ElectricalPreview(24600,24200,true,true,0,null)
            DemoElectricalCase.SAG -> ElectricalPreview(17800,17200,true,false,4,"Просадка питания · в этом примере ответ блока не получен")
            DemoElectricalCase.NO_POWER -> ElectricalPreview(0,0,null,null,null,"Нет питания · ответ блока не получен")
            DemoElectricalCase.NO_RETURN -> ElectricalPreview(null,null,false,null,null,"Потеря массы · ответ блока не получен")
            DemoElectricalCase.NO_CAN -> ElectricalPreview(24600,24200,true,false,null,"Нет обмена CAN · причина не установлена")
        }
    }
}
