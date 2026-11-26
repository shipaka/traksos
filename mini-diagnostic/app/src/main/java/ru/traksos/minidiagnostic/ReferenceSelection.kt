package ru.traksos.minidiagnostic

// Explicit family-to-display-edition associations. No implicit cross-generation fallback.
object ReferenceSelection {
    private val associations=mapOf(
        "zf-tebs-d" to listOf(DisplayReferenceEdition.WABCO_D,DisplayReferenceEdition.WABCO_D_SYSTEM),
        "zf-tebs-e" to listOf(DisplayReferenceEdition.WABCO_E,DisplayReferenceEdition.WABCO_E_SYSTEM),
        "zf-vario-c" to listOf(DisplayReferenceEdition.VARIO_C_EXAMPLES),
        "zf-vcs" to listOf(DisplayReferenceEdition.VCS_I_EXPERT),
        "zf-vcs-ii" to listOf(DisplayReferenceEdition.VCS_II_FLASH),
        "kb-tebs4" to listOf(DisplayReferenceEdition.KNORR_TEBS4),
        "kb-kb4ta" to listOf(DisplayReferenceEdition.KNORR_KB4TA),
        "kb-kb4ta-d" to listOf(DisplayReferenceEdition.KNORR_KB4TA),
        "haldex-eb1" to listOf(DisplayReferenceEdition.HALDEX_GEN1_2005),
        "haldex-eb2" to listOf(DisplayReferenceEdition.HALDEX_GEN2_INFO1),
        "haldex-eb3" to listOf(DisplayReferenceEdition.HALDEX_GEN3_INFO1),
        "haldex-uabs" to listOf(DisplayReferenceEdition.HALDEX_UABS_ACTIVE),
        "haldex-modal" to listOf(DisplayReferenceEdition.HALDEX_MODAL_MODULAR),
        "haldex-modular" to listOf(DisplayReferenceEdition.HALDEX_MODAL_MODULAR),
        "vie-tebs" to listOf(DisplayReferenceEdition.VIE_101),
        "vie-tebs-subsystem" to listOf(DisplayReferenceEdition.VIE_101),
        "sorl-trailer-abs" to listOf(DisplayReferenceEdition.SORL_ABS),
        "ekran-ebp" to listOf(DisplayReferenceEdition.EKRAN_EBP),
        "bendix-tabs6" to listOf(DisplayReferenceEdition.BENDIX_TABS6)
    )
    fun forTarget(id:String?):List<DisplayReferenceEdition> = associations[id].orEmpty()
    val targetIds:Set<String> get()=associations.keys.toSet()
}
