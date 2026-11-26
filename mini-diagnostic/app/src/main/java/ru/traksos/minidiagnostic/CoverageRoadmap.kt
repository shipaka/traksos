package ru.traksos.minidiagnostic

// Research register, NOT a list of compatible ECUs or executable profiles.
// No item here authorizes CAN traffic, wiring changes or clearing DTCs.
enum class ResearchStage { SYSTEM_DOCUMENTED, DISPLAY_REFERENCE_PARTIAL, CANDIDATE }
enum class ScopeGroup { CURRENT_HARDWARE_RESEARCH, INTERFACE_REVIEW, FUTURE_MARKET }
data class ResearchTarget(val id:String,val maker:String,val model:String,val stage:ResearchStage,
    val scope:ScopeGroup,val evidence:String)
object CoverageRoadmap {
    private const val ZF_EBS = "https://www.wabco-customercentre.com/catalog/en_GB/4801020000"
    private const val ZF_ABS = "https://www.wabco-customercentre.com/catalog/en_US/4461050510"
    private const val ZF_IEBS = "https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"
    private const val KNORR = "https://truckservices.knorr-bremse.com/en/de/products/service-new-parts/electronic-systems/trailer-ebs/"
    private const val KNORR_COVERAGE = "https://www.jaltest.com/en/coverage/2/12/123/remorque/trailer/trailer/"
    private const val KNORR_ABS = "https://manualzz.com/doc/42773168/knorr-bremse-kb4ta-d--trailer-abs-product-manual"
    private const val HALDEX = "https://www.haldex.com/sv/europe/trailer-application-guide/ebs/diagnostic/diag-tools/"
    private const val HALDEX_ABS = "https://www.haldex.com/en/europe/trailer-application-guide/abs/abs-4.0/retrofit-guide/"
    private fun target(id:String,maker:String,model:String,evidence:String,
        scope:ScopeGroup=ScopeGroup.CURRENT_HARDWARE_RESEARCH,
        stage:ResearchStage=ResearchStage.SYSTEM_DOCUMENTED) =
        ResearchTarget(id,maker,model,stage,scope,evidence)
    val targets: List<ResearchTarget> = listOf(
        target("zf-tebs-c","WABCO / ZF","TEBS C",ZF_EBS),
        target("zf-tebs-d","WABCO / ZF","TEBS D",SmartBoardReference.SOURCE,stage=ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("zf-tebs-e","WABCO / ZF","TEBS E",SmartBoardReference.SOURCE,stage=ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("zf-iebs","WABCO / ZF","iEBS",ZF_IEBS),
        target("zf-vario-c","WABCO / ZF","Vario C",ZF_ABS,ScopeGroup.INTERFACE_REVIEW),
        target("zf-vcs","WABCO / ZF","VCS I",ZF_ABS,ScopeGroup.INTERFACE_REVIEW),
        target("zf-vcs-ii","WABCO / ZF","VCS II",LegacyDisplayReference.VCS_SOURCE,ScopeGroup.INTERFACE_REVIEW),
        target("zf-tcs-i","WABCO / ZF","TCS I",WabcoCompactReference.SOURCE,ScopeGroup.FUTURE_MARKET),
        target("zf-tcs-ii","WABCO / ZF","TCS II",WabcoCompactReference.SOURCE,ScopeGroup.FUTURE_MARKET),
        target("kb-tebs4","Knorr-Bremse","TEBS4",KnorrTebs4Reference.SOURCE,ScopeGroup.INTERFACE_REVIEW,ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("kb-g20","Knorr-Bremse","TEBS G2.0",KNORR),
        target("kb-g21","Knorr-Bremse","TEBS G2.1",KNORR),
        target("kb-g22","Knorr-Bremse","TEBS G2.2",KNORR),
        target("kb-itebs-x","Knorr-Bremse","iTEBS X",KNORR),
        target("kb-a18","Knorr-Bremse","A18",KNORR_ABS,ScopeGroup.INTERFACE_REVIEW),
        target("kb-kb3ta","Knorr-Bremse","KB3-TA",KNORR_ABS,ScopeGroup.INTERFACE_REVIEW),
        target("kb-kb4ta","Knorr-Bremse","KB4-TA",KNORR_ABS,ScopeGroup.INTERFACE_REVIEW),
        target("kb-kb4ta-d","Knorr-Bremse","KB4-TA D",KNORR_ABS,ScopeGroup.INTERFACE_REVIEW),
        target("haldex-eb1","Haldex","EB+ Gen1",HaldexEarlyReference.SOURCE,ScopeGroup.INTERFACE_REVIEW,ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("haldex-eb2","Haldex","EB+ Gen2",HaldexExpandedReference.GEN2_SOURCE,stage=ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("haldex-eb3","Haldex","EB+ Gen3",LegacyDisplayReference.HALDEX_SOURCE,stage=ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("haldex-eb4","Haldex","EB+ 4.0",HALDEX),
        target("haldex-uabs","Haldex","U-ABS",HALDEX_ABS,ScopeGroup.INTERFACE_REVIEW),
        target("haldex-abs4","Haldex","ABS 4.0",HALDEX_ABS,ScopeGroup.INTERFACE_REVIEW),
        target("haldex-modal","Haldex","MODAL",HaldexModalReference.SOURCE,ScopeGroup.INTERFACE_REVIEW,ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("haldex-modular","Haldex","MODULAR",HaldexModalReference.SOURCE,ScopeGroup.INTERFACE_REVIEW,ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("haldex-mgx","Haldex","MGX",HALDEX_ABS,ScopeGroup.INTERFACE_REVIEW),
        target("vie-tebs","VIE / ТСР","TEBS (CAN 24 variants)",VieDisplayReference.SOURCE,stage=ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("vie-tebs-subsystem","VIE / ТСР","TEBS without CAN 24 module",VieDisplayReference.SOURCE,ScopeGroup.INTERFACE_REVIEW,ResearchStage.DISPLAY_REFERENCE_PARTIAL),
        target("kormee-research","Ruili KORMEE","TEBS (exact ECU model pending)",
            "https://patents.google.com/patent/CN115959098B/en",ScopeGroup.INTERFACE_REVIEW,ResearchStage.CANDIDATE),
        target("sorl-research","SORL","Trailer TEBS (exact ECU model pending)",
            "https://sorl.ru/news/tehnicheskiy-seminar--tebs-ebs--ecas-sorl-tyagacha-i-avtobusa-ekaterinburg-19-24-october",ScopeGroup.INTERFACE_REVIEW,ResearchStage.SYSTEM_DOCUMENTED),
        target("sorl-trailer-abs","SORL","Trailer ABS (tester 36302900020)",
            "https://sorl.ru/manuals/rukovodstvo-dlya-diagnosticheskogo-oborudovaniya-sorl.pdf",ScopeGroup.INTERFACE_REVIEW),
        target("ekran-ebp","Экран (Беларусь)","АБС-П, ЭБП",
            "https://b24truck.ru/files/catalog/Автокомпоненты/ekran.pdf",ScopeGroup.INTERFACE_REVIEW),
        target("ekran-ebpv","Экран (Беларусь)","ЭБП-В АДЮИ.453633.024",
            "https://b24truck.ru/files/catalog/Автокомпоненты/ekran.pdf",ScopeGroup.INTERFACE_REVIEW,ResearchStage.CANDIDATE),
        target("bendix-tabs6","Bendix","TABS-6 Standard/Premium","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/hdTZdpMPI0EBhB_SD-13-4767_US_004.pdf",ScopeGroup.FUTURE_MARKET),
        target("haldex-plc","Haldex","PLC Select / PLC Plus","https://manualzz.com/doc/6303407/haldex-l30030-installation-and-service-manual",ScopeGroup.FUTURE_MARKET)
    )
    fun byId(id:String):ResearchTarget? = targets.firstOrNull { it.id==id }
}
