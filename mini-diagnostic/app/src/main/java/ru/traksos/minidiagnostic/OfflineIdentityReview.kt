package ru.traksos.minidiagnostic

import java.util.Locale
import java.security.MessageDigest

// Strict offline review of manually paired DID responses. No electronic identity
// is established, even when the part bytes happen to match a published catalog.
data class ReviewedIdentityRow(val did:IdentityDid,val rawPdu:String,val reply:IdentityReply)
sealed interface OfflineIdentityResult {
    data class Accepted(val rows:List<ReviewedIdentityRow>,val observed:Map<IdentityDid,String>,
        val catalogCandidates:List<String>,val synthetic:Boolean,val sha256:String,
        val originalText:String):OfflineIdentityResult
    data class Rejected(val reason:String,val line:Int?=null):OfflineIdentityResult
}
object OfflineIdentityReview {
    const val MAX_INPUT=32768
    private val rowPattern=Regex("""([0-9A-Fa-f]{4})[ \t]*:[ \t]*(.+)""")
    private fun hexChar(c:Char)=c in '0'..'9' || c in 'A'..'F' || c in 'a'..'f'
    private fun decodeHex(input:String):ByteArray? {
        val s=input.trim()
        val compact=if(s.any { it.isWhitespace() }) {
            val tokens=s.split(Regex("\\s+"))
            if(tokens.any { it.length!=2 })return null
            tokens.joinToString("")
        } else s
        if(compact.length !in 6..518 || compact.length%2!=0 || !compact.all(::hexChar))return null
        return ByteArray(compact.length/2) { i->compact.substring(i*2,i*2+2).toInt(16).toByte() }
    }
    private fun ByteArray.hex()=joinToString("") { OfflineCaptureReview.hexByte(it.toInt() and 255) }
    // Only printable ASCII. No guessed BCD, endianness, encoding or stripped padding.
    fun printableAscii(hex:String):String? {
        if(hex.length !in 2..512 || hex.length%2!=0 || !hex.all(::hexChar))return null
        val bytes=hex.chunked(2).map { it.toInt(16) }
        if(bytes.any { it !in 32..126 })return null
        return bytes.map { it.toChar() }.joinToString("")
    }
    fun parse(input:String,synthetic:Boolean):OfflineIdentityResult {
        fun reject(reason:String,line:Int?=null)=OfflineIdentityResult.Rejected(reason,line)
        if(input.length>MAX_INPUT)return reject("INPUT_TOO_LONG")
        if(input.isBlank())return reject("EMPTY_INPUT")
        val lines=input.trim().lines()
        if(lines.size !in 1..64)return reject("ROW_COUNT")
        val rows=ArrayList<ReviewedIdentityRow>(lines.size)
        val values=linkedMapOf<IdentityDid,String>()
        for((i,line) in lines.withIndex()) {
            val match=rowPattern.matchEntire(line.trim()) ?: return reject("ROW_FORMAT",i+1)
            val didNumber=match.groupValues[1].toInt(16)
            val did=IdentityDid.entries.firstOrNull { it.number==didNumber } ?: return reject("UNKNOWN_DID",i+1)
            val pdu=decodeHex(match.groupValues[2]) ?: return reject("INVALID_HEX",i+1)
            val reply=UdsIdentityDecoder.decode(did,pdu)
            when(reply) {
                is IdentityReply.Rejected -> return reject(reply.reason,i+1)
                is IdentityReply.Value -> {
                    val prior=values.put(did,reply.rawHex)
                    if(prior!=null && prior!=reply.rawHex)return reject("CONFLICTING_IDENTITY",i+1)
                }
                is IdentityReply.Negative -> Unit
            }
            rows.add(ReviewedIdentityRow(did,pdu.hex(),reply))
        }
        // Deliberately exclude numeric-range matches, aliases and synthetic data.
        // Only the part DID may suggest an exact published catalog association.
        val part=values[IdentityDid.PART]?.let(::printableAscii)
        val candidates=if(!synthetic && part!=null &&
            Regex("[0-9]+(?:[ -][0-9]+)*").matches(part) &&
            part.count { it in '0'..'9' } in 9..10)
            CatalogModuleParts.targetIds(part) else emptyList()
        val sha=MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
            .joinToString("") { String.format(Locale.ROOT,"%02x",it.toInt() and 255) }
        return OfflineIdentityResult.Accepted(rows.toList(),values.toMap(),candidates.toList(),synthetic,sha,input)
    }
    fun reportText(result:OfflineIdentityResult):String=buildString {
        appendLine("ОФЛАЙН · электронная идентификация НЕ подтверждена")
        when(result) {
            is OfflineIdentityResult.Rejected -> appendLine("Набор отклонён: "+result.reason+
                (result.line?.let { " · строка "+it } ?: ""))
            is OfflineIdentityResult.Accepted -> {
                appendLine(if(result.synthetic)"Синтетический пример" else "Ручной импорт; общий физический источник не подтверждён")
                appendLine("Ответов: "+result.rows.size+"; разных полученных полей: "+result.observed.size)
                for(row in result.rows) {
                    appendLine(String.format(Locale.ROOT,"%04X",row.did.number)+" · "+row.did.titleRu)
                    when(val reply=row.reply) {
                        is IdentityReply.Value -> {
                            appendLine("HEX: "+reply.rawHex)
                            printableAscii(reply.rawHex)?.let { appendLine("Возможное ASCII-представление: "+it) }
                        }
                        is IdentityReply.Negative -> appendLine("Отрицательный ответ: "+OfflineCaptureReview.hexByte(reply.reason))
                        is IdentityReply.Rejected -> Unit
                    }
                    appendLine("PDU: "+row.rawPdu)
                }
                if(result.catalogCandidates.isEmpty())appendLine("Нет точного каталожного кандидата по допустимому ASCII номера детали.")
                else {
                    appendLine("Каталожные кандидаты (не подтверждение модели):")
                    for(id in result.catalogCandidates) {
                        val t=CoverageRoadmap.byId(id)
                        appendLine(if(t==null)id else t.maker+" · "+t.model)
                    }
                }
                appendLine("Версия, происхождение, профиль и право подключения не подтверждены.")
                appendLine("SHA-256 исходного текста UTF-8: "+result.sha256)
                appendLine("Исходные строки:")
                append(result.originalText)
            }
        }
    }
}
