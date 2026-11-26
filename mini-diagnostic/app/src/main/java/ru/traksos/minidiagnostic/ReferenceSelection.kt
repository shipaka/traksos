package ru.traksos.minidiagnostic

// Explicit family-to-display-edition associations. No implicit cross-generation fallback.
object ReferenceSelection {
    private val associations=mapOf(
        "zf-tebs-d" to listOf(DisplayReferenceEdition.WABCO_D,DisplayReferenceEdition.WABCO_D_SYSTEM),
        "zf-tebs-e" to listOf(DisplayReferenceEdition.WABCO_E,DisplayReferenceEdition.WABCO_E_SYSTEM,DisplayReferenceEdition.WABCO_E_HUMBAUR,DisplayReferenceEdition.WABCO_E_OEM_EXACT),
        "kb-g22" to listOf(DisplayReferenceEdition.KNORR_G22_PRESSURE),
        "kb-tebs4" to listOf(DisplayReferenceEdition.KNORR_TEBS4),
        "haldex-eb1" to listOf(DisplayReferenceEdition.HALDEX_GEN1_2005),
        "haldex-eb2" to listOf(DisplayReferenceEdition.HALDEX_GEN2_INFO1),
        "haldex-eb4" to listOf(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE),
        "haldex-eb3" to listOf(DisplayReferenceEdition.HALDEX_GEN3_INFO1,DisplayReferenceEdition.HALDEX_GEN3_DIAG),
        "haldex-modal" to listOf(DisplayReferenceEdition.HALDEX_MODAL_MODULAR),
        "haldex-modular" to listOf(DisplayReferenceEdition.HALDEX_MODAL_MODULAR),
        "sorl-trailer-abs" to listOf(DisplayReferenceEdition.SORL_ABS_TESTER_36302900020),
        "vie-tebs" to listOf(DisplayReferenceEdition.VIE_101),
        "vie-tebs-subsystem" to listOf(DisplayReferenceEdition.VIE_101),
    )
    fun forTarget(id:String?):List<DisplayReferenceEdition> = associations[id].orEmpty()
    val targetIds:Set<String> get()=associations.keys.toSet()
}
