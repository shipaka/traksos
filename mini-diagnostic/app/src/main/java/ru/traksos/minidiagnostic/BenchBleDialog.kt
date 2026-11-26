package ru.traksos.minidiagnostic

import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

@Composable
fun BenchBleDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    var status by remember { mutableStateOf("Подключите только ESP32 к USB, без прицепа и силовой платы.") }
    val probe = remember { BenchBleProbe(context) { status = it } }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (probe.permitted()) probe.start() else status = "Доступ к Bluetooth не предоставлен"
    }
    DisposableEffect(probe) {
        val lifecycle = (context as? ComponentActivity)?.lifecycle
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                probe.stop()
                status = "Проверка остановлена"
            }
        }
        lifecycle?.addObserver(observer)
        onDispose {
            lifecycle?.removeObserver(observer)
            probe.stop()
        }
    }
    AlertDialog(onDismissRequest = { probe.stop(); onDismiss() },
        title = { Text("Проверка Bluetooth") },
        text = { Text(status + "\n\nПроверка версии и обмена виртуальными командами. Не управляет физическим освещением или EBS.") },
        confirmButton = {
            TextButton(onClick = {
                if (probe.permitted()) probe.start() else permissionLauncher.launch(BenchBleProbe.permissions())
            }) { Text("Найти ESP32") }
        },
        dismissButton = { TextButton(onClick = { probe.stop(); onDismiss() }) { Text("Закрыть") } })
}
