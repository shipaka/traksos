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
    var history by remember { mutableStateOf(emptyList<String>()) }
    var scan by remember { mutableIntStateOf(0) }
    var scanning by remember { mutableStateOf(false) }
    var historyOpen by remember { mutableStateOf(false) }
    var detail by remember { mutableIntStateOf(-1) }
    var bleProbeOpen by remember { mutableStateOf(false) }

    fun now() = SystemClock.elapsedRealtime() - session.startedAt
    fun apply(desired: LightState) {
        val reply = session.setLights(desired.enabled, now())
        state = reply.state
        message = if (reply.code == ResultCode.OK) "" else "Команда отклонена: ${reply.code}"
    }
    fun off() { state = session.allOff(now()).state }
    LaunchedEffect(Unit) {
        // Read local report index asynchronously. No artificial delay or network connection.
        history = withContext(Dispatchers.IO) {
            prefs.getString("reports", "").orEmpty().split("\n").filter { it.isNotBlank() }.take(50)
        }
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
    LaunchedEffect(scanning) {
        if (scanning) {
            // Explicitly demo-only scan. Never submits CAN requests.
            for (i in 1..20) { delay(90); scan = i * 5 }
            history = (listOf(java.text.DateFormat.getDateTimeInstance().format(java.util.Date()) +
                " · Демо · 2 примера ошибок") + history).take(50)
            prefs.edit().putString("reports", history.joinToString("\n")).apply()
            scanning = false
        }
    }
    if (!ready) {
        Splash()
        return
    }
    if (bleProbeOpen) BenchBleDialog { bleProbeOpen = false }
    Column(Modifier.fillMaxSize().systemBarsPadding()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Brand(if (tab == 0) "Проверка освещения" else "Диагностика прицепа")
            Row(Modifier.fillMaxWidth().border(1.dp, if(state.connected) Green else Line, RoundedCornerShape(10.dp))
                .clickable { off(); scanning = false; if (scan < 100) scan = 0; bleProbeOpen = true }
                .padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (state.connected) "● Виртуальный адаптер" else "○ Демо отключено",
                    color = if(state.connected) Green else Muted, modifier = Modifier.weight(1f), fontSize = 13.sp)
                Text("24 В · ДЕМО", color = Orange, fontWeight = FontWeight.Bold, fontSize = 12.sp)
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
                            glow = active && (mode != Turn.BOTH || Channel.LEFT in outputs)) {
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
                Text("Боковые фонари и подсветка номера — вместе с габаритами. Схема расположения условная.", color = Muted, fontSize = 11.sp)
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
                Box(Modifier.fillMaxWidth().height(148.dp).clip(RoundedCornerShape(14.dp))) {
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
                        if(scanning) {
                            Text(when { scan < 25 -> "Подключение симулятора"; scan < 60 -> "Идентификация (демо)"; else -> "Чтение примеров ошибок" })
                            LinearProgressIndicator(progress = { scan / 100f },modifier = Modifier.fillMaxWidth(),color = Orange)
                            Text("$scan% · демонстрационный прогресс",color = Muted,fontSize = 12.sp)
                            OutlinedButton(onClick = { scanning = false; scan = 0 }) { Text("Отменить") }
                        } else {
                            if(scan == 100) {
                                Text("Демо завершено · 2 примера ошибок",fontWeight = FontWeight.Bold)
                                DemoFault("Колесный датчик C","Пример: обрыв цепи · активная",Red,detail == 0) { detail = if(detail == 0) -1 else 0 }
                                DemoFault("Колесный датчик D","Пример: отсутствие сигнала · сохранённая",Orange,detail == 1) { detail = if(detail == 1) -1 else 1 }
                                Text("Это не результат проверки реального прицепа.",color = Muted,fontSize = 11.sp)
                            }
                            Button(onClick = { scan = 0; detail = -1; scanning = true },
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                Text(if(scan == 100) "Повторить демо" else "Начать демо-диагностику",fontWeight = FontWeight.Bold)
                            }
                            OutlinedButton(onClick = {},enabled = false,modifier = Modifier.fillMaxWidth()) { Text("Очистить ошибки после ремонта") }
                            Text("Очистка недоступна: протокол реального ЭБУ не подтверждён.",color = Muted,fontSize = 11.sp)
                        }
                    }
                }
                OutlinedButton(onClick = { historyOpen = !historyOpen },modifier = Modifier.fillMaxWidth()) {
                    Text(if(historyOpen) "Скрыть историю" else "История диагностики")
                }
                if(historyOpen) {
                    if(history.isEmpty()) Text("Пока нет отчётов",color = Muted)
                    else history.forEach { Text(it,modifier = Modifier.fillMaxWidth().padding(5.dp),fontSize = 12.sp) }
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
    // Single fixed illustration. Local lamp darkening overlays only; never animate position or the full image.
    Box(Modifier.fillMaxWidth().aspectRatio(600f/319f).clip(RoundedCornerShape(12.dp))) {
        Image(painterResource(R.drawable.lighting_art),"Иллюстрация расположения фонарей",Modifier.fillMaxSize(),contentScale = ContentScale.FillBounds)
        Canvas(Modifier.fillMaxSize()) {
            fun shade(ch: Channel,x:Float,y:Float,rx:Float,ry:Float) {
                if(ch in outputs) return
                val c = Offset(size.width*x,size.height*y)
                val r = maxOf(size.width*rx,size.height*ry)
                drawCircle(Brush.radialGradient(listOf(Color(0xED15191C),Color(0xB515191C),Color.Transparent),center=c,radius=r),r,c)
            }
            shade(Channel.LEFT,.375f,.638f,.048f,.055f)
            shade(Channel.RIGHT,.705f,.638f,.048f,.055f)
            shade(Channel.STOP,.395f,.711f,.043f,.047f)
            shade(Channel.STOP,.695f,.711f,.043f,.047f)
            shade(Channel.FOG,.48f,.755f,.028f,.034f)
            shade(Channel.REVERSE,.61f,.75f,.029f,.034f)
            listOf(.18f to .505f,.218f to .48f,.26f to .448f,.30f to .421f,.32f to .39f,.323f to .105f).forEach { (x,y) ->
                shade(Channel.LEFT_SIDE,x,y,.016f,.026f)
            }
            // Right flank is hidden in the approved rear three-quarter view; the right channel state is shown by its tile.
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
