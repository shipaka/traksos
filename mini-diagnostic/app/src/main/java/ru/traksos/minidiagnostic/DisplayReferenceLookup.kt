package ru.traksos.minidiagnostic

enum class DisplayReferenceEdition(val title:String) {
    WABCO_D("WABCO TEBS D · памятка водителя"),
    WABCO_D_SYSTEM("WABCO TEBS D · руководство 8150101363"),
    WABCO_E("WABCO TEBS E · памятка водителя"),
    WABCO_E_SYSTEM("WABCO TEBS E · руководство 8150101363"),
    VIE_101("VIE / ТСР TEBS · V1.01"),
    WABCO_COMPACT_TESTER("WABCO Compact Tester II · три символа"),
    HALDEX_GEN1_2005("Haldex EB+ Gen1 · руководство 02.2005"),
    HALDEX_GEN2_INFO1("Haldex EB+ Gen2 · Info Centre 1"),
    HALDEX_GEN3_INFO1("Haldex EB+ Gen3 · Info Centre 1"),
    HALDEX_GEN3_DIAG("Haldex EB+ Gen3 · DIAG+ / Info Centre 2"),
    HALDEX_MODAL_MODULAR("Haldex MODAL / MODULAR · DDU/TODD"),
    KNORR_TEBS4("Knorr TEBS4 · ECUtalk 3.3"),
}
data class DisplayLookup(val component:String?,val condition:String?,val source:String?,val exactPair:Boolean)
object DisplayReferenceLookup {
    // Manual display-only lookup: no automatic identification, status inference or bus access.
    fun find(edition:DisplayReferenceEdition,code:String):DisplayLookup? {
        val s=code.trim()
        if(edition==DisplayReferenceEdition.WABCO_COMPACT_TESTER) return WabcoCompactReference.lookup(s)
        if(edition==DisplayReferenceEdition.KNORR_TEBS4) {
            val r=KnorrTebs4Reference.lookup(s) ?: return null
            return DisplayLookup(r.first,r.second,KnorrTebs4Reference.SOURCE,true)
        }
        if(edition==DisplayReferenceEdition.HALDEX_MODAL_MODULAR) {
            val r=HaldexModalReference.lookup(s) ?: return null
            return DisplayLookup(r.first,r.second,HaldexModalReference.SOURCE,true)
        }
        if(edition==DisplayReferenceEdition.HALDEX_GEN1_2005) {
            val r=HaldexEarlyReference.lookup(s) ?: return null
            return DisplayLookup(r.first,r.second,HaldexEarlyReference.SOURCE,true)
        }
        if(edition==DisplayReferenceEdition.HALDEX_GEN2_INFO1) {
            val r=HaldexExpandedReference.gen2(s) ?: return null
            return DisplayLookup(r.first,r.second,HaldexExpandedReference.GEN2_SOURCE,true)
        }
        if(edition==DisplayReferenceEdition.HALDEX_GEN3_DIAG) return HaldexGen3DiagReference.lookup(s)
        if(edition==DisplayReferenceEdition.HALDEX_GEN3_INFO1) {
            val r=LegacyDisplayReference.haldexInfo1(s) ?: return null
            return DisplayLookup(r.first,r.second,LegacyDisplayReference.HALDEX_SOURCE,true)
        }
        if(edition==DisplayReferenceEdition.VIE_101) {
            if(!Regex("[0-9]{1,3}/[0-9]{1,2}").matches(s)) return null
            val r=VieDisplayReference.lookup(EcuFamily.VIE_TEBS,s) ?: return null
            return DisplayLookup(r.component,r.condition,VieDisplayReference.DOCUMENT+" · "+r.section,true)
        }
        if(!Regex("[0-9]{3}/[0-9]{2}").matches(s)) return null
        if(edition==DisplayReferenceEdition.WABCO_D_SYSTEM || edition==DisplayReferenceEdition.WABCO_E_SYSTEM) {
            val (component,type)=s.split("/")
            return SmartBoardSystemReference.find(edition==DisplayReferenceEdition.WABCO_D_SYSTEM,component,type)
        }
        val family=when(edition) {
            DisplayReferenceEdition.WABCO_D -> EcuFamily.WABCO_TEBS_D
            DisplayReferenceEdition.WABCO_E -> EcuFamily.WABCO_TEBS_E
            else -> return null
        }
        val (component,type)=s.split("/")
        val r=SmartBoardReference.decode(family,component,type)
        if(r.component==null && r.faultType==null) return null
        // These are independent display fields; never claim the combination is a documented DTC.
        return DisplayLookup(r.component?.titleRu,r.faultType?.titleRu,
            listOfNotNull(r.component?.source,r.faultType?.source).distinct().joinToString("\n"),false)
    }
}
