package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class OfflineKwpReviewTest {
    private val sample="82 12 34 55 66 83"
    @Test fun validPhysicalFrameAndReport() {
        val r=OfflineKwpReview.parse(sample,"12","34",true) as OfflineKwpResult.Accepted
        assertTrue(r.addressesMatched)
        assertEquals("821234556683",r.rawHex)
        assertEquals(listOf(0x55,0x66),r.frame.payload)
        assertTrue(r.synthetic)
        val text=OfflineKwpReview.reportText(r)
        assertTrue(text.contains("Синтетический пример"))
        assertTrue(text.contains("источник не проверен"))
        assertTrue(text.contains("Контрольная сумма совпала: 83"))
    }
    @Test fun wrongDirectionAndInputRejected() {
        fun reason(s:String,t:String="",e:String="")=(OfflineKwpReview.parse(s,t,e) as OfflineKwpResult.Rejected).reason
        assertEquals("ADDRESS_MISMATCH",reason(sample,"34","12"))
        assertEquals("INVALID_EXPECTED_ADDRESS",reason(sample,"12",""))
        assertEquals("INVALID_EXPECTED_ADDRESS",reason(sample,"12","12"))
        assertEquals("CHECKSUM",reason("821234556682"))
        assertEquals("INVALID_HEX",reason("82 1234 55 66 83"))
        assertEquals("INPUT_TOO_LONG",reason("A".repeat(2049)))
        assertEquals("INVALID_HEX_OR_LENGTH",reason("82123455668"))
    }
    @Test fun unaddressedAndFunctionalNeverCountAsMatchedResponse() {
        val raw=OfflineKwpReview.parse("015556") as OfflineKwpResult.Accepted
        assertFalse(raw.addressesMatched)
        assertNull(raw.frame.target)
        assertTrue(OfflineKwpReview.parse("015556","12","34") is OfflineKwpResult.Rejected)
        assertTrue(OfflineKwpReview.parse("C11234555C","12","34") is OfflineKwpResult.Rejected)
    }
}
