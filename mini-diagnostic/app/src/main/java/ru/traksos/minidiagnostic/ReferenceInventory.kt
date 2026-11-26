package ru.traksos.minidiagnostic

// Counts actual maps, not cumulative estimates or cross-products of display fields.
data class ReferenceCount(val group:String,val entries:Int)
object ReferenceInventory {
    fun counts():List<ReferenceCount> = listOf(
        ReferenceCount("WABCO SmartBoard driver D/E components",
            SmartBoardReference.entries(EcuFamily.WABCO_TEBS_D).size+SmartBoardReference.entries(EcuFamily.WABCO_TEBS_E).size),
        ReferenceCount("WABCO SmartBoard system D/E components",SmartBoardSystemReference.systemComponentCount),
        ReferenceCount("VIE",VieDisplayReference.count),
        ReferenceCount("Haldex Gen3",LegacyDisplayReference.haldexCount),
        ReferenceCount("Haldex Gen1 2005",HaldexEarlyReference.count),
        ReferenceCount("Haldex Gen2",HaldexExpandedReference.gen2Count),
        ReferenceCount("Knorr TEBS4",KnorrTebs4Reference.count),
        ReferenceCount("Haldex MODAL/MODULAR",HaldexModalReference.count),
        ReferenceCount("Haldex Gen3 DIAG+ additional",HaldexGen3DiagReference.count),
        ReferenceCount("Knorr G2 OEM ECUtalk / TIM examples",KnorrG2ExampleReference.count),
        ReferenceCount("Knorr G2.2 pressure bulletin and TD-2077",KnorrG22PressureReference.count),
        ReferenceCount("Haldex EB+4.0 OEM and WABCO Humbaur observed examples",ModernDisplayExamples.count),
        ReferenceCount("WABCO TEBS E explicit OEM pair",WabcoEExactReference.count),
    )
    fun total():Int=counts().sumOf { it.entries }
    // Preliminary secondary-source entries are not included in the established inventory.
    fun provisionalCount():Int=KnorrG2Td2077Reference.count
    // Auxiliary ECU, not a TEBS braking fault count. Two aliases count as one row.
    fun auxiliaryCount():Int=WabcoElexReference.count+WabcoRouterReference.count
}
