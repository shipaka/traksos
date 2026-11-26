package ru.traksos.minidiagnostic

import java.util.Locale

// Offline single-DID response parsing. Does not transmit or infer ECU support.
enum class IdentityDid(val number:Int,val titleRu:String) {
    PART(0xF187,"Номер запасной части"),
    SW(0xF189,"Версия ПО изготовителя ТС"),
    SUPPLIER(0xF18A,"Идентификатор поставщика системы"),
    HW(0xF191,"Номер аппаратной части изготовителя ТС"),
    SUPPLIER_HW(0xF192,"Номер аппаратной части поставщика"),
    SUPPLIER_HW_VERSION(0xF193,"Версия аппаратной части поставщика"),
    SUPPLIER_SW(0xF194,"Номер ПО поставщика"),
    SUPPLIER_SW_VERSION(0xF195,"Версия ПО поставщика")
}
sealed interface IdentityReply {
    data class Value(val did:IdentityDid,val rawHex:String):IdentityReply
    data class Negative(val reason:Int):IdentityReply
    data class Rejected(val reason:String):IdentityReply
}
object UdsIdentityDecoder {
    fun decode(expected:IdentityDid,pdu:ByteArray):IdentityReply {
        fun u(i:Int)=pdu[i].toInt() and 255
        if(pdu.size !in 3..259) return IdentityReply.Rejected("LENGTH")
        if(u(0)==0x7F) return if(pdu.size==3 && u(1)==0x22)
            IdentityReply.Negative(u(2)) else IdentityReply.Rejected("NEGATIVE_FORMAT")
        if(u(0)!=0x62 || ((u(1) shl 8) or u(2))!=expected.number)
            return IdentityReply.Rejected("UNEXPECTED_DID")
        if(pdu.size<4) return IdentityReply.Rejected("EMPTY_VALUE")
        return IdentityReply.Value(expected,pdu.drop(3).joinToString("") { String.format(Locale.ROOT,"%02X",it.toInt() and 255) })
    }
}
data class IdentityCaptureScope(val captureId:String,val peerId:String,val path:ElectricalPath) {
    init { require(captureId.isNotBlank() && peerId.isNotBlank()) }
}
data class IdentityObservation(val scope:IdentityCaptureScope,val reply:IdentityReply)
data class IdentitySignature(val targetId:String,val path:ElectricalPath,
    val required:Map<IdentityDid,String>,val evidence:String)
sealed interface IdentityResolution {
    data class ReferenceMatch(val targetId:String,val evidence:String):IdentityResolution
    data class Unknown(val observed:Map<IdentityDid,String>):IdentityResolution
    data class Ambiguous(val candidates:Set<String>):IdentityResolution
    data class Rejected(val reason:String):IdentityResolution
}
private fun validIdentityHex(s:String)=s.length in 2..512 && s.length%2==0 &&
    s.all { it in '0'..'9' || it in 'A'..'F' }
class EcuIdentityResolver(signatures:List<IdentitySignature> = emptyList()) {
    private val rows=signatures.map { it.copy(required=it.required.toMap()) }
    init {
        require(rows.all { s ->
            s.targetId.isNotBlank() && s.evidence.isNotBlank() &&
            IdentityDid.SUPPLIER in s.required && IdentityDid.PART in s.required &&
            (IdentityDid.HW in s.required || IdentityDid.SUPPLIER_HW in s.required) &&
            (IdentityDid.SW in s.required || IdentityDid.SUPPLIER_SW_VERSION in s.required) &&
            s.required.values.all(::validIdentityHex)
        })
    }
    fun resolve(expected:IdentityCaptureScope,observations:List<IdentityObservation>):IdentityResolution {
        if(observations.size>64) return IdentityResolution.Rejected("OBSERVATION_LIMIT")
        if(observations.any { it.scope!=expected }) return IdentityResolution.Rejected("MIXED_SOURCE")
        if(observations.any { it.reply is IdentityReply.Rejected }) return IdentityResolution.Rejected("INVALID_REPLY")
        val values=linkedMapOf<IdentityDid,String>()
        for(o in observations) {
            val v=o.reply as? IdentityReply.Value ?: continue
            if(!validIdentityHex(v.rawHex)) return IdentityResolution.Rejected("INVALID_VALUE")
            val old=values.put(v.did,v.rawHex)
            if(old!=null && old!=v.rawHex) return IdentityResolution.Rejected("CONFLICTING_IDENTITY")
        }
        val matches=rows.filter { s -> s.path==expected.path &&
            s.required.all { (did,raw)->values[did]==raw } }
        if(matches.isEmpty()) return IdentityResolution.Unknown(values.toMap())
        // Do not resolve a partial match if another known signature remains possible.
        val possible=rows.filter { s -> s.path==expected.path &&
            s.required.none { (did,raw)->values.containsKey(did) && values[did]!=raw } }
        if(possible.size!=1) return IdentityResolution.Ambiguous(possible.map { it.targetId }.toSet())
        return IdentityResolution.ReferenceMatch(matches.single().targetId,matches.single().evidence)
    }
    // A reference match is not authentication or permission to read/clear DTCs.
}
