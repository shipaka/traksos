package ru.traksos.minidiagnostic

// Deterministic simulator; caller supplies monotonic milliseconds. No BLE or CAN I/O.
class SimulatedAdapter(private val timeoutMs: Long = 2000) {
    init { require(timeoutMs > 0) }
    private var lights = LightState()
    private var connected = false
    private var lastSeq = 0L
    private var lastSeen = 0L
    private var clock = 0L
    fun connect(now: Long): AdapterSnapshot {
        advance(now)
        lights = lights.allOff()
        connected = true
        lastSeq = 0
        lastSeen = now
        return snapshot()
    }
    fun disconnect(): AdapterSnapshot {
        connected = false
        lights = lights.allOff()
        return snapshot()
    }
    private fun snapshot() = AdapterSnapshot(connected,lights)
    fun advance(now: Long): AdapterSnapshot {
        require(now >= clock)
        clock = now
        if (connected && now - lastSeen >= timeoutMs) disconnect()
        return snapshot()
    }
    fun trip(channel: Channel): AdapterSnapshot {
        lights = lights.trip(channel)
        return snapshot()
    }
    fun handle(frame: ByteArray, now: Long): Reply {
        advance(now)
        val r = AdapterProtocol.decode(frame) ?: return Reply(0,ResultCode.INVALID,snapshot())
        fun reply(code: ResultCode) = Reply(r.seq,code,snapshot())
        if (!connected) return reply(ResultCode.NOT_CONNECTED)
        if (r.seq <= lastSeq) return reply(ResultCode.REPLAY)
        lastSeq = r.seq
        when(r.op) {
            Op.STATE, Op.HEARTBEAT -> Unit
            Op.ALL_OFF -> lights = lights.allOff()
            Op.SET_LIGHTS -> {
                val requested = AdapterProtocol.channels(r.payload)
                if (requested.any { it in lights.faults }) return reply(ResultCode.FAULT_LATCHED)
                lights = lights.copy(enabled = requested)
            }
            Op.RESET_FAULT -> lights = lights.resetFault(AdapterProtocol.channels(r.payload).single())
            Op.IDENTIFY_ECU, Op.READ_DTC, Op.CLEAR_DTC -> return reply(ResultCode.UNSUPPORTED)
        }
        lastSeen = now
        return reply(ResultCode.OK)
    }
}
