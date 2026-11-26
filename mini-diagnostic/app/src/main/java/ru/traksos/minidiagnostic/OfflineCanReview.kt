package ru.traksos.minidiagnostic

import java.security.MessageDigest
import java.util.Locale

// Strict, offline candump compact text subset. A pasted slice is not authenticated
// bus evidence and cannot establish a vendor profile, a request, or direction.
sealed interface OfflineCanResult {
    data class Accepted(val address:IsoTpAddress,val frameCount:Int,val traceSha256:String,
        val originalText:String,val capture:CaptureResult):OfflineCanResult
    data class Rejected(val reason:String,val line:Int?=null):OfflineCanResult
}
object OfflineCanReview {
    const val MAX_INPUT=65536
    const val MAX_FRAMES=586
    // Local import policy only; not a claim about ISO-TP timeout compliance.
    const val GAP_NANOS=1_000_000_000L
    private val addrPattern=Regex("""([A-Za-z0-9_.-]{1,32})[ \t]+([0-9A-Fa-f]{3}|[0-9A-Fa-f]{8})""")
    private val framePattern=Regex("""\(([0-9]{1,10})\.([0-9]{1,9})\)[ \t]+([A-Za-z0-9_.-]{1,32})[ \t]+([0-9A-Fa-f]{3}|[0-9A-Fa-f]{8})#([0-9A-Fa-f]{2,16})""")
    private fun address(bus:String,hex:String):IsoTpAddress? {
        val id=hex.toLongOrNull(16) ?: return null
        val ext=hex.length==8
        if(id !in 0..(if(ext) 0x1FFFFFFFL else 0x7FFL))return null
        return IsoTpAddress(bus,id.toInt(),ext)
    }
    private fun timestamp(seconds:String,fraction:String):Long? {
        val s=seconds.toLongOrNull() ?: return null
        val ns=fraction.padEnd(9,'0').toLongOrNull() ?: return null
        if(s>(Long.MAX_VALUE-ns)/1_000_000_000L)return null
        return s*1_000_000_000L+ns
    }
    fun parse(expectedText:String,input:String,synthetic:Boolean,now:Long):OfflineCanResult {
        fun reject(reason:String,line:Int?=null)=OfflineCanResult.Rejected(reason,line)
        if(input.length>MAX_INPUT)return reject("INPUT_TOO_LONG")
        if(expectedText.length>80)return reject("INVALID_ADDRESS")
        val m=addrPattern.matchEntire(expectedText.trim()) ?: return reject("INVALID_ADDRESS")
        val expected=address(m.groupValues[1],m.groupValues[2]) ?: return reject("INVALID_ADDRESS")
        if(input.isBlank())return reject("EMPTY_INPUT")
        val lines=input.trim().lines()
        if(lines.size !in 1..MAX_FRAMES)return reject("FRAME_COUNT")
        val frames=ArrayList<IsoTpCapturedFrame>(lines.size)
        for((i,line) in lines.withIndex()) {
            val f=framePattern.matchEntire(line.trim()) ?: return reject("FRAME_FORMAT",i+1)
            val (sec,frac,bus,id,data)=f.destructured
            val peer=address(bus,id) ?: return reject("INVALID_ADDRESS",i+1)
            if(peer!=expected)return reject("ADDRESS_MISMATCH",i+1)
            val time=timestamp(sec,frac) ?: return reject("TIMESTAMP_RANGE",i+1)
            if(data.length%2!=0)return reject("FRAME_FORMAT",i+1)
            val bytes=ByteArray(data.length/2) { n -> data.substring(n*2,n*2+2).toInt(16).toByte() }
            frames.add(IsoTpCapturedFrame(peer,time,bytes))
        }
        val assembled=IsoTpOffline.assemble(frames,expected,GAP_NANOS)
        if(assembled is IsoTpResult.Rejected)return reject("ISOTP_"+assembled.reason)
        val payload=(assembled as IsoTpResult.Complete).payload
        val hex=payload.joinToString("") { OfflineCaptureReview.hexByte(it) }
        val capture=OfflineCaptureReview.parse(hex,synthetic,now)
        val sha=MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
            .joinToString("") { String.format(Locale.ROOT,"%02x",it.toInt() and 255) }
        return OfflineCanResult.Accepted(expected,frames.size,sha,input,capture)
    }
    fun reportText(result:OfflineCanResult):String=buildString {
        appendLine("ОФЛАЙН · выбранные кадры CAN · источник не проверен")
        when(result) {
            is OfflineCanResult.Rejected -> appendLine("Импорт отклонён: "+result.reason+
                (result.line?.let { " · строка "+it } ?: ""))
            is OfflineCanResult.Accepted -> {
                appendLine("Интерфейс: "+result.address.bus)
                appendLine("ID: "+String.format(Locale.ROOT,if(result.address.extended) "%08X" else "%03X",result.address.id))
                appendLine("Кадров: "+result.frameCount)
                appendLine("SHA-256 исходного текста UTF-8: "+result.traceSha256)
                appendLine("Направление обмена и полнота исходного журнала не подтверждены. Flow Control не проверен.")
                appendLine(OfflineCaptureReview.reportText(result.capture))
                appendLine("Исходный фрагмент:")
                append(result.originalText)
            }
        }
    }
}
