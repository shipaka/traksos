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
fun OfflineCanContent(targetId:String?) {
    var expected by remember { mutableStateOf("") }
    var input by remember { mutableStateOf("") }
    var synthetic by remember { mutableStateOf(false) }
    var tooLong by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<OfflineCanResult?>(null) }
    val clipboard=LocalClipboardManager.current
    Text("Офлайн-разбор CAN / ISO-TP",fontWeight=FontWeight.Bold)
    targetId?.let(CoverageRoadmap::byId)?.let {
        Text("Выбрано вручную: "+it.maker+" · "+it.model+". Источник не подтверждён.")
    }
    Text("Из журнала candump -L вставьте только заранее выделенные кадры ОДНОГО ответа одного блока. Укажите ожидаемый интерфейс и ID. Поддерживается классический CAN с обычной адресацией ISO-TP. Прибор не подключается.")
    Text("Смешанные адреса, пропуски и лишние кадры отклоняются. Интервал между кадрами ограничен 1 с (локальная политика).",color=MaterialTheme.colorScheme.error)
    OutlinedTextField(value=expected,onValueChange={
        expected=it.take(81); result=null; synthetic=false
    },modifier=Modifier.fillMaxWidth(),label={Text("Интерфейс и CAN ID")},singleLine=true)
    OutlinedTextField(value=input,onValueChange={
        result=null; synthetic=false
        tooLong=it.length>OfflineCanReview.MAX_INPUT
        if(!tooLong)input=it
    },modifier=Modifier.fillMaxWidth(),label={Text("Выбранный фрагмент candump")},minLines=3,maxLines=6,isError=tooLong)
    if(tooLong)Text("Слишком длинный фрагмент: ввод отклонён.",color=MaterialTheme.colorScheme.error)
    OutlinedButton(onClick={
        expected="can0 7E8"
        input="(1.000000) can0 7E8#100B590249ABCDEF\n(1.010000) can0 7E8#2109000001080000"
        synthetic=true; tooLong=false; result=null
    },modifier=Modifier.fillMaxWidth()) {Text("Вставить синтетический пример")}
    if(synthetic)Text("СИНТЕТИЧЕСКИЙ ПРИМЕР — не данные реального блока",color=MaterialTheme.colorScheme.error)
    Button(onClick={
        result=OfflineCanReview.parse(expected,input,synthetic,System.currentTimeMillis())
    },enabled=expected.isNotBlank() && input.isNotBlank() && !tooLong,modifier=Modifier.fillMaxWidth()) {Text("Разобрать фрагмент")}
    result?.let { r ->
        val report=OfflineCanReview.reportText(r)
        Text(report.take(4000),style=MaterialTheme.typography.bodySmall)
        if(report.length>4000)Text("На экране начало отчёта. Копирование сохраняет весь текст.")
        if(r is OfflineCanResult.Accepted)OutlinedButton(onClick={
            clipboard.setText(AnnotatedString(report))
        },modifier=Modifier.fillMaxWidth()) {Text("Копировать полный отчёт и кадры")}
    }
    Text("Фрагмент не доказывает исправность, происхождение или полноту журнала. Храните исходную запись отдельно.",style=MaterialTheme.typography.bodySmall)
}
