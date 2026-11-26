package ru.traksos.minidiagnostic

// Android-independent client of the simulator; the exact wire codecs are exercised on both sides.
class DemoSession(
    private val adapter: SimulatedAdapter = SimulatedAdapter(),
    val startedAt: Long = 0L
) {
    private var sequence = 0L
    fun connect(now: Long): AdapterSnapshot {
        sequence = 0
        return adapter.connect(now)
    }
    fun disconnect() = adapter.disconnect()
    fun advance(now: Long) = adapter.advance(now)
    fun trip(channel: Channel) = adapter.trip(channel)
    fun setLights(channels: Set<Channel>, now: Long) = send(Op.SET_LIGHTS,AdapterProtocol.mask(channels),now)
    fun allOff(now: Long) = send(Op.ALL_OFF,0,now)
    fun heartbeat(now: Long) = send(Op.HEARTBEAT,0,now)
    fun resetFault(channel: Channel, now: Long) = send(Op.RESET_FAULT,AdapterProtocol.mask(setOf(channel)),now)
    private fun send(op: Op, payload: Int, now: Long): Reply {
        check(sequence < 0xFFFF_FFFFL)
        val id = ++sequence
        val wire = AdapterProtocol.encode(Request(op,id,payload))
        val reply = ReplyCodec.decode(ReplyCodec.encode(adapter.handle(wire,now)))
        check(reply != null && reply.seq == id && reply.state.simulated)
        return reply
    }
}
