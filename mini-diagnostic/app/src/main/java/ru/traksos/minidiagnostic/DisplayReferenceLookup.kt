package ru.traksos.minidiagnostic

enum class DisplayReferenceEdition(val title:String) {
    WABCO_D("WABCO TEBS D · SmartBoard"),
    WABCO_E("WABCO TEBS E · SmartBoard"),
    VIE_101("VIE / ТСР TEBS · V1.01"),
    VCS_II_FLASH("WABCO VCS II · мигающий код"),
    HALDEX_GEN3_INFO1("Haldex EB+ Gen3 · Info Centre 1"),
    HALDEX_UABS_ACTIVE("Haldex U-ABS · активные световые коды"),
    EKRAN_EBP("Экран АБС-П / ЭБП · световые коды")
}
data class DisplayLookup(val component:String?,val condition:String?,val source:String?,val exactPair:Boolean)
object DisplayReferenceLookup {
    // Manual display-only lookup: no automatic identification, status inference or bus access.
    fun find(edition:DisplayReferenceEdition,code:String):DisplayLookup? {
        val s=code.trim()
        if(edition==DisplayReferenceEdition.HALDEX_UABS_ACTIVE || edition==DisplayReferenceEdition.EKRAN_EBP) {
            val haldex=edition==DisplayReferenceEdition.HALDEX_UABS_ACTIVE
            val r=(if(haldex) AdditionalAbsReference.haldex(s) else AdditionalAbsReference.ekran(s)) ?: return null
            return DisplayLookup(r.first,r.second,if(haldex) AdditionalAbsReference.HALDEX_SOURCE else AdditionalAbsReference.EKRAN_SOURCE,true)
        }
        if(edition==DisplayReferenceEdition.VCS_II_FLASH) {
            val r=LegacyDisplayReference.vcsFlash(s) ?: return null
            return DisplayLookup(r,"Текущая неисправность: тип не определяется по числу вспышек",LegacyDisplayReference.VCS_SOURCE,false)
        }
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
        val family=if(edition==DisplayReferenceEdition.WABCO_D) EcuFamily.WABCO_TEBS_D else EcuFamily.WABCO_TEBS_E
        val (component,type)=s.split("/")
        val r=SmartBoardReference.decode(family,component,type)
        if(r.component==null && r.faultType==null) return null
        // These are independent display fields; never claim the combination is a documented DTC.
        return DisplayLookup(r.component?.titleRu,r.faultType?.titleRu,
            listOfNotNull(r.component?.source,r.faultType?.source).distinct().joinToString("\n"),false)
    }
}
