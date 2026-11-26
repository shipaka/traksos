package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class IsoTpOfflineTest {
    private val addr=IsoTpAddress("synthetic",0x123,false)
    private fun f(t:Long,vararg bytes:Int)=IsoTpCapturedFrame(addr,t,bytes.map { it.toByte() }.toByteArray())
    private fun assemble(vararg frames:IsoTpCapturedFrame)=IsoTpOffline.assemble(frames.toList(),addr,1000)
    @Test fun singleAndMultiFrame() {
        assertEquals(IsoTpResult.Complete(listOf(1,2,3)),assemble(f(0,3,1,2,3,0,0,0,0)))
        val first=f(0,0x10,0x0A,0,1,2,3,4,5)
        val next=f(1,0x21,6,7,8,9)
        assertEquals(IsoTpResult.Complete((0..9).toList()),assemble(first,next))
        assertEquals(IsoTpResult.Rejected("INCOMPLETE"),assemble(first))
        assertEquals(IsoTpResult.Rejected("EXTRA_FRAME"),assemble(first,next,next))
        assertEquals(IsoTpResult.Rejected("SEQUENCE"),assemble(first,f(1,0x22,6,7,8,9)))
        assertEquals(IsoTpResult.Rejected("TRUNCATED_FRAME"),assemble(first,f(1,0x21,6)))
        assertEquals(IsoTpResult.Rejected("ADDRESS_MISMATCH"),assemble(first,next.copy(address=addr.copy(extended=true))))
        assertEquals(IsoTpResult.Rejected("TIMESTAMP_GAP"),assemble(first,next.copy(timeNanos=1001)))
        assertEquals(IsoTpResult.Rejected("TIMESTAMP_GAP"),assemble(first.copy(timeNanos=2),next))
        assertEquals(IsoTpResult.Rejected("NOT_CONSECUTIVE"),assemble(first,f(1,0x30,0,0)))
    }
    @Test fun wrapsSequenceAndBoundsPayload() {
        val bytes=List(4095){ it and 255 }
        val frames=mutableListOf(f(0,0x1F,0xFF,*bytes.take(6).toIntArray()))
        bytes.drop(6).chunked(7).forEachIndexed { i,b ->
            frames.add(f((i+1).toLong(),0x20 or ((i+1) and 15),*b.toIntArray()))
        }
        assertEquals(586,frames.size)
        assertEquals(IsoTpResult.Complete(bytes),IsoTpOffline.assemble(frames,addr,1000))
        assertEquals(IsoTpResult.Rejected("FIRST_LENGTH"),assemble(f(0,0x10,0,0,0,0,0,0,0)))
        assertEquals(IsoTpResult.Rejected("SINGLE_LENGTH"),assemble(f(0,0,1)))
        assertEquals(IsoTpResult.Rejected("SINGLE_LENGTH"),assemble(f(0,8,1,2,3,4,5,6,7)))
        assertEquals(IsoTpResult.Rejected("INVALID_FRAME"),assemble(f(0,1,2,3,4,5,6,7,8,9)))
    }
    @Test fun syntheticUdsBridgeRetainsRawCodesWithoutVendorGuessing() {
        val meta=CaptureMetadata(CaptureOrigin.SYNTHETIC,null,0)
        val first=f(0,0x10,11,0x59,2,0x49,0x12,0x34,0x56)
        val next=f(1,0x21,1,0xAB,0xCD,0xEF,8)
        val bridge=IsoTpUdsImport()
        val report=bridge.importResponse(meta,listOf(first,next),addr,1000) as CaptureResult.Report
        assertEquals("59024912345601ABCDEF08",report.rawPduHex)
        assertEquals(listOf("123456","ABCDEF"),report.records.map { it.raw.code })
        assertEquals(listOf(DtcStatus.ACTIVE,DtcStatus.STORED),report.records.map { it.raw.status })
        assertTrue(report.records.all { it.descriptionRu==null })
        assertNull(report.profileId)
        assertEquals(CaptureResult.Rejected("ISOTP_INCOMPLETE"),bridge.importResponse(meta,listOf(first),addr,1000))
    }
}
