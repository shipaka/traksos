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
fun DiagnosticGuideDialog(onClose:()->Unit) {
    var selected by remember { mutableStateOf<ConnectionPlace?>(null) }
    var showChecks by remember { mutableStateOf(false) }
    val entry=selected?.let(DiagnosticGuide::entry)
    AlertDialog(
        onDismissRequest=onClose,
        title={ Text("Как подключить диагностику") },
        text={
            Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState()),
                verticalArrangement=Arrangement.spacedBy(10.dp)) {
                if(entry==null) {
                    Text("Выберите место подключения. Справка работает без интернета и не активирует прибор.")
                    Text("Пока доступен только стендовый деморежим.",color=MaterialTheme.colorScheme.error)
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
            if(entry!=null) TextButton(onClick={ selected=null; showChecks=false }) { Text("Назад") }
        })
}
