package ru.traksos.minidiagnostic

// Fixed USB-only test, not a general remote output-control interface.
object BenchRoundTrip {
    private val wanted = setOf(Channel.LEFT,Channel.RIGHT,Channel.STOP)
    val requests = listOf(
        Request(Op.STATE,1), Request(Op.SET_LIGHTS,2,AdapterProtocol.mask(wanted)),
        Request(Op.SET_LIGHTS,2,0), // replay must not change state
        Request(Op.ALL_OFF,3), Request(Op.READ_DTC,4), Request(Op.STATE,5)
    )
    fun matches(index:Int, bytes:ByteArray):Boolean {
        if (index !in requests.indices) return false
        val r = ReplyCodec.decode(bytes) ?: return false
        if (!r.state.simulated || !r.state.connected || r.seq != requests[index].seq || r.state.lights.faults.isNotEmpty()) return false
        val code = when(index) { 2 -> ResultCode.REPLAY; 4 -> ResultCode.UNSUPPORTED; else -> ResultCode.OK }
        val on = if(index == 1 || index == 2) wanted else emptySet()
        return r.code == code && r.state.lights.enabled == on
    }
}
