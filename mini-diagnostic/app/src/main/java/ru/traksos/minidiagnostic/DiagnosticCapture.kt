package ru.traksos.minidiagnostic

import java.util.Locale

enum class CaptureOrigin { SYNTHETIC, MANUAL_BENCH_IMPORT }
data class ProfileEvidence(val identity: EcuIdentity, val profileId: String, val evidence: String)

// The production registry starts empty: evidence records must be reviewed before inclusion.
class ProfileRegistry(entries: List<ProfileEvidence> = emptyList()) {
    private val byIdentity = entries.associateBy { it.identity }
    init {
        require(byIdentity.size == entries.size)
        require(entries.all {
            it.identity.complete()
                && it.profileId.isNotBlank() && it.evidence.isNotBlank()
        })
    }
    fun exact(identity: EcuIdentity?): ProfileEvidence? = identity?.takeIf { it.complete() }?.let { byIdentity[it] }
}
data class CaptureMetadata(val origin: CaptureOrigin, val identity: EcuIdentity?,
    val observedAtEpochMs: Long, val statusSelectionMask: Int? = null) {
    init {
        require(observedAtEpochMs >= 0)
        require(statusSelectionMask == null || statusSelectionMask in 1..255)
    }
}
sealed interface CaptureResult {
    data class Report(val metadata: CaptureMetadata, val rawPduHex: String,
        val availabilityMask: Int, val records: List<DecodedDtc>, val profileId: String?) : CaptureResult
    data class Negative(val metadata: CaptureMetadata, val rawPduHex: String, val reason: Int) : CaptureResult
    data class Rejected(val reason: String) : CaptureResult
}
class DiagnosticCapture(private val registry: ProfileRegistry = ProfileRegistry(),
    private val catalog: DtcCatalog = DtcCatalog()) {
    fun importHex(metadata: CaptureMetadata, input: String): CaptureResult {
        // Bound input before allocating. Accept compact hex or whitespace-separated byte pairs.
        if (input.length > 16384) return CaptureResult.Rejected("INPUT_TOO_LONG")
        val s = input.trim()
        if (s.isEmpty()) return CaptureResult.Rejected("EMPTY_INPUT")
        val compact = if (s.any { it.isWhitespace() }) {
            val tokens = s.split(Regex("\\s+"))
            if (tokens.any { it.length != 2 }) return CaptureResult.Rejected("INVALID_HEX")
            tokens.joinToString("")
        } else s
        if (compact.length !in 2..8190 || compact.length % 2 != 0 ||
            compact.any { it !in '0'..'9' && it !in 'a'..'f' && it !in 'A'..'F' })
            return CaptureResult.Rejected("INVALID_HEX")
        val pdu = ByteArray(compact.length / 2) { i -> compact.substring(i*2,i*2+2).toInt(16).toByte() }
        val hex = compact.uppercase(Locale.ROOT)
        return when(val result = UdsDtcDecoder.decode(pdu)) {
            is UdsDtcResponse.Invalid -> CaptureResult.Rejected(result.reason)
            is UdsDtcResponse.Negative -> CaptureResult.Negative(metadata,hex,result.reason)
            is UdsDtcResponse.Report -> {
                // Validate a supplied request mask against supported bits and every response
                // record. A missing mask stays unknown; never reconstruct it from the response.
                metadata.statusSelectionMask?.let { requested ->
                    val effective = requested and result.availabilityMask
                    if(effective==0) return CaptureResult.Rejected("UNSUPPORTED_STATUS_FILTER")
                    if(result.records.any { it.statusByte and effective == 0 })
                        return CaptureResult.Rejected("RECORD_OUTSIDE_STATUS_FILTER")
                }
                // Synthetic captures never receive a production interpretation, even if they
                // claim the identity of a real ECU. Manual import does not itself verify origin.
                val profile = if(metadata.origin == CaptureOrigin.MANUAL_BENCH_IMPORT)
                    registry.exact(metadata.identity) else null
                val records = result.records.map { record ->
                    val raw = record.raw()
                    if(profile == null) DecodedDtc(raw,null,null)
                    else catalog.decode(profile.identity.family,profile.profileId,raw)
                }
                CaptureResult.Report(metadata,hex,result.availabilityMask,records,profile?.profileId)
            }
        }
    }
}

sealed interface CaptureComparison {
    data class Compared(val onlyBefore: Set<String>, val onlyAfter: Set<String>,
        val statusChanged: Set<String>, val unchanged: Set<String>) : CaptureComparison
    data class NotComparable(val reason: String) : CaptureComparison
}
object DiagnosticComparison {
    // Compare presence in two reports, never assert that a missing record means a repair.
    // Caller must ensure they came from the same physical bench ECU; identity alone is not serial identity.
    fun compare(before: CaptureResult, after: CaptureResult, samePhysicalEcuConfirmed: Boolean): CaptureComparison {
        fun reject(reason:String) = CaptureComparison.NotComparable(reason)
        if (before !is CaptureResult.Report || after !is CaptureResult.Report) return reject("NOT_TWO_REPORTS")
        val a = before.metadata
        val b = after.metadata
        if (!samePhysicalEcuConfirmed || a.identity == null || a.identity != b.identity ||
            !a.identity.complete()) return reject("ECU_IDENTITY")
        if (a.origin != b.origin || a.observedAtEpochMs >= b.observedAtEpochMs) return reject("CAPTURE_ORDER_OR_ORIGIN")
        if (a.statusSelectionMask == null || a.statusSelectionMask != b.statusSelectionMask ||
            before.availabilityMask != after.availabilityMask) return reject("STATUS_FILTER_OR_MASK")
        val effective = a.statusSelectionMask and before.availabilityMask
        if(effective==0) return reject("STATUS_FILTER_OR_MASK")
        // Guard callers constructing Report directly instead of going through import.
        fun valid(r:CaptureResult.Report):Boolean {
            val decoded=UdsDtcDecoder.decode(
                r.rawPduHex.takeIf { it.length in 6..8190 && it.length%2==0 &&
                    it.all { c->c in '0'..'9' || c in 'A'..'F' } }
                    ?.chunked(2)?.map { it.toInt(16).toByte() }?.toByteArray()
                    ?: return false
            ) as? UdsDtcResponse.Report ?: return false
            return decoded.availabilityMask==r.availabilityMask &&
                decoded.records.all { it.statusByte and effective!=0 } &&
                decoded.records.map { it.raw() }==r.records.map { it.raw }
        }
        if(!valid(before) || !valid(after)) return reject("REPORT_INTEGRITY")
        val first = before.records.associateBy { it.raw.code }
        val second = after.records.associateBy { it.raw.code }
        val common = first.keys.intersect(second.keys)
        // Compare actual status bytes, including unclassified flags, rather than just labels.
        val changed = common.filter { first.getValue(it).raw.rawHex != second.getValue(it).raw.rawHex }.toSet()
        return CaptureComparison.Compared(first.keys-second.keys,second.keys-first.keys,changed,common-changed)
    }
}
