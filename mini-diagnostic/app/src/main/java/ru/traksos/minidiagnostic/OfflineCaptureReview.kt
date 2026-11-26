package ru.traksos.minidiagnostic

// Manual, untrusted application-layer capture. No transport, permissions or
// electronic identity can be derived from the manually chosen family.
object OfflineCaptureReview {
    fun parse(input:String,synthetic:Boolean,now:Long):CaptureResult =
        DiagnosticCapture().importHex(CaptureMetadata(
            if(synthetic) CaptureOrigin.SYNTHETIC else CaptureOrigin.MANUAL_BENCH_IMPORT,
            identity=null,observedAtEpochMs=now,statusSelectionMask=null),input)
    fun hexByte(value:Int):String=java.lang.String.format(java.util.Locale.ROOT,"%02X",value)
    fun statusLabel(status:DtcStatus):String=when(status) {
        DtcStatus.ACTIVE -> "Тест сообщает о неисправности"
        DtcStatus.STORED -> "Подтверждённая сохранённая ошибка; текущий тест не сообщает о сбое"
        DtcStatus.UNKNOWN -> "Текущее состояние не определено"
    }
    fun errorLabel(reason:String):String=when(reason) {
        "INPUT_TOO_LONG" -> "Ввод превышает допустимый размер"
        "EMPTY_INPUT" -> "Введите ответ"
        "INVALID_HEX" -> "Неверная запись шестнадцатеричных байтов"
        "TRUNCATED_RECORD" -> "Неполная запись DTC"
        "DUPLICATE_DTC" -> "Повторяющийся идентификатор DTC"
        "UNEXPECTED_SERVICE" -> "Не распознан ответ UDS 59 01 / 59 02"
        "NEGATIVE_RESPONSE" -> "Некорректный отрицательный ответ"
        "COUNT_LENGTH" -> "Неверная длина ответа о количестве DTC"
        "COUNT_OUTSIDE_STATUS_FILTER" -> "Ненулевое количество при отсутствии поддерживаемых выбранных статусов"
        "PDU_LENGTH" -> "Неверная длина ответа"
        "UNSUPPORTED_STATUS_FILTER" -> "Запрошенные статусы не поддерживаются в данном ответе"
        "RECORD_OUTSIDE_STATUS_FILTER" -> "Запись DTC не соответствует указанному фильтру"
        else -> "Ответ не принят"
    }
    fun reportText(result:CaptureResult):String=buildString {
        appendLine("ОФЛАЙН · источник не проверен")
        when(result) {
            is CaptureResult.Rejected -> appendLine(errorLabel(result.reason)+" ("+result.reason+")")
            is CaptureResult.Negative -> {
                appendLine("Отрицательный ответ: "+hexByte(result.reason))
                if(result.reason==0x78)appendLine("Промежуточный ответ: ожидается окончательный результат")
                appendLine("PDU: "+result.rawPduHex)
            }
            is CaptureResult.Count -> {
                appendLine(if(result.metadata.origin==CaptureOrigin.SYNTHETIC) "Синтетический пример" else "Введённый вручную ответ")
                appendLine("Электронная идентификация и профиль не подтверждены")
                appendLine("Маска доступных статусов: "+hexByte(result.availabilityMask))
                appendLine("Идентификатор формата DTC: "+hexByte(result.formatIdentifier))
                appendLine("Количество по ответу ЭБУ: "+result.count)
                appendLine("Фильтр и полнота списка не подтверждены; исправность не подтверждена")
                appendLine("PDU: "+result.rawPduHex)
            }
            is CaptureResult.Report -> {
                appendLine(if(result.metadata.origin==CaptureOrigin.SYNTHETIC) "Синтетический пример" else "Введённый вручную ответ")
                appendLine("Электронная идентификация и профиль не подтверждены")
                appendLine("Маска доступных статусов: "+hexByte(result.availabilityMask))
                appendLine("Записей в ответе: "+result.records.size)
                if(result.records.isEmpty())appendLine("Нет записей в данном ответе; исправность не подтверждена")
                result.records.forEach { d ->
                    appendLine(d.raw.code+" · статус "+d.raw.rawHex.takeLast(2)+" · "+statusLabel(d.raw.status))
                }
                appendLine("PDU: "+result.rawPduHex)
            }
        }
    }
}
