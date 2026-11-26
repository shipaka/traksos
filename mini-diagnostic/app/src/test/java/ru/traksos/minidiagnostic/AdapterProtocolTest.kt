package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class AdapterProtocolTest {
    private fun frame(op: Op, seq: Long, payload: Int = 0) = AdapterProtocol.encode(Request(op,seq,payload))
    @Test fun roundTripAndExactMask() {
        val mask = AdapterProtocol.mask(setOf(Channel.LEFT,Channel.RIGHT,Channel.STOP))
        val r = Request(Op.SET_LIGHTS,0xFFFF_FFFFL,mask)
        assertEquals(r,AdapterProtocol.decode(AdapterProtocol.encode(r)))
        assertEquals(setOf(Channel.LEFT,Channel.RIGHT,Channel.STOP),AdapterProtocol.channels(mask))
    }
    @Test fun invalidFramesRejected() {
        val good = frame(Op.ALL_OFF,1)
        assertNull(AdapterProtocol.decode(good.copyOf(8)))
        assertNull(AdapterProtocol.decode(good.clone().apply { this[0]=2 }))
        assertNull(AdapterProtocol.decode(good.clone().apply { this[1]=99 }))
        assertNull(AdapterProtocol.decode(good.clone().apply { this[6]=1 }))
        assertNull(AdapterProtocol.decode(good.clone().apply { this[8]=1 }))
        assertNull(AdapterProtocol.decode(good.clone().apply { for(i in 2..5) this[i]=0 }))
    }
    @Test fun replayAndTimeoutFailOff() {
        val sim = SimulatedAdapter()
        sim.connect(0)
        val on = frame(Op.SET_LIGHTS,1,AdapterProtocol.mask(setOf(Channel.STOP)))
        assertEquals(ResultCode.OK,sim.handle(on,10).code)
        assertEquals(ResultCode.REPLAY,sim.handle(on,1000).code)
        val expired = sim.advance(2010)
        assertFalse(expired.connected)
        assertTrue(expired.lights.enabled.isEmpty())
        assertEquals(ResultCode.NOT_CONNECTED,sim.handle(on,2011).code)
    }
    @Test fun faultsPersistAcrossReconnectAndResetNeverEnergizes() {
        val sim = SimulatedAdapter()
        sim.connect(0)
        val bit = AdapterProtocol.mask(setOf(Channel.LEFT_SIDE))
        sim.handle(frame(Op.SET_LIGHTS,1,bit),1)
        sim.trip(Channel.LEFT_SIDE)
        sim.disconnect()
        sim.connect(2)
        assertEquals(ResultCode.FAULT_LATCHED,sim.handle(frame(Op.SET_LIGHTS,1,bit),3).code)
        val reset = sim.handle(frame(Op.RESET_FAULT,2,bit),4)
        assertTrue(reset.state.lights.enabled.isEmpty())
        assertTrue(reset.state.lights.faults.isEmpty())
    }
    @Test fun diagnosticCommandsRemainUnsupported() {
        val sim = SimulatedAdapter()
        sim.connect(0)
        listOf(Op.IDENTIFY_ECU,Op.READ_DTC,Op.CLEAR_DTC).forEachIndexed { i, op ->
            assertEquals(ResultCode.UNSUPPORTED,sim.handle(frame(op,(i+1).toLong()),i.toLong()).code)
        }
    }
    @Test fun unknownDtcNeverGuessed() {
        val d = DtcDefinition(EcuFamily.WABCO_TEBS_E,"test-profile","123","test only","test fixture")
        val catalog = DtcCatalog(listOf(d))
        val raw = RawDtc("123",DtcStatus.UNKNOWN,"0123")
        assertNull(catalog.decode(EcuFamily.WABCO_TEBS_E,null,raw).descriptionRu)
        assertNull(catalog.decode(EcuFamily.KNORR_TEBS_G2,"test-profile",raw).descriptionRu)
        assertEquals("test only",catalog.decode(EcuFamily.WABCO_TEBS_E,"test-profile",raw).descriptionRu)
    }
}
