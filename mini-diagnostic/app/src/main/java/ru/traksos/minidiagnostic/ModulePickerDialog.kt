package ru.traksos.minidiagnostic

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

// Verified manufacturer pages are optional references, not part identification.
// Only an explicitly mapped model-specific local image may be shown as a photo.
// No Internet permission or remote image loading is added to the bench app.
private val modelPhotoSources=mapOf(
    "zf-tebs-e" to "https://www.wabco-customercentre.com/catalog/en_GB/4801020300",
    "zf-tebs-c" to "https://www.wabco-customercentre.com/catalog/sv_SE/4801020000",
    "kb-itebs-x" to "https://newsroom.knorr-bremse.com/en/successful-launch-knorr-bremse-rolls-out-latest-generation-of-itebs-x-electronic-trailer-braking-system/",
    "haldex-eb3" to "https://www.haldex.com/en/europe/brands/haldex/ebs/eb_gen1_to_gen3/",
    "haldex-eb4" to "https://www.haldex.com/en/europe/brands/haldex/ebs/eb_4.0"
)
@Composable
fun ModulePickerDialog(currentId:String?,onSelect:(String?)->Unit,onClose:()->Unit) {
    var query by remember { mutableStateOf("") }
    var manufacturer by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<ResearchTarget?>(null) }
    val context=LocalContext.current
    val all=remember(query) { ModuleSearch.find(query) }
    val visible=all.filter { manufacturer==null || it.maker==manufacturer }.let {
        if(query.isBlank()) TrailerDiagnosticScope.prioritized(it) else it
    }
    fun back() {
        if(selected!=null) selected=null
        else if(manufacturer!=null || query.isNotBlank()) { manufacturer=null; query="" }
        else onClose()
    }
    Dialog(onDismissRequest={ back() },properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxSize().systemBarsPadding(),color=MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                    TextButton(onClick={ back() }) { Text("‹ Назад") }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick=onClose) { Text("Закрыть") }
                }
                Text(if(selected!=null) "Модулятор" else if(manufacturer==null) "Ручной поиск" else manufacturer.orEmpty(),
                    fontSize=25.sp,fontWeight=FontWeight.Bold)
                val item=selected
                if(item!=null) {
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                        ModelPhoto(item,Modifier.fillMaxWidth().height(190.dp))
                        Text(item.maker,fontSize=14.sp,color=MaterialTheme.colorScheme.primary)
                        Text(item.model,fontSize=23.sp,fontWeight=FontWeight.Bold)
                        modelPhotoSources[item.id]?.let { url ->
                            OutlinedButton(onClick={
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url))) }
                            },modifier=Modifier.fillMaxWidth()) { Text("Фото в каталоге производителя") }
                        }
                        Text("Сверьте маркировку на корпусе. Внешнее сходство не подтверждает поколение или совместимость.",
                            fontSize=13.sp)
                        if(item.scope==ScopeGroup.FUTURE_MARKET)
                            Text("Другой рынок или интерфейс; подключение не предусмотрено.",color=MaterialTheme.colorScheme.error,fontSize=13.sp)
                        Text("Демонстрационный выбор · реальная связь не подтверждена",fontSize=12.sp,color=MaterialTheme.colorScheme.primary)
                    }
                    Button(onClick={ onSelect(item.id) },modifier=Modifier.fillMaxWidth().heightIn(min=54.dp)) {
                        Text("Выбрать "+item.model,fontWeight=FontWeight.Bold)
                    }
                } else {
                    OutlinedTextField(value=query,onValueChange={ query=it.take(80); manufacturer=null },
                        modifier=Modifier.fillMaxWidth(),singleLine=true,label={ Text("Модель или номер детали") })
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                        if(query.isBlank() && manufacturer==null) {
                            Text("Выберите производителя",fontSize=14.sp)
                            CoverageRoadmap.targets.map { it.maker }.distinct().forEach { maker ->
                                Card(Modifier.fillMaxWidth().clickable { manufacturer=maker },shape=RoundedCornerShape(14.dp)) {
                                    Row(Modifier.fillMaxWidth().padding(18.dp),verticalAlignment=Alignment.CenterVertically) {
                                        Text(maker,fontSize=17.sp,fontWeight=FontWeight.Bold,modifier=Modifier.weight(1f))
                                        Text("›",fontSize=25.sp,color=MaterialTheme.colorScheme.primary)
                                    }
                                }
                            }
                        } else {
                            if(query.isNotBlank()) Text("Найдено: "+visible.size,fontSize=13.sp)
                            else Text("Выберите поколение или модель",fontSize=14.sp)
                            visible.forEach { row ->
                                Card(Modifier.fillMaxWidth().clickable { selected=row },shape=RoundedCornerShape(14.dp)) {
                                    Row(Modifier.fillMaxWidth().padding(10.dp),verticalAlignment=Alignment.CenterVertically,
                                        horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                                        ModelPhoto(row,Modifier.width(104.dp).height(74.dp))
                                        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)) {
                                            Text(row.model,fontWeight=FontWeight.Bold,fontSize=16.sp)
                                            Text(row.maker,fontSize=12.sp)
                                            if(row.id==currentId) Text("Выбран",color=MaterialTheme.colorScheme.primary,fontSize=12.sp)
                                            if(row.scope==ScopeGroup.FUTURE_MARKET) Text("Другой рынок",fontSize=11.sp)
                                        }
                                        Text("›",fontSize=23.sp,color=MaterialTheme.colorScheme.primary)
                                    }
                                }
                            }
                            if(visible.isEmpty()) Text("Нет совпадений. Проверьте название или номер детали.")
                            if(CatalogModuleParts.targetIds(query).size>1)
                                Text("Номер встречается в нескольких семействах; уточните маркировку.",fontSize=12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ModelPhoto(item:ResearchTarget,modifier:Modifier) {
    val context=LocalContext.current
    // Release-approved exact model photos are bundled in drawable-nodpi with this naming convention.
    val resource=remember(item.id) {
        context.resources.getIdentifier("module_"+item.id.replace('-','_'),"drawable",context.packageName)
    }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant,RoundedCornerShape(10.dp)).padding(6.dp),
        contentAlignment=Alignment.Center) {
        if(resource!=0) Image(painterResource(resource),item.model,Modifier.fillMaxSize(),contentScale=ContentScale.Fit)
        else Text("Фото\nне добавлено",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign=androidx.compose.ui.text.style.TextAlign.Center)
    }
}
