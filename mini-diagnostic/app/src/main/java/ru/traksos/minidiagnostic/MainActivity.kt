package ru.traksos.minidiagnostic

import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val Orange = Color(0xFFFF8B23)
private val Graphite = Color(0xFF11171E)
private val Panel = Color(0xFF202830)
private val Line = Color(0xFF3E4955)
private val Muted = Color(0xFFB2BCC7)
private val Red = Color(0xFFFF6262)
private val Green = Color(0xFF68D5A0)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Orange, background = Graphite,
                surface = Panel, onSurface = Color.White, onBackground = Color.White, error = Red)) {
                Surface(color = Graphite, modifier = Modifier.fillMaxSize()) { MiniApp() }
            }
        }
    }
}

@Composable
private fun Brand(subtitle: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Image(painterResource(R.drawable.traksos_logo), "TrakSOS", Modifier.weight(1f).height(38.dp),
            contentScale = ContentScale.Fit)
        Column(Modifier.weight(1f)) {
            Text("Mini Diagnostic", fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text(subtitle, color = Muted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun MiniApp() {
    val context = androidx.compose.ui.platform.LocalContext.current
    var ready by remember { mutableStateOf(false) }
    val session = remember { DemoSession(startedAt = SystemClock.elapsedRealtime()) }
    var state by remember { mutableStateOf(session.connect(0)) }
    var tab by remember { mutableIntStateOf(0) }
    var elapsed by remember { mutableLongStateOf(0L) }
    var message by remember { mutableStateOf("") }
    val prefs = remember { context.getSharedPreferences("mini_demo_history", 0) }
    var history by remember { mutableStateOf(emptyList<DemoReport>()) }
    var legacyHistory by remember { mutableStateOf(emptyList<String>()) }
    var currentReport by remember { mutableStateOf<DemoReport?>(null) }
    var openedReport by remember { mutableStateOf<DemoReport?>(null) }
    var openedLegacy by remember { mutableStateOf<String?>(null) }
    var scan by remember { mutableIntStateOf(0) }
    var scanning by remember { mutableStateOf(false) }
    var historyOpen by remember { mutableStateOf(false) }
    var detail by remember { mutableIntStateOf(-1) }
    var bleProbeOpen by remember { mutableStateOf(false) }
    var connectionGuideOpen by remember { mutableStateOf(false) }
    var modulePickerOpen by remember { mutableStateOf(false) }
    var manualTargetId by remember { mutableStateOf<String?>(null) }
    var electricalCase by remember { mutableStateOf(DemoElectricalCase.NO_MEASUREMENT) }
    val electrical=DemoElectricalPreview.snapshot(state.connected,electricalCase)
    var electricalExpanded by remember { mutableStateOf(false) }

    fun now() = SystemClock.elapsedRealtime() - session.startedAt
    fun apply(desired: LightState) {
        val reply = session.setLights(desired.enabled, now())
        state = reply.state
        message = if (reply.code == ResultCode.OK) "" else "Команда отклонена: ${reply.code}"
    }
    fun off() { state = session.allOff(now()).state }
    LaunchedEffect(Unit) {
        // Read local report index asynchronously. No artificial delay or network connection.
        val saved = withContext(Dispatchers.IO) {
            DemoReportCodec.decode(prefs.getString("reports_v2", "").orEmpty()) to
                prefs.getString("reports", "").orEmpty().split("\n").filter { it.isNotBlank() }.take(50)
        }
        history=saved.first; legacyHistory=saved.second
        ready = true
        var last = 0L
        while (true) {
            elapsed = now()
            if (state.connected && elapsed - last >= 500) {
                state = session.heartbeat(elapsed).state
                last = elapsed
            } else state = session.advance(elapsed)
            delay(40)
        }
    }
    LaunchedEffect(scanning,state.connected,electricalCase) {
        if (scanning && !electrical.canRunDemo) { scanning=false; scan=0; detail=-1 }
        else if (scanning) {
            // Explicitly demo-only scan. Never submits CAN requests.
            for (i in 1..20) { delay(90); scan = i * 5 }
            val report=DemoReports.make(java.util.UUID.randomUUID().toString(),System.currentTimeMillis(),manualTargetId,electrical)
            currentReport=report
            history=(listOf(report)+history).take(50)
            prefs.edit().putString("reports_v2",DemoReportCodec.encode(history)).apply()
            scanning = false
        }
    }
    if (!ready) {
        Splash()
        return
    }
    openedReport?.let { report -> AlertDialog(onDismissRequest={ openedReport=null },title={ Text("Отчёт диагностики") },
        text={ Column(Modifier.heightIn(max=510.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            ReportContent(report)
        } },confirmButton={ TextButton(onClick={ openedReport=null }){ Text("Закрыть") } }) }
    openedLegacy?.let { old -> AlertDialog(onDismissRequest={ openedLegacy=null },title={ Text("Старая запись") },
        text={ Text(old+"\n\nВ прежней версии сохранялись только дата и количество ошибок. Коды и расшифровки восстановить невозможно.") },
        confirmButton={ TextButton(onClick={ openedLegacy=null }){ Text("Закрыть") } }) }
    if (bleProbeOpen) BenchBleDialog { bleProbeOpen = false }
    if (connectionGuideOpen) DiagnosticGuideDialog(manualTargetId) { connectionGuideOpen = false }
    if (modulePickerOpen) ModulePickerDialog(manualTargetId,
        onSelect={ manualTargetId=it; modulePickerOpen=false; scan=0; detail=-1 },
        onClose={ modulePickerOpen=false })
    Column(Modifier.fillMaxSize().systemBarsPadding()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Brand(if (tab == 0) "Проверка освещения" else "Диагностика прицепа")
            Row(Modifier.fillMaxWidth().border(1.dp, if(state.connected) Green else Line, RoundedCornerShape(10.dp))
                .clickable { off(); scanning = false; if (scan < 100) scan = 0; bleProbeOpen = true }
                .padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (state.connected) "● Виртуальный адаптер" else "○ Демо отключено",
                    color = if(state.connected) Green else Muted, modifier = Modifier.weight(1f), fontSize = 13.sp)
                Text("ДЕМО", color = Orange, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }
            if (tab == 0) {
                val lights = state.lights
                val outputs = lights.displayedOutputs(elapsed)
                TrailerLighting(outputs)
                if (lights.faults.isNotEmpty()) {
                    Text("Защита: " + lights.faults.joinToString { it.title }, color = Red)
                    OutlinedButton(onClick = {
                        lights.faults.forEach { state = session.resetFault(it,now()).state }
                    }, enabled = state.connected) { Text("Сброс после ремонта") }
                }
                Group("Поворотники") {
                    val turn = lights.enabled.intersect(setOf(Channel.LEFT,Channel.RIGHT))
                    listOf(Triple("←","Левый",Turn.LEFT),Triple("↔","Аварийка",Turn.BOTH),Triple("→","Правый",Turn.RIGHT)).forEach { (icon,label,mode) ->
                        val target = when(mode) { Turn.LEFT -> setOf(Channel.LEFT); Turn.RIGHT -> setOf(Channel.RIGHT); else -> setOf(Channel.LEFT,Channel.RIGHT) }
                        val active = turn == target
                        Tile(icon,label,active,state.connected,Modifier.weight(1f),
                            glow = active && (Channel.LEFT in outputs || Channel.RIGHT in outputs)) {
                            apply(lights.turn(if (active) Turn.OFF else mode))
                        }
                    }
                }
                Group("Габариты") {
                    Tile("◉","Левый борт",Channel.LEFT_SIDE in lights.enabled,state.connected,Modifier.weight(1f)) { apply(lights.toggle(Channel.LEFT_SIDE)) }
                    Tile("◉ ◉","Оба борта",lights.enabled.containsAll(setOf(Channel.LEFT_SIDE,Channel.RIGHT_SIDE)),state.connected,Modifier.weight(1f)) { apply(lights.bothSides()) }
                    Tile("◉","Правый борт",Channel.RIGHT_SIDE in lights.enabled,state.connected,Modifier.weight(1f)) { apply(lights.toggle(Channel.RIGHT_SIDE)) }
                }
                Group("Остальное освещение") {
                    listOf(Triple("⊙","Стоп",Channel.STOP),Triple("⇦","Задний ход",Channel.REVERSE),Triple("≋","Противотуманка",Channel.FOG)).forEach { (icon,label,ch) ->
                        Tile(icon,label,ch in lights.enabled,state.connected,Modifier.weight(1f)) { apply(lights.toggle(ch)) }
                    }
                }
                Text("Демонстрационная схема. Подсветка номера зависит от проводки прицепа.", color = Muted, fontSize = 11.sp)
                Button(onClick = { off() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC72D2D),contentColor = Color.White)) {
                    Text("⏻  Выключить всё", fontWeight = FontWeight.Bold, fontSize = 17.sp)
                }
                if (message.isNotEmpty()) Text(message,color = Red)
                Row(Modifier.fillMaxWidth(),horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedButton(onClick = { state = if(state.connected) session.disconnect() else session.connect(now()) },
                        modifier = Modifier.weight(1f)) { Text(if(state.connected) "Разорвать демо" else "Подключить демо",fontSize = 11.sp) }
                    OutlinedButton(onClick = { state = session.trip(Channel.LEFT_SIDE) }, enabled = state.connected,
                        modifier = Modifier.weight(1f)) { Text("Демо: КЗ",fontSize = 11.sp) }
                }
            } else {
                ElectricalStatusPanel(electrical,electricalCase,electricalExpanded,
                    onExpand={ electricalExpanded=!electricalExpanded },
                    onScenario={ next ->
                        scanning=false; scan=0; detail=-1; electricalCase=next
                    })
                Box(Modifier.fillMaxWidth().height(104.dp).clip(RoundedCornerShape(14.dp))) {
                    Image(painterResource(R.drawable.splash_truck), "Иллюстрация грузовика", Modifier.fillMaxSize(),contentScale = ContentScale.Crop)
                    Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color.Transparent,Graphite.copy(alpha=.92f)))))
                    Column(Modifier.align(Alignment.CenterEnd).padding(18.dp),horizontalAlignment = Alignment.CenterHorizontally) {
                        if (scanning) CircularProgressIndicator(color = Orange, modifier = Modifier.size(52.dp))
                        else Text(if(scan == 100) "⚠" else "◎",fontSize = 38.sp,color = if(scan == 100) Red else Orange)
                        Text("ABS / EBS",fontWeight = FontWeight.Bold)
                    }
                }
                Card(colors = CardDefaults.cardColors(containerColor = Panel)) {
                    Column(Modifier.padding(14.dp),verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Text("Диагностика системы тормозов",fontSize = 18.sp,fontWeight = FontWeight.Bold)
                        Text("ДЕМО — реальные модуляторы не подключены",color = Orange,fontSize = 12.sp)
                        val chosen = manualTargetId?.let(CoverageRoadmap::byId)
                        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            Button(onClick={
                                off(); manualTargetId=null; scan=0; detail=-1; scanning=true
                            },enabled=!scanning && electrical.canRunDemo,modifier=Modifier.weight(1f).heightIn(min=64.dp)) {
                                Column(horizontalAlignment=Alignment.CenterHorizontally) {
                                    Text("◎",fontSize=20.sp)
                                    Text("Автопоиск",fontSize=13.sp,fontWeight=FontWeight.Bold)
                                }
                            }
                            OutlinedButton(onClick={
                                off(); scanning=false; scan=0; detail=-1; modulePickerOpen=true
                            },modifier=Modifier.weight(1f).heightIn(min=64.dp)) {
                                Column(horizontalAlignment=Alignment.CenterHorizontally) {
                                    Text("⌕",fontSize=20.sp)
                                    Text("Ручной поиск",fontSize=13.sp,fontWeight=FontWeight.Bold)
                                }
                            }
                        }
                        if(chosen!=null) {
                            Text(chosen.maker+" · "+chosen.model,fontWeight=FontWeight.Bold)
                            Text("Выбрано вручную · ДЕМО",color=Muted,fontSize=11.sp)
                        }
                        if(scanning) {
                            Text(when { scan < 25 -> "Подключение симулятора"; scan < 60 -> "Идентификация (демо)"; else -> "Чтение примеров ошибок" })
                            LinearProgressIndicator(progress = { scan / 100f },modifier = Modifier.fillMaxWidth(),color = Orange)
                            Text("$scan% · демонстрационный прогресс",color = Muted,fontSize = 12.sp)
                            OutlinedButton(onClick = { scanning = false; scan = 0 }) { Text("Отменить") }
                        } else {
                            if(scan==100) currentReport?.let { ReportContent(it) }
                            if(chosen!=null || scan==100) Button(onClick = { scan = 0; detail = -1; scanning = true },enabled=electrical.canRunDemo,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                Text(if(scan == 100) "Повторить демо" else "Начать демо-диагностику",fontWeight = FontWeight.Bold)
                            }
                            if(scan==100) OutlinedButton(onClick = {},enabled = false,modifier = Modifier.fillMaxWidth()) { Text("Очистить ошибки (недоступно)") }
                        }
                    }
                }
                OutlinedButton(onClick = {
                    off()
                    scanning = false
                    if (scan < 100) scan = 0
                    connectionGuideOpen = true
                },modifier = Modifier.fillMaxWidth()) {
                    Text("Справка: как подключиться")
                }
                OutlinedButton(onClick = { historyOpen = !historyOpen },modifier = Modifier.fillMaxWidth()) {
                    Text(if(historyOpen) "Скрыть историю" else "История диагностики")
                }
                if(historyOpen) {
                    if(history.isEmpty() && legacyHistory.isEmpty()) Text("Пока нет отчётов",color = Muted)
                    history.forEach { report ->
                        Card(Modifier.fillMaxWidth().clickable { openedReport=report },colors=CardDefaults.cardColors(containerColor=Panel)) {
                            Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically) {
                                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)) {
                                    Text(report.maker+" · "+report.model,fontWeight=FontWeight.Bold)
                                    Text(reportDate(report.dateMs),fontSize=12.sp,color=Muted)
                                    Text("Демо · "+report.faults.size+" ошибок · "+report.faults.count{it.active}+" активных",fontSize=12.sp,color=Orange)
                                }
                                Text("›",fontSize=24.sp,color=Orange)
                            }
                        }
                    }
                    legacyHistory.forEach { old ->
                        OutlinedButton(onClick={ openedLegacy=old },modifier=Modifier.fillMaxWidth()) {
                            Text(old+" · старый формат",fontSize=12.sp)
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = Line)
        Row(Modifier.fillMaxWidth().background(Panel).padding(6.dp),horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NavTile("☼","Освещение",tab == 0,Modifier.weight(1f)) { if(tab != 0) { scanning = false; if(scan < 100) scan = 0; tab = 0 } }
            NavTile("◎","Диагностика",tab == 1,Modifier.weight(1f)) { if(tab != 1) { off(); tab = 1 } }
        }
    }
}

private fun reportDate(ms:Long)=java.text.DateFormat.getDateTimeInstance().format(java.util.Date(ms))

@Composable
private fun ReportContent(report:DemoReport) {
    Text("Найденный блок · ДЕМО",color=Orange,fontWeight=FontWeight.Bold,fontSize=12.sp)
    Text(report.maker+" · "+report.model,fontSize=20.sp,fontWeight=FontWeight.Bold)
    CoverageRoadmap.byId(report.targetId)?.let { ModelPhoto(it,Modifier.fillMaxWidth().height(110.dp)) }
    report.examplePart?.let { Text("Пример номера детали: "+it,fontSize=13.sp) }
    Text("Условный серийный номер: "+report.serial,fontSize=12.sp,color=Muted)
    Text(reportDate(report.dateMs)+" · "+(if(report.automatic) "Автопоиск" else "Ручной поиск"),fontSize=12.sp,color=Muted)
    Text("CAN: обмен в демо"+(report.canErrors?.let {" · ошибок CAN: "+it} ?: ""),fontSize=12.sp,color=Green)
    report.supplyMv?.let { Text("Напряжение в демо: "+(it/1000f)+" В",fontSize=12.sp) }
    report.minimumMv?.let { Text("Минимум: "+(it/1000f)+" В",fontSize=12.sp) }
    HorizontalDivider(color=Line)
    Text("Ошибки: "+report.faults.size,fontSize=17.sp,fontWeight=FontWeight.Bold)
    report.faults.forEach { fault ->
        Column(Modifier.fillMaxWidth().background(Graphite,RoundedCornerShape(10.dp)).padding(12.dp),
            verticalArrangement=Arrangement.spacedBy(5.dp)) {
            Text(fault.code,color=Orange,fontWeight=FontWeight.Bold,fontSize=15.sp)
            Text(fault.component,fontWeight=FontWeight.Bold,fontSize=15.sp)
            Text(if(fault.active) "Активная · ДЕМО" else "Сохранённая · ДЕМО",color=if(fault.active) Red else Muted,fontSize=12.sp)
            Text(fault.description,fontSize=13.sp)
            if(!fault.reference) Text("Условный код DEMO, не заводской DTC",color=Muted,fontSize=11.sp)
        }
    }
    Text("Симуляция, не результат проверки реального прицепа.",fontSize=11.sp,color=Muted)
}

@Composable
private fun ElectricalStatusPanel(status:ElectricalPreview,scenario:DemoElectricalCase,expanded:Boolean,
    onExpand:()->Unit,onScenario:(DemoElectricalCase)->Unit) {
    fun volts(mv:Int?):String=mv?.let { String.format(java.util.Locale.forLanguageTag("ru-RU"),"%.1f В",it/1000f) } ?: "—"
    val supplyColor=when {
        status.supplyMv==null -> Muted
        scenario==DemoElectricalCase.SAG || scenario==DemoElectricalCase.NO_POWER -> Red
        else -> Green
    }
    fun stateColor(value:Boolean?)=when(value) { true -> Green; false -> Red; null -> Muted }
    Card(colors=CardDefaults.cardColors(containerColor=Panel),shape=RoundedCornerShape(14.dp)) {
        Column(Modifier.fillMaxWidth().padding(12.dp),verticalArrangement=Arrangement.spacedBy(9.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Text(if(status.supplyMv==null) "Связь CAN" else "Питание и связь",fontSize=16.sp,fontWeight=FontWeight.Bold,modifier=Modifier.weight(1f))
                Text("ДЕМО",color=Orange,fontSize=11.sp,fontWeight=FontWeight.Bold)
            }
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                if(status.supplyMv!=null) ElectricalMetric("Питание",volts(status.supplyMv),supplyColor,Modifier.weight(1f))
                ElectricalMetric("CAN",when(status.canTraffic) { true -> "Обмен"; false -> "Нет обмена"; null -> "—" },
                    stateColor(status.canTraffic),Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                if(status.minimumMv!=null) Text("Мин. "+volts(status.minimumMv),color=supplyColor,fontSize=12.sp)
                Text("Ошибки CAN: "+(status.canErrors?.toString()?:"—"),color=Muted,fontSize=12.sp)
            }
            status.reason?.let { Text(it,color=Red,fontSize=12.sp,fontWeight=FontWeight.Bold) }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable(onClick=onExpand).padding(vertical=5.dp),
                verticalAlignment=Alignment.CenterVertically) {
                Text("Демо-сценарий: "+(if(scenario==DemoElectricalCase.NO_MEASUREMENT) "Нормальный обмен" else scenario.title),color=Orange,fontSize=12.sp,modifier=Modifier.weight(1f))
                Text(if(expanded) "▴" else "▾",color=Orange)
            }
            if(expanded) {
                for(option in listOf(DemoElectricalCase.NO_MEASUREMENT,DemoElectricalCase.NO_CAN)) {
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { onScenario(option) }.padding(5.dp),
                        verticalAlignment=Alignment.CenterVertically) {
                        RadioButton(selected=option==scenario,onClick={ onScenario(option) })
                        Text(if(option==DemoElectricalCase.NO_MEASUREMENT) "Нормальный обмен" else option.title,fontSize=13.sp)
                    }
                }
                Text("При отсутствии ответа проверить питание, массу и соединения. Прибор не измеряет массу отдельно и не определяет обрыв конкретного провода CAN.",
                    color=Muted,fontSize=11.sp)
            }
        }
    }
}
@Composable
private fun ElectricalMetric(label:String,value:String,color:Color,modifier:Modifier) {
    Column(modifier.background(Graphite,RoundedCornerShape(8.dp)).padding(horizontal=7.dp,vertical=8.dp),
        verticalArrangement=Arrangement.spacedBy(3.dp)) {
        Text(label,color=Muted,fontSize=11.sp)
        Text(value,color=color,fontSize=14.sp,fontWeight=FontWeight.Bold)
    }
}

@Composable
private fun Splash() {
    Box(Modifier.fillMaxSize()) {
        Image(painterResource(R.drawable.splash_truck), "TrakSOS",Modifier.fillMaxSize(),contentScale = ContentScale.Crop)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Graphite.copy(alpha=.95f),Color.Transparent,Graphite))))
        Column(Modifier.align(Alignment.TopCenter).padding(28.dp),horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(52.dp))
            Image(painterResource(R.drawable.traksos_logo),"TrakSOS",Modifier.fillMaxWidth().height(64.dp),contentScale = ContentScale.Fit)
            Text("Mini Диагностика",fontSize = 30.sp,fontWeight = FontWeight.Bold,color = Orange)
            Text("Диагностика прицепов и полуприцепов",textAlign = TextAlign.Center)
        }
        Column(Modifier.align(Alignment.BottomCenter).padding(36.dp),horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Orange)
            Spacer(Modifier.height(12.dp))
            Text("Запуск приложения…")
        }
    }
}

@Composable
private fun TrailerLighting(outputs: Set<Channel>) {
    // Neutral illustration drawn from independent segments, not masks over a lit photograph.
    // Each visible lamp is always present; only its light emission changes.
    @Composable fun level(ch:Channel)=animateFloatAsState(
        targetValue=if(ch in outputs) 1f else 0f,
        animationSpec=tween(120),label=ch.name).value
    val left=level(Channel.LEFT); val right=level(Channel.RIGHT)
    val ls=level(Channel.LEFT_SIDE); val rs=level(Channel.RIGHT_SIDE)
    val stop=level(Channel.STOP); val fog=level(Channel.FOG); val rev=level(Channel.REVERSE)
    val plate=maxOf(ls,rs)
    Column(Modifier.fillMaxWidth().background(Color(0xFF151D26),RoundedCornerShape(16.dp))
        .border(1.dp,Line,RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
            Text("ВИД СЗАДИ",color=Muted,fontSize=11.sp,fontWeight=FontWeight.Bold)
            Text(if(outputs.isEmpty()) "Свет выключен" else "Активные фонари",color=if(outputs.isEmpty()) Muted else Orange,fontSize=11.sp)
        }
        Canvas(Modifier.fillMaxWidth().aspectRatio(1.43f)) {
            fun point(x:Float,y:Float)=Offset(size.width*x,size.height*y)
            fun rect(x:Float,y:Float,w:Float,h:Float,c:Color,r:Float=.012f) {
                drawRoundRect(c,point(x,y),androidx.compose.ui.geometry.Size(size.width*w,size.height*h),
                    androidx.compose.ui.geometry.CornerRadius(size.width*r))
            }
            fun lamp(x:Float,y:Float,w:Float,h:Float,c:Color,a:Float) {
                rect(x,y,w,h,androidx.compose.ui.graphics.lerp(c.copy(alpha=.23f),c,a),.008f)
                if(a>0f) {
                    val center=point(x+w/2,y+h/2)
                    val radius=size.width*w*.85f
                    drawCircle(Brush.radialGradient(listOf(c.copy(alpha=.24f*a),Color.Transparent),center=center,radius=radius),radius,center)
                    rect(x+.008f,y+.005f,w-.016f,h-.010f,c.copy(alpha=.88f*a),.006f)
                }
            }
            // Door frame, hinges, metal door panels, tyres and bumper.
            rect(.19f,.035f,.62f,.67f,Color(0xFF84909C),.022f)
            rect(.206f,.055f,.588f,.627f,Color(0xFF37424D),.012f)
            rect(.219f,.073f,.274f,.59f,Color(0xFF56636E),.008f)
            rect(.507f,.073f,.274f,.59f,Color(0xFF56636E),.008f)
            for(x in listOf(.254f,.447f,.553f,.746f)) {
                rect(x,.085f,.012f,.56f,Color(0xFFABB5BE),.003f)
                for(y in listOf(.11f,.39f,.62f)) rect(x-.019f,y,.05f,.018f,Color(0xFF252F38),.003f)
            }
            rect(.46f,.48f,.08f,.019f,Color(0xFFD0D6DC),.003f)
            for(x in listOf(.205f,.685f)) {
                rect(x,.72f,.11f,.23f,Color(0xFF080B10),.02f)
                rect(x+.026f,.76f,.055f,.16f,Color(0xFF262D36),.012f)
            }
            rect(.155f,.697f,.69f,.17f,Color(0xFF343F49),.015f)
            for(x in listOf(.17f,.655f)) rect(x,.713f,.175f,.133f,Color(0xFF171D23),.012f)
            val amber=Color(0xFFFFA52B); val red=Color(0xFFFF4548); val white=Color(0xFFFFF2D6)
            // Left/right tail lamps, separate stop and indicator sections.
            lamp(.18f,.725f,.15f,.031f,amber,left)
            lamp(.67f,.725f,.15f,.031f,amber,right)
            lamp(.18f,.767f,.15f,.025f,red,ls*.76f)
            lamp(.67f,.767f,.15f,.025f,red,rs*.76f)
            lamp(.18f,.802f,.15f,.031f,red,stop)
            lamp(.67f,.802f,.15f,.031f,red,stop)
            // Central registration plate and independent number illumination.
            rect(.433f,.775f,.134f,.062f,androidx.compose.ui.graphics.lerp(Color(0xFF68717A),Color(0xFFFFF3C8),plate),.005f)
            lamp(.441f,.752f,.118f,.018f,white,plate)
            lamp(.352f,.798f,.065f,.038f,red,fog)
            lamp(.583f,.798f,.065f,.038f,white,rev)
            // Upper clearance lamps.
            lamp(.216f,.045f,.046f,.018f,red,ls)
            lamp(.738f,.045f,.046f,.018f,red,rs)
            // Red reflective tape remains reflective, not a light.
            for(x in listOf(.24f,.32f,.58f,.66f)) rect(x,.625f,.067f,.016f,Color(0xFF97494C),.001f)
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            SideMarkers("Левый борт",ls,Modifier.weight(1f))
            SideMarkers("Правый борт",rs,Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
            Text("Задние габариты",color=if(ls+rs>0f) Orange else Muted,fontSize=11.sp)
            Text("Подсветка номера",color=if(plate>0f) Orange else Muted,fontSize=11.sp)
        }
    }
}

@Composable
private fun SideMarkers(label:String,level:Float,modifier:Modifier) {
    Column(modifier.background(Graphite,RoundedCornerShape(9.dp)).padding(8.dp),verticalArrangement=Arrangement.spacedBy(5.dp)) {
        Text(label,color=if(level>0f) Orange else Muted,fontSize=11.sp)
        Canvas(Modifier.fillMaxWidth().height(15.dp)) {
            val c=androidx.compose.ui.graphics.lerp(Color(0xFF594733),Color(0xFFFFAD32),level)
            drawLine(Color(0xFF687582),Offset(0f,size.height/2),Offset(size.width,size.height/2),strokeWidth=2f)
            for(i in 0..4) drawCircle(c, size.height*.27f,Offset(size.width*(.1f+.2f*i),size.height/2))
        }
    }
}

@Composable
private fun Group(name:String,content:@Composable RowScope.()->Unit) {
    Column(Modifier.fillMaxWidth().background(Panel,RoundedCornerShape(12.dp)).border(1.dp,Line,RoundedCornerShape(12.dp)).padding(9.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(name,color=Color.White,fontWeight=FontWeight.Bold,fontSize=15.sp)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp),content=content)
    }
}

@Composable
private fun Tile(icon:String,label:String,active:Boolean,enabled:Boolean,modifier:Modifier=Modifier,glow:Boolean=active,onClick:()->Unit) {
    val edge = if(active) Orange.copy(alpha=if(glow) 1f else .55f) else Line
    val bg = if(active) Color(0xFF58351B).copy(alpha=if(glow) 1f else .65f) else Color(0xFF171E26)
    Column(modifier.heightIn(min=60.dp).clip(RoundedCornerShape(9.dp)).background(bg).border(1.dp,edge,RoundedCornerShape(9.dp))
        .clickable(enabled=enabled,onClick=onClick).padding(horizontal=3.dp,vertical=7.dp),
        horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center) {
        Text(icon,color=if(active) Orange else Muted,fontSize=21.sp,fontWeight=FontWeight.Bold)
        Text(label,color=if(enabled) Color.White else Muted,fontSize=11.sp,textAlign=TextAlign.Center,lineHeight=13.sp)
    }
}

@Composable
private fun NavTile(icon:String,label:String,active:Boolean,modifier:Modifier,onClick:()->Unit) {
    Column(modifier.heightIn(min=57.dp).clip(RoundedCornerShape(10.dp)).clickable(onClick=onClick).padding(5.dp),
        horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center) {
        Text(icon,fontSize=23.sp,color=if(active) Orange else Muted)
        Text(label,fontWeight=FontWeight.Bold,color=if(active) Orange else Muted,fontSize=13.sp)
        Spacer(Modifier.height(3.dp))
        Box(Modifier.width(65.dp).height(3.dp).background(if(active) Orange else Color.Transparent,RoundedCornerShape(3.dp)))
    }
}

@Composable
private fun DemoFault(title:String,description:String,color:Color,expanded:Boolean,onClick:()->Unit) {
    Column(Modifier.fillMaxWidth().border(1.dp,Line,RoundedCornerShape(8.dp)).clickable(onClick=onClick).padding(10.dp)) {
        Text("⚠  "+title,color=color,fontWeight=FontWeight.Bold)
        Text(description,fontSize=12.sp)
        if(expanded) Text("Демонстрационный пример. Для точной расшифровки нужны проверенный профиль ЭБУ и исходный код ошибки.",color=Muted,fontSize=12.sp)
    }
}
