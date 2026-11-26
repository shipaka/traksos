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
        val placeholder=when(e) {
            DisplayReferenceEdition.VIE_101 -> "Например 5/5"
            DisplayReferenceEdition.HALDEX_MODAL_MODULAR -> "Например 05, 91 или CF"
            DisplayReferenceEdition.HALDEX_UABS_ACTIVE -> "Две цифры, например 01"
            DisplayReferenceEdition.KNORR_TEBS4 -> "Десятичный код, например 137"
            DisplayReferenceEdition.KNORR_KB4TA -> "Две группы, например 2/4"
            DisplayReferenceEdition.BENDIX_TABS6 -> "Две группы, например 2/4"
            DisplayReferenceEdition.SORL_ABS -> "Например 3.1"
            DisplayReferenceEdition.EKRAN_EBP -> "Две группы, например 1/3"
            DisplayReferenceEdition.VCS_I_EXPERT -> "Две группы, например 3/5"
            DisplayReferenceEdition.WABCO_COMPACT_TESTER -> "Три символа, например 411"
            DisplayReferenceEdition.VCS_II_FLASH -> "Число вспышек, например 3"
            DisplayReferenceEdition.HALDEX_GEN2_INFO1, DisplayReferenceEdition.HALDEX_GEN3_INFO1 -> "Например S1A CONT"
            else -> "Например 003/05"
        }
        OutlinedTextField(value=code,onValueChange={ code=it.take(64) },modifier=Modifier.fillMaxWidth(),
            label={ Text(placeholder) },singleLine=true)
        val r=DisplayReferenceLookup.find(e,code)
        if(code.isNotBlank()) {
            if(r==null) Text("Совпадение не найдено. Не переносите коды из другой системы.",color=MaterialTheme.colorScheme.error)
            else {
                Text(r.component ?: "Компонент не найден",fontWeight=FontWeight.Bold)
                Text(r.condition ?: "Тип неисправности не найден")
                if(!r.exactPair) Text("Справочная информация ограничена указанными полями; точная причина неисправности не установлена.")
                Text(r.source.orEmpty(),style=MaterialTheme.typography.bodySmall)
                Text("Сверьте руководство именно вашего блока; ручной ввод не подтверждает текущее состояние системы. Не заменяйте детали и не допускайте прицеп к эксплуатации по одному коду.")
            }
        }
    }
}
