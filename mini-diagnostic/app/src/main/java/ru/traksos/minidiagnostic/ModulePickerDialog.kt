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
fun ModulePickerDialog(currentId:String?,onSelect:(String?)->Unit,onClose:()->Unit) {
    var query by remember { mutableStateOf("") }
    var manufacturer by remember { mutableStateOf<String?>(null) }
    val all=remember(query) { ModuleSearch.find(query) }
    val visible=all.filter { manufacturer==null || it.maker==manufacturer }
    AlertDialog(onDismissRequest=onClose,title={ Text("Выбор модулятора") },text={
        Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Button(onClick={ onSelect(null) },modifier=Modifier.fillMaxWidth()) { Text("Автоматический поиск"+if(currentId==null) " ✓" else "") }
            Text("Или выберите по надписи на корпусе. Номер детали для выбора семейства не обязателен.",fontSize=12.sp)
            OutlinedTextField(value=query,onValueChange={ query=it.take(80); manufacturer=null },
                modifier=Modifier.fillMaxWidth(),singleLine=true,label={ Text("Например TEBS E, ТЭПСЕ, SORL") })
            if(query.isBlank()) {
                Text("Производитель",fontWeight=FontWeight.Bold)
                if(manufacturer==null) {
                    CoverageRoadmap.targets.map { it.maker }.distinct().forEach { maker ->
                        OutlinedButton(onClick={ manufacturer=maker },modifier=Modifier.fillMaxWidth()) { Text(maker) }
                    }
                } else {
                    OutlinedButton(onClick={ manufacturer=null },modifier=Modifier.fillMaxWidth()) { Text("Все производители · "+manufacturer) }
                }
            }
            if(query.isNotBlank() || manufacturer!=null) {
                Text("Найдено: ${visible.size}",fontSize=12.sp)
                visible.forEach { row ->
                    OutlinedButton(onClick={ onSelect(row.id) },modifier=Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(vertical=4.dp)) {
                            Text((if(row.id==currentId) "✓ " else "")+row.maker+" · "+row.model,fontWeight=FontWeight.Bold)
                            Text(when(row.stage) {
                                ResearchStage.DISPLAY_REFERENCE_PARTIAL -> "Есть частичный справочник"
                                ResearchStage.SYSTEM_DOCUMENTED -> "Есть сведения о системе"
                                ResearchStage.CANDIDATE -> "Требуется документация"
                            },fontSize=11.sp)
                        }
                    }
                }
                if(visible.isEmpty()) Text("Нет совпадений. Проверьте надпись либо выберите производителя вручную.")
            }
            Text("Ручной выбор не подтверждает точную ревизию, кабель или протокол. Реальная диагностика пока не активирована.",
                color=MaterialTheme.colorScheme.error,fontSize=12.sp)
        }
    },confirmButton={ TextButton(onClick=onClose){Text("Закрыть")} })
}
