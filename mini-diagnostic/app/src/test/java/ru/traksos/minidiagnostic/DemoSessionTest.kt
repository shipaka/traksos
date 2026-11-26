package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class DemoSessionTest {
    @Test fun userControlsRoundTripAndFaultResetNeverEnergizes() {
        val s = DemoSession()
        s.connect(0)
        assertEquals(setOf(Channel.LEFT,Channel.RIGHT),s.setLights(setOf(Channel.LEFT,Channel.RIGHT),1).state.lights.enabled)
        s.trip(Channel.LEFT)
        val blocked = s.setLights(setOf(Channel.LEFT,Channel.STOP),2)
        assertEquals(ResultCode.FAULT_LATCHED,blocked.code)
        assertEquals(setOf(Channel.RIGHT),blocked.state.lights.enabled)
        val reset = s.resetFault(Channel.LEFT,3)
        assertEquals(setOf(Channel.RIGHT),reset.state.lights.enabled)
        assertTrue(reset.state.lights.faults.isEmpty())
        assertTrue(s.allOff(4).state.lights.enabled.isEmpty())
    }
    @Test fun timeoutAndReconnectNeverRestoreOutputs() {
        val s = DemoSession()
        s.connect(0)
        s.setLights(setOf(Channel.STOP),1)
        assertTrue(s.heartbeat(1000).state.connected)
        assertFalse(s.advance(3000).connected)
        assertEquals(ResultCode.NOT_CONNECTED,s.setLights(setOf(Channel.STOP),3001).code)
        assertTrue(s.connect(3002).lights.enabled.isEmpty())
    }
    @Test fun malformedRepliesRejected() {
        val good = ReplyCodec.encode(Reply(42,ResultCode.OK,AdapterSnapshot(true,LightState(setOf(Channel.STOP)))))
        assertEquals(42L,ReplyCodec.decode(good)?.seq)
        assertNull(ReplyCodec.decode(good.copyOf(9)))
        assertNull(ReplyCodec.decode(good.clone().apply { this[6]=7 }))
        assertNull(ReplyCodec.decode(good.clone().apply { this[6]=2 }))
        assertNull(ReplyCodec.decode(good.clone().apply { this[8]=this[7] }))
        assertNull(ReplyCodec.decode(good.clone().apply { this[9]=1 }))
    }
}
