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
fun OfflineKwpContent(targetId:String?) {
    var input by remember { mutableStateOf("") }
    var tester by remember { mutableStateOf("") }
    var ecu by remember { mutableStateOf("") }
    var tooLong by remember { mutableStateOf(false) }
    var synthetic by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<OfflineKwpResult?>(null) }
    val clipboard=LocalClipboardManager.current
    Text("Офлайн-разбор KWP / ISO 14230",fontWeight=FontWeight.Bold)
    targetId?.let(CoverageRoadmap::byId)?.let {
        Text("Выбрано вручную: "+it.maker+" · "+it.model+". Источник не подтверждён.")
    }
    Text("Вставьте один полный записанный кадр, включая заголовок, длину и контрольную сумму. Это проверка структуры, а не чтение по K-line.")
    Text("Для проверки ожидаемого физического ответа укажите оба адреса из журнала. Если они неизвестны, оставьте оба поля пустыми.")
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
        OutlinedTextField(value=tester,onValueChange={
            tester=it.take(17); result=null; synthetic=false
        },modifier=Modifier.weight(1f),label={ Text("Тестер HEX") },singleLine=true)
        OutlinedTextField(value=ecu,onValueChange={
            ecu=it.take(17); result=null; synthetic=false
        },modifier=Modifier.weight(1f),label={ Text("ЭБУ HEX") },singleLine=true)
    }
    OutlinedTextField(value=input,onValueChange={
        result=null; synthetic=false
        tooLong=it.length>OfflineKwpReview.MAX_INPUT
        if(!tooLong)input=it
    },modifier=Modifier.fillMaxWidth(),label={Text("Кадр HEX")},minLines=3,maxLines=6,isError=tooLong)
    if(tooLong)Text("Ввод слишком длинный. Предыдущий текст не заменён.",color=MaterialTheme.colorScheme.error)
    OutlinedButton(onClick={
        tester="12"; ecu="34"; input="82 12 34 55 66 83"
        synthetic=true; tooLong=false; result=null
    },modifier=Modifier.fillMaxWidth()) { Text("Вставить синтетический пример") }
    if(synthetic)Text("СИНТЕТИЧЕСКИЙ ПРИМЕР — условные адреса и данные",color=MaterialTheme.colorScheme.error)
    Button(onClick={
        result=OfflineKwpReview.parse(input,tester,ecu,synthetic)
    },enabled=input.isNotBlank() && !tooLong,modifier=Modifier.fillMaxWidth()) { Text("Проверить кадр") }
    result?.let { r ->
        val report=OfflineKwpReview.reportText(r)
        Text(report,style=MaterialTheme.typography.bodySmall)
        if(r is OfflineKwpResult.Accepted) OutlinedButton(onClick={
            clipboard.setText(AnnotatedString(report))
        },modifier=Modifier.fillMaxWidth()) { Text("Копировать отчёт") }
    }
    Text("Справочник кодов не применяется автоматически. Никаких команд в блок не отправляется.",color=MaterialTheme.colorScheme.error)
}
