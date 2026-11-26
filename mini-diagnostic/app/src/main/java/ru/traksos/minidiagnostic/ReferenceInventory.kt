package ru.traksos.minidiagnostic

// Counts actual maps, not cumulative estimates or cross-products of display fields.
data class ReferenceCount(val group:String,val entries:Int)
object ReferenceInventory {
    fun counts():List<ReferenceCount> = listOf(
        ReferenceCount("WABCO SmartBoard driver D/E components",
            SmartBoardReference.entries(EcuFamily.WABCO_TEBS_D).size+SmartBoardReference.entries(EcuFamily.WABCO_TEBS_E).size),
        ReferenceCount("WABCO SmartBoard system D/E components",SmartBoardSystemReference.systemComponentCount),
        ReferenceCount("VIE",VieDisplayReference.count),
        ReferenceCount("VCS II",LegacyDisplayReference.vcsCount),
        ReferenceCount("Vario C examples",WabcoVarioExamples.count),
        ReferenceCount("VCS I",WabcoVcsReference.count),
        ReferenceCount("Haldex Gen3",LegacyDisplayReference.haldexCount),
        ReferenceCount("Haldex Gen1 2005",HaldexEarlyReference.count),
        ReferenceCount("Haldex Gen2",HaldexExpandedReference.gen2Count),
        ReferenceCount("Haldex U-ABS",AdditionalAbsReference.haldexCount),
        ReferenceCount("Ekran",AdditionalAbsReference.ekranCount),
        ReferenceCount("Knorr KB4TA/D",KnorrSorlReference.knorrCount),
        ReferenceCount("SORL ABS",KnorrSorlReference.sorlCount),
        ReferenceCount("Knorr TEBS4",KnorrTebs4Reference.count),
        ReferenceCount("Haldex MODAL/MODULAR",HaldexModalReference.count),
        ReferenceCount("Bendix TABS-6",BendixTabs6Reference.count)
    )
    fun total():Int=counts().sumOf { it.entries }
}
