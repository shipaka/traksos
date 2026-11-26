package ru.traksos.minidiagnostic

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { Surface { DiagnosticScreen() } } }
    }
}

@Composable
private fun DiagnosticScreen() {
    val session = remember { DemoSession(startedAt = android.os.SystemClock.elapsedRealtime()) }
    var state by remember { mutableStateOf(session.connect(0)) }
    val lights = state.lights
    var message by remember { mutableStateOf("") }
    fun apply(desired: LightState) {
        val reply = session.setLights(desired.enabled, elapsedNow(session))
        state = reply.state
        message = if (reply.code == ResultCode.OK) "" else "Команда отклонена: ${reply.code}"
    }
    fun off() {
        state = session.allOff(elapsedNow(session)).state
    }
    var tab by remember { mutableIntStateOf(0) }
    var elapsed by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        var lastHeartbeat = 0L
        while (true) {
            elapsed = elapsedNow(session)
            if (state.connected && elapsed - lastHeartbeat >= 500) {
                state = session.heartbeat(elapsed).state
                lastHeartbeat = elapsed
            } else state = session.advance(elapsed)
            delay(40)
        }
    }
    val outputs = lights.displayedOutputs(elapsed)
    Column(Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("TrakSOS Mini Diagnostic", style = MaterialTheme.typography.headlineSmall)
        Text("ДЕМОРЕЖИМ — оборудование не подключено", color = MaterialTheme.colorScheme.error)
        Text(if (state.connected) "Виртуальный адаптер: подключён" else "Виртуальный адаптер: отключён")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { state = if (state.connected) session.disconnect() else session.connect(elapsedNow(session)); message = "" }) {
                Text(if (state.connected) "Разорвать связь" else "Подключить демо")
            }
        }
        if (message.isNotEmpty()) Text(message, color = MaterialTheme.colorScheme.error)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { tab = 0 }) { Text("Свет") }
            Button(onClick = { off(); tab = 1 }) { Text("ABS / EBS") }
        }
        if (tab == 0) {
            Text("Поворотники", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf(Turn.LEFT to "←", Turn.BOTH to "↔", Turn.RIGHT to "→").forEach { (mode, label) ->
                    val requested = when(mode) {
                        Turn.LEFT -> setOf(Channel.LEFT)
                        Turn.RIGHT -> setOf(Channel.RIGHT)
                        Turn.BOTH -> setOf(Channel.LEFT,Channel.RIGHT)
                        Turn.OFF -> emptySet()
                    }
                    val selected = lights.enabled.intersect(setOf(Channel.LEFT,Channel.RIGHT)) == requested
                    if (selected) Button(onClick = { apply(lights.turn(Turn.OFF)) }, modifier = Modifier.weight(1f)) { Text(label) }
                    else OutlinedButton(onClick = { apply(lights.turn(mode)) }, modifier = Modifier.weight(1f)) { Text(label) }
                }
            }
            Text("Габариты", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                OutlinedButton(onClick = { apply(lights.toggle(Channel.LEFT_SIDE)) }, modifier = Modifier.weight(1f)) { Text("Левый") }
                OutlinedButton(onClick = { apply(lights.bothSides()) }, modifier = Modifier.weight(1f)) { Text("Оба") }
                OutlinedButton(onClick = { apply(lights.toggle(Channel.RIGHT_SIDE)) }, modifier = Modifier.weight(1f)) { Text("Правый") }
            }
            listOf(Channel.STOP,Channel.REVERSE,Channel.FOG).forEach { ch ->
                OutlinedButton(onClick = { apply(lights.toggle(ch)) }, modifier = Modifier.fillMaxWidth()) {
                    Text(ch.title + if (ch in lights.enabled) " · ВКЛ" else " · ВЫКЛ")
                }
            }
            HorizontalDivider()
            Text("Состояние симулятора", style = MaterialTheme.typography.titleMedium)
            Channel.entries.forEach { ch ->
                Text(ch.title + ": " + when {
                    ch in lights.faults -> "защита сработала"
                    ch in outputs -> "включён"
                    ch in lights.enabled -> "пауза мигания"
                    else -> "выключен"
                })
            }
            OutlinedButton(onClick = { state = session.trip(Channel.LEFT_SIDE) }) { Text("Демо: КЗ левого габарита") }
            OutlinedButton(onClick = { state = session.resetFault(Channel.LEFT_SIDE, elapsedNow(session)).state }) { Text("Демо: сброс защиты после ремонта") }
            Button(onClick = { off() }, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text("Выключить всё") }
        } else {
            Text("Диагностика тормозной системы", style = MaterialTheme.typography.titleMedium)
            Text("Нет связи с модулятором. Реальные протоколы ещё не подтверждены.")
            Text("WABCO TEBS E / D · Knorr-Bremse G2 · VIE · Haldex")
            Button(onClick = {}, enabled = false) { Text("Считать ошибки") }
            OutlinedButton(onClick = {}, enabled = false) { Text("Очистить сохранённые ошибки") }
            Text("Отсутствие ошибок после очистки не подтверждает исправность тормозов.")
        }
    }
}

private fun elapsedNow(session: DemoSession): Long = android.os.SystemClock.elapsedRealtime() - session.startedAt
