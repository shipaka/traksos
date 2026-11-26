package ru.traksos.minidiagnostic

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun DisplayReferenceContent() {
    var edition by remember { mutableStateOf<DisplayReferenceEdition?>(null) }
    var code by remember { mutableStateOf("") }
    Text("Ручная расшифровка",fontWeight=FontWeight.Bold)
    Text("Выберите точное семейство и редакцию справочника. Вводите только отображаемый код; это не чтение ECU и не проверка исправности.")
    DisplayReferenceEdition.entries.forEach { e ->
        OutlinedButton(onClick={ edition=e; code="" },modifier=Modifier.fillMaxWidth()) {
            Text((if(edition==e) "✓ " else "")+e.title)
        }
    }
    edition?.let { e ->
        val vie=e==DisplayReferenceEdition.VIE_101
        OutlinedTextField(value=code,onValueChange={ code=it.take(16) },modifier=Modifier.fillMaxWidth(),
            label={ Text(if(vie) "Например 5/5" else "Например 003/05") },singleLine=true)
        val r=DisplayReferenceLookup.find(e,code)
        if(code.isNotBlank()) {
            if(r==null) Text("Совпадение не найдено. Не переносите коды из другой системы.",color=MaterialTheme.colorScheme.error)
            else {
                Text(r.component ?: "Компонент не найден",fontWeight=FontWeight.Bold)
                Text(r.condition ?: "Тип неисправности не найден")
                if(!r.exactPair) Text("Компонент и тип — отдельные справочные поля. Сочетание не подтверждено как конкретная неисправность.")
                Text(r.source.orEmpty(),style=MaterialTheme.typography.bodySmall)
                Text("Сверьте руководство именно вашего блока; статус ошибки неизвестен. Не заменяйте детали и не допускайте прицеп к эксплуатации по одному коду.")
            }
        }
    }
}
