package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class BenchRoundTripTest {
    @Test fun exactConversationMatchesSimulator() {
        val sim = SimulatedAdapter()
        sim.connect(0)
        BenchRoundTrip.requests.forEachIndexed { i,r ->
            val response = ReplyCodec.encode(sim.handle(AdapterProtocol.encode(r),i.toLong()))
            assertTrue("step $i",BenchRoundTrip.matches(i,response))
            assertFalse(BenchRoundTrip.matches(i,response.clone().apply { this[6]=1 })) // real flag
            assertFalse(BenchRoundTrip.matches(i,response.clone().apply { this[2]=99 })) // sequence
        }
    }
    @Test fun firmwareVersionMustBeExact() {
        val v = byteArrayOf(0x54,0x53,0x4D,0x44,1,1,3,0)
        assertTrue(BenchCapabilities.isRoundTrip(v))
        assertFalse(BenchCapabilities.isCompatible(v))
        assertFalse(BenchCapabilities.isRoundTrip(v.clone().apply { this[6]=7 }))
    }
}
