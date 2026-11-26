package ru.traksos.minidiagnostic

// Offline, complete ISO 14230-2:1999 message block only. No UART, initialization,
// transmit, automatic address discovery, or ECU-specific service interpretation.
enum class KwpAddressMode { NONE, PHYSICAL, FUNCTIONAL }
sealed interface KwpFrameResult {
    data class Frame(val mode:KwpAddressMode,val target:Int?,val source:Int?,
        val separateLength:Boolean,val payload:List<Int>,val checksum:Int):KwpFrameResult
    data class Rejected(val reason:String):KwpFrameResult
}
object KwpFrameDecoder {
    fun decode(bytes:ByteArray):KwpFrameResult {
        fun reject(reason:String)=KwpFrameResult.Rejected(reason)
        if(bytes.size !in 3..260) return reject("FRAME_SIZE")
        fun byte(i:Int)=bytes[i].toInt() and 255
        val format=byte(0)
        val mode=when(format ushr 6) {
            0 -> KwpAddressMode.NONE
            2 -> KwpAddressMode.PHYSICAL
            3 -> KwpAddressMode.FUNCTIONAL
            else -> return reject("UNSUPPORTED_CARB_HEADER")
        }
        var position=1
        var target:Int?=null
        var source:Int?=null
        if(mode!=KwpAddressMode.NONE) {
            if(bytes.size<5) return reject("TRUNCATED_ADDRESS")
            target=byte(position++)
            source=byte(position++)
        }
        var length=format and 63
        val extra=length==0
        if(extra) {
            if(position>=bytes.lastIndex) return reject("MISSING_LENGTH")
            length=byte(position++)
            if(length==0) return reject("ZERO_PAYLOAD")
        }
        if(bytes.size!=position+length+1) return reject("LENGTH_MISMATCH")
        val checksum=(0 until bytes.lastIndex).fold(0){sum,i->(sum+byte(i)) and 255}
        if(checksum!=byte(bytes.lastIndex)) return reject("CHECKSUM")
        return KwpFrameResult.Frame(mode,target,source,extra,
            (position until bytes.lastIndex).map { byte(it) },checksum)
    }
}

// Correlates a separately supplied, already captured physical response with a
// caller-provided address pair. Matching is not proof of origin or an ECU profile.
object KwpResponseAddress {
    fun matches(frame:KwpFrameResult,tester:Int,ecu:Int):Boolean =
        tester in 0..255 && ecu in 0..255 && tester!=ecu &&
            frame is KwpFrameResult.Frame && frame.mode==KwpAddressMode.PHYSICAL &&
            frame.target==tester && frame.source==ecu
}
