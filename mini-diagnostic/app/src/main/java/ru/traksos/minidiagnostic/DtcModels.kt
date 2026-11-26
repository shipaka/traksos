package ru.traksos.minidiagnostic

enum class EcuFamily { WABCO_TEBS_E, WABCO_TEBS_D, KNORR_TEBS_G2, VIE_TEBS, HALDEX_EB_PLUS }
enum class DtcStatus { ACTIVE, STORED, UNKNOWN }
data class EcuIdentity(val family: EcuFamily, val partNumber: String, val softwareVersion: String?,
    val hardwareRevision: String? = null, val path: ElectricalPath? = null) {
    // Exact profile identity is not an authenticated physical device identity.
    fun complete(): Boolean = listOf(partNumber,softwareVersion,hardwareRevision).all {
        !it.isNullOrBlank() && it.trim().equals(it) &&
            it.lowercase(java.util.Locale.ROOT) !in setOf("unknown","неизвестно","n/a","-","?")
    } && path!=null
}
data class RawDtc(val code: String, val status: DtcStatus, val rawHex: String)
data class DtcDefinition(val family: EcuFamily, val profileId: String, val code: String, val descriptionRu: String, val source: String)
data class DecodedDtc(val raw: RawDtc, val descriptionRu: String?, val source: String?)

// Exact verified profile only. No mapping between SmartBoard display codes and raw DTC assumed.
class DtcCatalog(definitions: List<DtcDefinition> = emptyList()) {
    private val index = definitions.associateBy { Triple(it.family,it.profileId,it.code) }
    init {
        require(index.size == definitions.size)
        require(definitions.all { it.source.isNotBlank() && it.profileId.isNotBlank() && it.code.isNotBlank() })
    }
    fun decode(family: EcuFamily, verifiedProfileId: String?, raw: RawDtc): DecodedDtc {
        val d = verifiedProfileId?.let { index[Triple(family,it,raw.code)] }
        return DecodedDtc(raw,d?.descriptionRu,d?.source)
    }
}
