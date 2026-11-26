package ru.traksos.minidiagnostic

// Internal phone-adapter protocol, NOT an ECU protocol. Only simulator at this stage.
// Fixed 9-byte little-endian frame: version, opcode, sequence u32, payload u8, reserved u16.
enum class Op(val wire: Int) {
    STATE(1), SET_LIGHTS(2), ALL_OFF(3), RESET_FAULT(4), HEARTBEAT(5),
    IDENTIFY_ECU(16), READ_DTC(17), CLEAR_DTC(18)
}
data class Request(val op: Op, val seq: Long, val payload: Int = 0) {
    init { require(seq in 1..0xFFFF_FFFFL); require(payload in 0..127) }
}
object AdapterProtocol {
    const val VERSION = 1
    const val FRAME_SIZE = 9
    private val channelMask = 0x7F
    fun mask(channels: Set<Channel>): Int = channels.fold(0) { m, c -> m or (1 shl c.ordinal) }
    fun channels(mask: Int): Set<Channel> {
        require(mask and channelMask == mask)
        return Channel.entries.filter { mask and (1 shl it.ordinal) != 0 }.toSet()
    }
    fun validPayload(r: Request): Boolean = when(r.op) {
        Op.SET_LIGHTS -> true
        Op.RESET_FAULT -> r.payload != 0 && Integer.bitCount(r.payload) == 1
        else -> r.payload == 0
    }
    fun encode(r: Request): ByteArray {
        require(validPayload(r))
        return java.nio.ByteBuffer.allocate(FRAME_SIZE).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            .put(VERSION.toByte()).put(r.op.wire.toByte()).putInt(r.seq.toInt())
            .put(r.payload.toByte()).putShort(0.toShort()).array()
    }
    fun decode(bytes: ByteArray): Request? {
        if (bytes.size != FRAME_SIZE) return null
        val b = java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        if (b.get().toInt() != VERSION) return null
        val op = Op.entries.firstOrNull { it.wire == (bytes[1].toInt() and 255) } ?: return null
        b.get()
        val seq = b.int.toLong() and 0xFFFF_FFFFL
        val payload = b.get().toInt() and 255
        if (seq == 0L || payload > 127 || b.short.toInt() != 0) return null
        val r = Request(op,seq,payload)
        return r.takeIf(::validPayload)
    }
}
enum class ResultCode { OK, INVALID, NOT_CONNECTED, REPLAY, FAULT_LATCHED, UNSUPPORTED }
data class AdapterSnapshot(val connected: Boolean, val lights: LightState, val simulated: Boolean = true)
data class Reply(val seq: Long, val code: ResultCode, val state: AdapterSnapshot)
