package ru.traksos.minidiagnostic

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun DiagnosticGuideDialog(targetId:String?=null,onClose:()->Unit) {
    var selected by remember { mutableStateOf<ConnectionPlace?>(null) }
    var showChecks by remember { mutableStateOf(false) }
    var showCables by remember { mutableStateOf(false) }
    var showSystems by remember { mutableStateOf(false) }
    var showReference by remember { mutableStateOf(false) }
    var showImport by remember { mutableStateOf(false) }
    var showIdentity by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    val entry=selected?.let(DiagnosticGuide::entry)
    AlertDialog(
        onDismissRequest=onClose,
        title={ Text("Как подключить диагностику") },
        text={
            Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState()),
                verticalArrangement=Arrangement.spacedBy(10.dp)) {
                if(showIdentity) {
                    OfflineIdentityContent(targetId)
                } else if(showImport) {
                    OfflineCaptureContent(targetId)
                } else if(showReference) {
                    DisplayReferenceContent(targetId)
                } else if(showSystems) {
                    Text("Системы и поколения",fontWeight=FontWeight.Bold)
                    Text("Реестр разработки, не список поддержанных прибором блоков.",color=MaterialTheme.colorScheme.error)
                    OutlinedTextField(value=search,onValueChange={ search=it.take(80) },
                        label={ Text("Производитель или система") },singleLine=true,modifier=Modifier.fillMaxWidth())
                    val rows=ModuleSearch.find(search)
                    Text("Найдено: ${rows.size}",fontSize=12.sp)
                    rows.forEach { row ->
                        HorizontalDivider()
                        Text(row.maker+" · "+row.model,fontWeight=FontWeight.Bold)
                        Text(when(row.stage) {
                            ResearchStage.DISPLAY_REFERENCE_PARTIAL -> "Частичный справочник отображаемых кодов"
                            ResearchStage.SYSTEM_DOCUMENTED -> "Найдены сведения о системе"
                            ResearchStage.CANDIDATE -> "Кандидат: требуется дополнительная проверка"
                        },fontSize=12.sp)
                        Text("Реальное чтение и очистка не подтверждены.",color=MaterialTheme.colorScheme.error,fontSize=12.sp)
                    }
                } else if(showCables) {
                    Text("Реестр кабелей и интерфейсов",fontWeight=FontWeight.Bold)
                    Text("Исследовательский список. Ни один кабель пока не разрешён для работы нашим прибором.",color=MaterialTheme.colorScheme.error)
                    OutlinedTextField(value=search,onValueChange={ search=it.take(80) },
                        label={ Text("Производитель или модель") },singleLine=true,modifier=Modifier.fillMaxWidth())
                    val rows=CableResearch.search(search)
                    Text("Найдено: ${rows.size}",fontSize=12.sp)
                    rows.forEach { row ->
                        HorizontalDivider()
                        Text(row.name,fontWeight=FontWeight.Bold)
                        Text(row.place.title + " · " + (row.path?.title ?: "Интерфейс уточняется"),fontSize=12.sp)
                        Text(row.note)
                        Text("Не проверено на приборе",color=MaterialTheme.colorScheme.error,fontSize=12.sp)
                    }
                } else if(entry==null) {
                    Text("Выберите место подключения. Справка работает без интернета и не активирует прибор.")
                    Text("Пока доступен только стендовый деморежим.",color=MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick={ showCables=true; search="" },modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                        Text("Кабели по производителям")
                    }
                    OutlinedButton(onClick={ showSystems=true; search="" },modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                        Text("Системы и поколения")
                    }
                    OutlinedButton(onClick={ showReference=true },modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                        Text("Расшифровать код с дисплея")
                    }
                    OutlinedButton(onClick={ showImport=true },modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                        Text("Разобрать записанный ответ ЭБУ")
                    }
                    OutlinedButton(onClick={ showIdentity=true },modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                        Text("Разобрать идентификационные ответы ЭБУ")
                    }
                    ConnectionPlace.entries.forEach { place ->
                        OutlinedButton(onClick={ selected=place; showChecks=false },
                            modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text(place.title) }
                    }
                } else {
                    Text(entry.place.title,fontWeight=FontWeight.Bold,fontSize=17.sp)
                    Text(entry.explanation)
                    Text("Возможные интерфейсы",fontWeight=FontWeight.Bold)
                    Text(if(entry.possiblePaths.isEmpty()) "Не определены" else entry.possiblePaths.joinToString(" / ") { it.title })
                    Text(entry.examples)
                    Text("Внимание",fontWeight=FontWeight.Bold,color=MaterialTheme.colorScheme.error)
                    Text(entry.warning)
                    Text(DiagnosticGuide.blocked,fontWeight=FontWeight.Bold,color=MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick={ showChecks=!showChecks },modifier=Modifier.fillMaxWidth()) {
                        Text(if(showChecks) "Скрыть памятку" else "Что проверить перед подключением")
                    }
                    if(showChecks) {
                        DiagnosticGuide.checks.forEachIndexed { i,check -> Text("${i+1}. $check") }
                        Text("Памятка не заменяет проверенную электрическую схему и не разрешает подачу питания.")
                    }
                    if(entry.sources.isNotEmpty()) {
                        Text("Документация для сверки",fontWeight=FontWeight.Bold)
                        entry.sources.forEach { Text(it,fontSize=11.sp) }
                    }
                }
            }
        },
        confirmButton={ TextButton(onClick=onClose) { Text("Закрыть") } },
        dismissButton={
            if(entry!=null || showCables || showSystems || showReference || showImport || showIdentity) TextButton(onClick={ selected=null; showChecks=false; showCables=false; showSystems=false; showReference=false; showImport=false; showIdentity=false }) { Text("Назад") }
        })
}
