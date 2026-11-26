package ru.traksos.minidiagnostic

// Owner-defined research priorities, NOT model production dates, compatibility,
// or a reason to exclude a later-installed legacy ECU.
enum class TrailerPriority(val title:String) {
    PRIMARY("Приоритет исследования: прицепы 2005–2026"),
    LEGACY("Второй этап: старые системы, ориентир 1990–2004"),
    OUTSIDE("Отдельный рынок / интерфейс, вне текущего приоритета")
}
object TrailerDiagnosticScope {
    val places=listOf(ConnectionPlace.FRONT,ConnectionPlace.SIDE,ConnectionPlace.DIRECT)
    private val legacy=setOf("zf-vario-c","zf-vcs","kb-a18","kb-kb3ta","haldex-modal","haldex-modular","haldex-mgx")
    private val archivedReferences=setOf(
        DisplayReferenceEdition.VARIO_C_EXAMPLES,DisplayReferenceEdition.VCS_I_EXPERT,
        DisplayReferenceEdition.VCS_II_FLASH,DisplayReferenceEdition.HALDEX_UABS_ACTIVE,
        DisplayReferenceEdition.KNORR_KB4TA,DisplayReferenceEdition.SORL_ABS,
        DisplayReferenceEdition.EKRAN_EBP,DisplayReferenceEdition.BENDIX_TABS6
    )
    fun isPhysicalPlace(place:ConnectionPlace)=place in places
    fun priority(target:ResearchTarget):TrailerPriority=when {
        target.scope==ScopeGroup.FUTURE_MARKET -> TrailerPriority.OUTSIDE
        target.id in legacy -> TrailerPriority.LEGACY
        else -> TrailerPriority.PRIMARY
    }
    fun prioritized(rows:List<ResearchTarget>)=rows.sortedBy { priority(it).ordinal }
    fun isMainReference(edition:DisplayReferenceEdition)=edition !in archivedReferences
}
