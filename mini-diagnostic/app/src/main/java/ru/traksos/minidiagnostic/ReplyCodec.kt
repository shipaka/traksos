package ru.traksos.minidiagnostic

// 10 bytes: version, explicit result, sequence LE, flags, enabled mask, faults, reserved.
object ReplyCodec {
    const val SIZE = 10
    private val codes = mapOf(ResultCode.OK to 0, ResultCode.INVALID to 1,
        ResultCode.NOT_CONNECTED to 2, ResultCode.REPLAY to 3,
        ResultCode.FAULT_LATCHED to 4, ResultCode.UNSUPPORTED to 5)
    fun encode(reply: Reply): ByteArray {
        require(reply.seq in 0..0xFFFF_FFFFL)
        val s = reply.state
        require(s.lights.enabled.intersect(s.lights.faults).isEmpty())
        require(s.connected || s.lights.enabled.isEmpty())
        return java.nio.ByteBuffer.allocate(SIZE).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            .put(1.toByte()).put(codes.getValue(reply.code).toByte()).putInt(reply.seq.toInt())
            .put(((if (s.connected) 1 else 0) or (if (s.simulated) 2 else 0)).toByte())
            .put(AdapterProtocol.mask(s.lights.enabled).toByte())
            .put(AdapterProtocol.mask(s.lights.faults).toByte()).put(0.toByte()).array()
    }
    fun decode(bytes: ByteArray): Reply? {
        if (bytes.size != SIZE || bytes[0].toInt() != 1) return null
        val code = codes.entries.firstOrNull { it.value == (bytes[1].toInt() and 255) }?.key ?: return null
        val b = java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        b.position(2)
        val seq = b.int.toLong() and 0xFFFF_FFFFL
        val flags = b.get().toInt() and 255
        val on = b.get().toInt() and 255
        val faults = b.get().toInt() and 255
        if (flags > 3 || on > 127 || faults > 127 || b.get().toInt() != 0) return null
        val connected = flags and 1 != 0
        if (on and faults != 0 || (!connected && on != 0)) return null
        return Reply(seq,code,AdapterSnapshot(connected,
            LightState(AdapterProtocol.channels(on),AdapterProtocol.channels(faults)),flags and 2 != 0))
    }
}
