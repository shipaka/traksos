package ru.traksos.minidiagnostic

// Human-readable reference namespace. NOT a raw UDS DTC catalogue.
data class SmartBoardComponent(val code: String,val titleRu: String,val source: String)
object SmartBoardReference {
    const val SOURCE = "https://www.manualslib.com/manual/1267144/Wabco-Smartboard.html?page=16"
    private val sensors = ('A'..'F').mapIndexed { i, letter ->
        SmartBoardComponent("00"+(i+1),"Колёсный датчик "+letter,SOURCE)
    }.associateBy { it.code }
    fun lookup(family: EcuFamily,displayCode: String): SmartBoardComponent? =
        if (family == EcuFamily.WABCO_TEBS_D || family == EcuFamily.WABCO_TEBS_E)
            sensors[displayCode] else null
    fun entries(family: EcuFamily): List<SmartBoardComponent> =
        if (family == EcuFamily.WABCO_TEBS_D || family == EcuFamily.WABCO_TEBS_E)
            sensors.values.toList() else emptyList()
}
