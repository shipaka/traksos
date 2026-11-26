package ru.traksos.minidiagnostic

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun OfflineCaptureContent(targetId:String?) {
    var mode by remember { mutableStateOf("UDS") }
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp)) {
        listOf("UDS","CAN","KWP").forEach { item ->
            if(mode==item) Button(onClick={},enabled=false,modifier=Modifier.weight(1f)) { Text(item) }
            else OutlinedButton(onClick={mode=item},modifier=Modifier.weight(1f)) { Text(item) }
        }
    }
    if(mode=="CAN") {
        OfflineCanContent(targetId)
        return
    }
    if(mode=="KWP") {
        OfflineKwpContent(targetId)
        return
    }
    var input by remember { mutableStateOf("") }
    var synthetic by remember { mutableStateOf(false) }
    var tooLong by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<CaptureResult?>(null) }
    val clipboard=LocalClipboardManager.current
    val selected=targetId?.let(CoverageRoadmap::byId)
    Text("Офлайн-разбор UDS",fontWeight=FontWeight.Bold)
    Text("Вставьте полный, уже собранный диагностический ответ 59 01, 59 02 или 7F 19 в HEX. Не отдельный CAN-кадр и не запрос. Прибор не подключается и команды не отправляются.")
    if(selected!=null) Text("Выбрано вручную: "+selected.maker+" · "+selected.model+". Это не идентификация источника.")
    Text("Таблицы отображаемых кодов не применяются к сырым DTC без подтверждённого профиля.",color=MaterialTheme.colorScheme.error)
    OutlinedTextField(value=input,onValueChange={
        result=null; synthetic=false
        tooLong=it.length>16384
        // Reject oversized edits; never silently truncate a diagnostic response.
        if(!tooLong)input=it
    },label={ Text("Полный ответ HEX") },modifier=Modifier.fillMaxWidth(),minLines=3,maxLines=6,isError=tooLong)
    if(tooLong)Text("Слишком большой ввод. Предыдущий текст не заменён.",color=MaterialTheme.colorScheme.error)
    OutlinedButton(onClick={
        input="59 02 49 AB CD EF 09 00 00 01 08"
        synthetic=true; tooLong=false; result=null
    },modifier=Modifier.fillMaxWidth()) { Text("Вставить синтетический пример") }
    if(synthetic)Text("СИНТЕТИЧЕСКИЙ ПРИМЕР — не данные реального блока",color=MaterialTheme.colorScheme.error)
    Button(onClick={
        result=OfflineCaptureReview.parse(input,synthetic,System.currentTimeMillis())
    },enabled=input.isNotBlank() && !tooLong,modifier=Modifier.fillMaxWidth()) { Text("Разобрать ответ") }
    result?.let { r ->
        Text(OfflineCaptureReview.reportText(r),style=MaterialTheme.typography.bodySmall)
        if(r !is CaptureResult.Rejected) OutlinedButton(onClick={
            clipboard.setText(AnnotatedString(OfflineCaptureReview.reportText(r)))
        },modifier=Modifier.fillMaxWidth()) { Text("Копировать отчёт") }
    }
    Text("Результаты не сохраняются в истории реальной диагностики. Исходный журнал обмена необходимо хранить отдельно.",style=MaterialTheme.typography.bodySmall)
}
