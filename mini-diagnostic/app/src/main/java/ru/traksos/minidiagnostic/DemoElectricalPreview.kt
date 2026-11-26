package ru.traksos.minidiagnostic

// Synthetic preview only. No measurement, no real ECU status, no hardware access.
// One proposed, protected supply sense channel measures a potential difference;
// it does not distinguish a missing positive supply from a missing return.
enum class DemoElectricalCase(val title:String) {
    NORMAL("Нормальный обмен"), SAG("Просадка напряжения"), NO_POWER("Нет напряжения"),
    NO_CAN("Нет обмена CAN"), NO_MEASUREMENT("Напряжение не измеряется")
}
data class ElectricalPreview(
    val supplyMv:Int?, val minimumMv:Int?,
    val canTraffic:Boolean?, val canErrors:Int?, val reason:String?
) {
    // Missing optional voltage telemetry must not prevent a demo read.
    // This is not an authorization gate for any physical diagnostic operation.
    val canRunDemo get()=reason==null && canTraffic==true
}
object DemoElectricalPreview {
    fun snapshot(connected:Boolean,scenario:DemoElectricalCase):ElectricalPreview {
        if(!connected) return ElectricalPreview(null,null,null,null,"Демо-адаптер отключён")
        return when(scenario) {
            DemoElectricalCase.NORMAL -> ElectricalPreview(24600,24200,true,0,null)
            DemoElectricalCase.SAG -> ElectricalPreview(17800,17200,false,4,"Просадка напряжения · в этом примере ответ блока не получен")
            DemoElectricalCase.NO_POWER -> ElectricalPreview(0,0,null,null,"Нет напряжения в точке измерения · причина не установлена")
            DemoElectricalCase.NO_CAN -> ElectricalPreview(24600,24200,false,null,"Нет обмена CAN · причина не установлена")
            DemoElectricalCase.NO_MEASUREMENT -> ElectricalPreview(null,null,true,0,null)
        }
    }
}
