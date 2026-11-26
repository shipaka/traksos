package ru.traksos.minidiagnostic

// Strict offline subset: classic CAN data frames, normal addressing, 12-bit FF length.
// Caller must preselect exactly one response from a verified capture. Never transmits.
data class IsoTpAddress(val bus:String,val id:Int,val extended:Boolean) {
    init { require(bus.isNotBlank() && id in 0..(if(extended) 0x1fffffff else 0x7ff)) }
}
data class IsoTpCapturedFrame(val address:IsoTpAddress,val timeNanos:Long,val data:ByteArray)
sealed interface IsoTpResult {
    data class Complete(val payload:List<Int>):IsoTpResult
    data class Rejected(val reason:String):IsoTpResult
}
object IsoTpOffline {
    fun assemble(frames:List<IsoTpCapturedFrame>, expected:IsoTpAddress,
        maxGapNanos:Long):IsoTpResult {
        fun reject(reason:String)=IsoTpResult.Rejected(reason)
        // maxGapNanos is caller policy, not an assertion of standard timing compliance.
        if(maxGapNanos<=0) return reject("INVALID_GAP_POLICY")
        if(frames.size !in 1..586) return reject("FRAME_COUNT")
        var last:Long?=null
        for(f in frames) {
            if(f.address!=expected) return reject("ADDRESS_MISMATCH")
            if(f.timeNanos<0 || f.data.size !in 1..8) return reject("INVALID_FRAME")
            last?.let { if(f.timeNanos<it || f.timeNanos-it>maxGapNanos) return reject("TIMESTAMP_GAP") }
            last=f.timeNanos
        }
        fun ByteArray.u(i:Int)=this[i].toInt() and 255
        val first=frames.first().data
        val kind=first.u(0) ushr 4
        if(kind==0) {
            val size=first.u(0) and 15
            if(size !in 1..7 || size>first.size-1) return reject("SINGLE_LENGTH")
            if(frames.size!=1) return reject("EXTRA_FRAME")
            return IsoTpResult.Complete((1..size).map { first.u(it) })
        }
        if(kind!=1 || first.size!=8) return reject("FIRST_FRAME")
        val total=((first.u(0) and 15) shl 8) or first.u(1)
        if(total !in 8..4095) return reject("FIRST_LENGTH")
        val pdu=ArrayList<Int>(total)
        for(i in 2..7) pdu.add(first.u(i))
        var sequence=1
        for(f in frames.drop(1)) {
            if(pdu.size==total) return reject("EXTRA_FRAME")
            val d=f.data
            if(d.u(0) ushr 4!=2) return reject("NOT_CONSECUTIVE")
            if((d.u(0) and 15)!=sequence) return reject("SEQUENCE")
            val needed=minOf(7,total-pdu.size)
            if(d.size<needed+1) return reject("TRUNCATED_FRAME")
            // A non-final frame necessarily has 7 data bytes. On final frame, ignore
            // trailing padding, but do not claim padding policy was verified.
            for(i in 1..needed) pdu.add(d.u(i))
            sequence=(sequence+1) and 15
        }
        if(pdu.size!=total) return reject("INCOMPLETE")
        return IsoTpResult.Complete(pdu.toList())
    }
}
