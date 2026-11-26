package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class UdsDtcResponseTest {
    private fun pdu(vararg bytes: Int) = ByteArray(bytes.size) { bytes[it].toByte() }
    @Test fun parsesSyntheticActiveStoredAndUnknown() {
        val r = UdsDtcDecoder.decode(pdu(0x59,2,0x49,0x12,0x34,0x56,0x09,
            0xAB,0xCD,0xEF,0x08,0,0,1,0x48)) as UdsDtcResponse.Report
        assertEquals(0x49,r.availabilityMask)
        assertEquals(listOf("123456","ABCDEF","000001"),r.records.map { it.code })
        assertEquals(listOf(DtcStatus.ACTIVE,DtcStatus.STORED,DtcStatus.UNKNOWN),r.records.map { it.classification })
        assertEquals("ABCDEF08",r.records[1].raw().rawHex)
    }
    @Test fun unsupportedStatusBitsNeverAssertCurrentState() {
        val r = UdsDtcDecoder.decode(pdu(0x59,2,8,1,2,3,9)) as UdsDtcResponse.Report
        assertEquals(9,r.records.single().statusByte)
        assertEquals(DtcStatus.UNKNOWN,r.records.single().classification)
    }
    @Test fun negativePendingIsNotAnEmptyReport() {
        assertEquals(UdsDtcResponse.Negative(0x78),UdsDtcDecoder.decode(pdu(0x7F,0x19,0x78)))
        assertEquals(UdsDtcResponse.Negative(0x31),UdsDtcDecoder.decode(pdu(0x7F,0x19,0x31)))
    }
    @Test fun validEmptyReportIsDistinctFromInvalid() {
        assertTrue((UdsDtcDecoder.decode(pdu(0x59,2,0xFF)) as UdsDtcResponse.Report).records.isEmpty())
        listOf(pdu(),pdu(0x59,2),pdu(0x59,1,0xFF),pdu(0x59,2,0xFF,0),
            pdu(0x7F,0x14,0x78),pdu(0x59,2,0xFF,1,2,3,1,1,2,3,8),ByteArray(4096))
            .forEach { assertTrue(UdsDtcDecoder.decode(it) is UdsDtcResponse.Invalid) }
    }
    @Test fun displayCodeReferenceCannotLeakIntoRawCatalog() {
        assertEquals("Колёсный датчик C",SmartBoardReference.lookup(EcuFamily.WABCO_TEBS_E,"003")?.titleRu)
        assertEquals(6,SmartBoardReference.entries(EcuFamily.WABCO_TEBS_D).size)
        assertNull(SmartBoardReference.lookup(EcuFamily.KNORR_TEBS_G2,"003"))
        assertNull(SmartBoardReference.lookup(EcuFamily.WABCO_TEBS_E,"000003"))
        assertNull(DtcCatalog().decode(EcuFamily.WABCO_TEBS_E,null,RawDtc("000003",DtcStatus.UNKNOWN,"00000300")).descriptionRu)
    }
}
