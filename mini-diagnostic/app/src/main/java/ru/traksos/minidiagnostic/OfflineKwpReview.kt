package ru.traksos.minidiagnostic

import java.util.Locale

// Complete recorded frame only; no UART, address discovery or service interpretation.
sealed interface OfflineKwpResult {
    data class Accepted(val frame:KwpFrameResult.Frame,val rawHex:String,
        val synthetic:Boolean,val addressesMatched:Boolean):OfflineKwpResult
    data class Rejected(val reason:String):OfflineKwpResult
}
object OfflineKwpReview {
    const val MAX_INPUT=2048
    private fun isHex(c:Char)=c in '0'..'9' || c in 'a'..'f' || c in 'A'..'F'
    private fun address(s:String):Int?=s.trim().takeIf { it.length==2 && it.all(::isHex) }?.toInt(16)
    private fun hex(n:Int)=String.format(Locale.ROOT,"%02X",n)
    fun parse(input:String,testerText:String="",ecuText:String="",synthetic:Boolean=false):OfflineKwpResult {
        fun reject(reason:String)=OfflineKwpResult.Rejected(reason)
        if(input.length>MAX_INPUT)return reject("INPUT_TOO_LONG")
        if(testerText.length>16 || ecuText.length>16)return reject("INVALID_EXPECTED_ADDRESS")
        val s=input.trim()
        if(s.isEmpty())return reject("EMPTY_INPUT")
        val compact=if(s.any { it.isWhitespace() }) {
            val tokens=s.split(Regex("\\s+"))
            if(tokens.any { it.length!=2 })return reject("INVALID_HEX")
            tokens.joinToString("")
        } else s
        if(compact.length !in 6..520 || compact.length%2!=0 || !compact.all(::isHex))
            return reject("INVALID_HEX_OR_LENGTH")
        val bytes=ByteArray(compact.length/2) { i->compact.substring(i*2,i*2+2).toInt(16).toByte() }
        val frame=when(val decoded=KwpFrameDecoder.decode(bytes)) {
            is KwpFrameResult.Rejected -> return reject(decoded.reason)
            is KwpFrameResult.Frame -> decoded
        }
        val check=testerText.isNotBlank() || ecuText.isNotBlank()
        if(check) {
            val tester=address(testerText) ?: return reject("INVALID_EXPECTED_ADDRESS")
            val ecu=address(ecuText) ?: return reject("INVALID_EXPECTED_ADDRESS")
            if(tester==ecu)return reject("INVALID_EXPECTED_ADDRESS")
            if(!KwpResponseAddress.matches(frame,tester,ecu))return reject("ADDRESS_MISMATCH")
        }
        return OfflineKwpResult.Accepted(frame,compact.uppercase(Locale.ROOT),synthetic,check)
    }
    fun reportText(result:OfflineKwpResult):String=buildString {
        appendLine("ОФЛАЙН KWP · источник не проверен")
        when(result) {
            is OfflineKwpResult.Rejected -> appendLine("Кадр отклонён: "+result.reason)
            is OfflineKwpResult.Accepted -> {
                val f=result.frame
                appendLine(if(result.synthetic)"Синтетический пример" else "Введённая вручную запись")
                appendLine("Формат адресации: "+when(f.mode) {
                    KwpAddressMode.NONE -> "без адресов"
                    KwpAddressMode.PHYSICAL -> "физическая"
                    KwpAddressMode.FUNCTIONAL -> "функциональная"
                })
                appendLine("Получатель: "+(f.target?.let(::hex)?:"не указан"))
                appendLine("Отправитель: "+(f.source?.let(::hex)?:"не указан"))
                appendLine(if(result.addressesMatched)"Адреса совпадают с заданными пользователем" else "Адреса ожидаемого ответа не проверялись")
                appendLine("Длина данных: "+f.payload.size+" байт")
                appendLine("Поле длины: "+if(f.separateLength)"отдельный байт" else "в заголовке")
                appendLine("Контрольная сумма совпала: "+hex(f.checksum))
                appendLine("Данные: "+f.payload.joinToString(" "){hex(it)})
                appendLine("Исходный кадр: "+result.rawHex)
                appendLine("Сервис, DTC, направление записи и исправность ЭБУ не установлены.")
            }
        }
    }
}
