package ru.traksos.minidiagnostic

import java.util.Locale

// Offline application-layer decoder only. Input must be a complete, reassembled UDS PDU.
// No ECU address, transport, active request or vendor compatibility is inferred here.
sealed interface UdsDtcResponse {
    data class Report(val availabilityMask: Int, val records: List<UdsDtcRecord>) : UdsDtcResponse
    data class Count(val availabilityMask: Int, val formatIdentifier: Int, val count: Int) : UdsDtcResponse
    data class Negative(val reason: Int) : UdsDtcResponse
    data class Invalid(val reason: String) : UdsDtcResponse
}
data class UdsDtcRecord(val number: Int, val statusByte: Int, val availabilityMask: Int) {
    val code: String get() = String.format(Locale.ROOT,"%06X",number)
    val effectiveStatus: Int get() = statusByte and availabilityMask
    // Bit 0 is testFailed. Bit 3 is confirmedDTC. If unsupported or the
    // current test has not completed, do not describe a historic fault as inactive.
    val classification: DtcStatus get() {
        if (availabilityMask and 0x01 == 0) return DtcStatus.UNKNOWN
        if (effectiveStatus and 0x01 != 0) return DtcStatus.ACTIVE
        if (availabilityMask and 0x40 == 0 || effectiveStatus and 0x40 != 0)
            return DtcStatus.UNKNOWN
        return if (effectiveStatus and 0x08 != 0) DtcStatus.STORED else DtcStatus.UNKNOWN
    }
    fun raw() = RawDtc(code,classification,String.format(Locale.ROOT,"%06X%02X",number,statusByte))
}
object UdsDtcDecoder {
    private const val MAX_PDU = 4095 // local implementation bound, not a universal UDS limit
    fun decode(pdu: ByteArray): UdsDtcResponse {
        fun u(i: Int) = pdu[i].toInt() and 255
        fun invalid(reason: String) = UdsDtcResponse.Invalid(reason)
        if (pdu.isEmpty() || pdu.size > MAX_PDU) return invalid("PDU_LENGTH")
        if (u(0) == 0x7F) {
            return if (pdu.size == 3 && u(1) == 0x19)
                UdsDtcResponse.Negative(u(2)) else invalid("NEGATIVE_RESPONSE")
        }
        if (pdu.size < 2 || u(0) != 0x59) return invalid("UNEXPECTED_SERVICE")
        if (u(1) == 0x01) {
            if (pdu.size != 6) return invalid("COUNT_LENGTH")
            // Preserve the identifier even when its meaning is unknown or reserved.
            return UdsDtcResponse.Count(u(2),u(3),(u(4) shl 8) or u(5))
        }
        if (pdu.size < 3 || u(1) != 0x02) return invalid("UNEXPECTED_SERVICE")
        if ((pdu.size-3)%4 != 0) return invalid("TRUNCATED_RECORD")
        val mask = u(2)
        val records = ArrayList<UdsDtcRecord>()
        val seen = HashSet<Int>()
        for (i in 3 until pdu.size step 4) {
            val number = (u(i) shl 16) or (u(i+1) shl 8) or u(i+2)
            if (!seen.add(number)) return invalid("DUPLICATE_DTC")
            records.add(UdsDtcRecord(number,u(i+3),mask))
        }
        return UdsDtcResponse.Report(mask,records)
    }
}
