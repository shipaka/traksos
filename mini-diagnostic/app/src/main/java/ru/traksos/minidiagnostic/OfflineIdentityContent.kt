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
fun OfflineIdentityContent(targetId:String?) {
    var input by remember { mutableStateOf("") }
    var synthetic by remember { mutableStateOf(false) }
    var tooLong by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<OfflineIdentityResult?>(null) }
    val clipboard=LocalClipboardManager.current
    Text("Идентификационные данные UDS",fontWeight=FontWeight.Bold)
    targetId?.let(CoverageRoadmap::byId)?.let {
        Text("Ручной выбор: "+it.maker+" · "+it.model+". Он не подтверждает источник.")
    }
    Text("Вставьте ранее записанные полные ответы одного блока, по одной строке: ожидаемый DID, двоеточие, HEX ответа. Поддерживаются отдельные ответы 62 и 7F 22. Не CAN-кадры и не команды.")
    Text("Совпадение номера с каталогом — подсказка. Отправитель, аппаратная версия и прошивка не проверяются автоматически.",color=MaterialTheme.colorScheme.error)
    OutlinedTextField(value=input,onValueChange={
        result=null; synthetic=false
        tooLong=it.length>OfflineIdentityReview.MAX_INPUT
        if(!tooLong)input=it
    },modifier=Modifier.fillMaxWidth(),label={Text("DID: ответ HEX")},minLines=4,maxLines=8,isError=tooLong)
    if(tooLong)Text("Ввод слишком длинный. Предыдущий текст не заменён.",color=MaterialTheme.colorScheme.error)
    OutlinedButton(onClick={
        input="F187: 62 F1 87 54 45 53 54\nF189: 62 F1 89 30 31\nF18A: 7F 22 31"
        synthetic=true; tooLong=false; result=null
    },modifier=Modifier.fillMaxWidth()) {Text("Вставить синтетический пример")}
    if(synthetic)Text("СИНТЕТИЧЕСКИЙ ПРИМЕР",color=MaterialTheme.colorScheme.error)
    Button(onClick={result=OfflineIdentityReview.parse(input,synthetic)},enabled=input.isNotBlank() && !tooLong,modifier=Modifier.fillMaxWidth()) {Text("Разобрать идентификацию")}
    result?.let { r ->
        val report=OfflineIdentityReview.reportText(r)
        Text(report.take(6000),style=MaterialTheme.typography.bodySmall)
        if(report.length>6000)Text("Показано начало отчёта; копируется весь текст.")
        if(r is OfflineIdentityResult.Accepted)OutlinedButton(onClick={
            clipboard.setText(AnnotatedString(report))
        },modifier=Modifier.fillMaxWidth()) {Text("Копировать полный отчёт")}
    }
    Text("Результат не меняет выбранный блок, не включает диагностику и не сохраняется как реальная идентификация.",style=MaterialTheme.typography.bodySmall)
}
