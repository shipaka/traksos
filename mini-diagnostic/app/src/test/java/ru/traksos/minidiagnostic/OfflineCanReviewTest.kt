package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class OfflineCanReviewTest {
    private val first="(1.000000) can0 7E8#100B590249ABCDEF"
    private val second="(1.010000) can0 7E8#2109000001080000"
    private val text="$first\n$second"
    private fun parse(s:String=text,id:String="can0 7E8")=OfflineCanReview.parse(id,s,true,1)
    @Test fun multiFrameAndOriginalEvidence() {
        val r=parse() as OfflineCanResult.Accepted
        assertEquals(2,r.frameCount)
        assertEquals(text,r.originalText)
        assertEquals(64,r.traceSha256.length)
        assertEquals(r.traceSha256,(parse() as OfflineCanResult.Accepted).traceSha256)
        assertNotEquals(r.traceSha256,(parse(text+"\n") as OfflineCanResult.Accepted).traceSha256)
        val p=r.capture as CaptureResult.Report
        assertEquals("590249ABCDEF0900000108",p.rawPduHex)
        assertEquals(listOf(DtcStatus.ACTIVE,DtcStatus.STORED),p.records.map { it.raw.status })
        assertNull(p.profileId)
        assertNull(p.metadata.identity)
        assertEquals(CaptureOrigin.SYNTHETIC,p.metadata.origin)
    }
    @Test fun rejectBadSourcesAndIncompleteSequence() {
        assertEquals("ISOTP_INCOMPLETE",(parse(first) as OfflineCanResult.Rejected).reason)
        assertEquals("ISOTP_SEQUENCE",(parse(first+"\n"+second.replace("#21","#22")) as OfflineCanResult.Rejected).reason)
        assertEquals("ADDRESS_MISMATCH",(parse(text.replace("1.010000) can0","1.010000) can1")) as OfflineCanResult.Rejected).reason)
        assertEquals("ISOTP_TIMESTAMP_GAP",(parse(text.replace("1.010000","3.010000")) as OfflineCanResult.Rejected).reason)
        assertEquals("ISOTP_EXTRA_FRAME",(parse(text+"\n"+second) as OfflineCanResult.Rejected).reason)
        for(s in listOf("(1.0) can0 7E8#R","(1.0) can0 7E8##1234","(1.0) can0 7E8#123","(1.0) can0 7E8#","(1.0) can0 7E8#123456789012345678","(9999999999.0) can0 7E8#03590249"))assertTrue(parse(s) is OfflineCanResult.Rejected)
        assertTrue(parse(id="can0 800") is OfflineCanResult.Rejected)
        assertTrue(parse(id="can0 20000000") is OfflineCanResult.Rejected)
        assertTrue(parse("A".repeat(65537)) is OfflineCanResult.Rejected)
    }
    @Test fun extendedAndNegativeReply() {
        val r=parse("(1700000000.123456789) can0 18DAF110#037F197800000000","can0 18DAF110") as OfflineCanResult.Accepted
        assertTrue(r.address.extended)
        assertEquals(0x78,(r.capture as CaptureResult.Negative).reason)
        assertTrue(OfflineCanReview.reportText(r).contains("Промежуточный ответ"))
    }
}
