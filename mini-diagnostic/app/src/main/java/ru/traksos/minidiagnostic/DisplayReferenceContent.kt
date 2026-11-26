package ru.traksos.minidiagnostic

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun DisplayReferenceContent(targetId:String?=null) {
    val target=targetId?.let(CoverageRoadmap::byId)
    val suggested=ReferenceSelection.forTarget(targetId)
    var showAll by remember(targetId) { mutableStateOf(target==null) }
    var edition by remember(targetId) { mutableStateOf<DisplayReferenceEdition?>(null) }
    var code by remember { mutableStateOf("") }
    Text("Ручная расшифровка",fontWeight=FontWeight.Bold)
    Text("Выберите точное семейство и редакцию справочника. Вводите только отображаемый код; это не чтение ECU и не проверка исправности.")
    if(target!=null) {
        Text("Выбранный блок: "+target.maker+" · "+target.model,fontWeight=FontWeight.Bold)
        if(suggested.isEmpty()) Text("Для выбранного блока собственного справочника пока нет. Не используйте коды похожего поколения.",color=MaterialTheme.colorScheme.error)
        else Text("Доступные справочники выбранного семейства. Уточните редакцию по источнику кода.")
        OutlinedButton(onClick={ showAll=!showAll; edition=null; code="" },modifier=Modifier.fillMaxWidth()) {
            Text(if(showAll) "Только выбранное семейство" else "Все справочники")
        }
        if(showAll) Text("Другие справочники — только отдельный ручной поиск, не данные выбранного блока.")
    }
    val visible=if(showAll) DisplayReferenceEdition.entries else suggested
    visible.forEach { e ->
        OutlinedButton(onClick={ edition=e; code="" },modifier=Modifier.fillMaxWidth()) {
            Text((if(edition==e) "✓ " else "")+e.title)
        }
    }
    edition?.let { e ->
        if(target!=null && e !in suggested) Text("Выбран другой справочник. Результат не относится автоматически к выбранному модулятору.",color=MaterialTheme.colorScheme.error)
        if(e==DisplayReferenceEdition.HALDEX_UABS_INFO2) Text("Для полного набора функций Info Centre 2 производитель указывает ПО U-ABS A650 или новее. Это не подтверждение совместимости адаптера TrakSOS.")
        val placeholder=when(e) {
            DisplayReferenceEdition.HALDEX_UABS_INFO2 -> "Например Power Low Voltage"
            DisplayReferenceEdition.HALDEX_GEN3_DIAG -> "Например ECU shutdown FET"
            DisplayReferenceEdition.SORL_ABS_TESTER_36302900020 -> "Номер с текстом, например 3.1 Нет Д №1"
            DisplayReferenceEdition.VIE_101 -> "Например 5/5"
            DisplayReferenceEdition.HALDEX_MODAL_MODULAR -> "Например 05, 91 или CF"
            DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE -> "Например 0x01 или S1A continuity"
            DisplayReferenceEdition.HALDEX_SOFT_DOCKING_GEN3 -> "Например Sensor Error"
            DisplayReferenceEdition.HALDEX_CAN_HUB -> "Например Shutdown FET"
            DisplayReferenceEdition.WABCO_CD_BULLETIN -> "Например 077/03"
            DisplayReferenceEdition.WABCO_E_OEM_EXACT -> "Например 002/05"
            DisplayReferenceEdition.WABCO_CAN_ROUTER -> "Например 18312 или 7805"
            DisplayReferenceEdition.WABCO_ELEX -> "Например 1552-03 или 2483503"
            DisplayReferenceEdition.WABCO_E_HUMBAUR -> "Например 251/05"
            DisplayReferenceEdition.KNORR_G2_TD2077 -> "Шесть символов, например 002400"
            DisplayReferenceEdition.KNORR_G22_PRESSURE -> "Например 00ED00, 00F300 или 00F500"
            DisplayReferenceEdition.KNORR_G2_EXAMPLE -> "Шестизначный код ECUtalk, например 001200"
            DisplayReferenceEdition.KNORR_TEBS4 -> "Десятичный код, например 137"
            DisplayReferenceEdition.WABCO_COMPACT_TESTER -> "Три символа, например 411"
            DisplayReferenceEdition.HALDEX_GEN1_2005, DisplayReferenceEdition.HALDEX_GEN2_INFO1, DisplayReferenceEdition.HALDEX_GEN3_INFO1 -> "Например S1A CONT"
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
