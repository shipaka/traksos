package ru.traksos.minidiagnostic

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import java.util.UUID

// Foreground, explicitly initiated USB-only bench check. Writes only to the simulated bench service.
@SuppressLint("MissingPermission")
class BenchBleProbe(context: Context, private val onStatus: (String) -> Unit) {
    private val app = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val manager = app.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val serviceId = UUID.fromString(BenchCapabilities.SERVICE)
    private val characteristicId = UUID.fromString(BenchCapabilities.CHARACTERISTIC)
    private var step = 0
    private var roundTrip = false
    private var scanner: BluetoothLeScanner? = null
    private var scanCallback: ScanCallback? = null
    private var gatt: BluetoothGatt? = null
    private var epoch = 0L

    companion object {
        fun permissions(): Array<String> = if (Build.VERSION.SDK_INT >= 31)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    fun permitted() = permissions().all { app.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    fun stop() {
        epoch++
        step = 0
        roundTrip = false
        handler.removeCallbacksAndMessages(null)
        stopScan()
        val connection = gatt
        gatt = null
        if (connection != null) {
            runCatching { connection.disconnect() }
            runCatching { connection.close() }
        }
    }
    private fun stopScan() {
        val cb = scanCallback
        val s = scanner
        scanCallback = null
        scanner = null
        if (cb != null) runCatching { s?.stopScan(cb) }
    }
    private fun finish(status: String) {
        stop()
        onStatus(status)
    }
    fun start() {
        stop()
        if (!permitted()) { onStatus("Нет разрешения Bluetooth"); return }
        val token = epoch
        try {
            val adapter = manager?.adapter
            if (adapter == null || !adapter.isEnabled) {
                onStatus("Включите Bluetooth и повторите"); return
            }
            val s = adapter.bluetoothLeScanner
            if (s == null) { onStatus("BLE недоступен"); return }
            scanner = s
            val cb = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    handler.post {
                        if (token != epoch || scanCallback !== this) return@post
                        stopScan()
                        connect(result.device, token)
                    }
                }
                override fun onScanFailed(errorCode: Int) {
                    handler.post { if (token == epoch) finish("Поиск BLE не выполнен: $errorCode") }
                }
            }
            scanCallback = cb
            onStatus("Поиск стендовой ESP32…")
            s.startScan(listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(serviceId)).build()),
                ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),cb)
            handler.postDelayed({ if (token == epoch) finish("Адаптер не найден или не ответил") },15000)
        } catch (_: SecurityException) { finish("Разрешение Bluetooth отозвано") }
        catch (_: Exception) { finish("Не удалось запустить BLE") }
    }
    private fun connect(device: BluetoothDevice, token: Long) {
        onStatus("Устройство найдено. Чтение версии…")
        val cb = object : BluetoothGattCallback() {
            private fun post(g: BluetoothGatt, action: () -> Unit) {
                handler.post {
                    if (token != epoch || gatt !== g) return@post
                    try { action() } catch (_: Exception) { finish("Ошибка BLE-соединения") }
                }
            }
            override fun onConnectionStateChange(g: BluetoothGatt,status: Int,newState: Int) = post(g) {
                if (status != BluetoothGatt.GATT_SUCCESS || newState == BluetoothProfile.STATE_DISCONNECTED)
                    finish("BLE-соединение прервано ($status)")
                else if (newState == BluetoothProfile.STATE_CONNECTED && !g.discoverServices())
                    finish("Не удалось запросить службы")
            }
            override fun onServicesDiscovered(g: BluetoothGatt,status: Int) = post(g) {
                val ch = g.getService(serviceId)?.getCharacteristic(characteristicId)
                if (status != BluetoothGatt.GATT_SUCCESS || ch == null ||
                    ch.properties and BluetoothGattCharacteristic.PROPERTY_READ == 0 || !g.readCharacteristic(ch))
                    finish("Стендовый протокол не найден")
            }

            private fun received(g: BluetoothGatt,ch: BluetoothGattCharacteristic,value: ByteArray,status: Int) = post(g) {
                if (status != BluetoothGatt.GATT_SUCCESS || ch.service.uuid != serviceId) {
                    finish("Ошибка чтения BLE"); return@post
                }
                if (ch.uuid == characteristicId && !roundTrip) {
                    when {
                        BenchCapabilities.isRoundTrip(value) -> {
                            roundTrip = true
                            step = 0
                            sendStep(g)
                        }
                        BenchCapabilities.isCompatible(value) -> finish("BLE v1.0 прочитан. Для проверки обмена нужна прошивка v1.1.")
                        else -> finish("Версия или формат ответа не поддерживается")
                    }
                } else if (ch.uuid == UUID.fromString(BenchCapabilities.REPLY) && roundTrip) {
                    if (!BenchRoundTrip.matches(step,value)) {
                        finish("Ответ ESP32 не соответствует тесту ${step+1}"); return@post
                    }
                    step++
                    if (step == BenchRoundTrip.requests.size)
                        finish("BLE: двусторонний тест пройден. Все виртуальные выходы выключены; CAN и GPIO не используются.")
                    else sendStep(g)
                } else finish("Неожиданный ответ BLE")
            }
            @Suppress("DEPRECATION")
            private fun sendStep(g: BluetoothGatt) {
                val command = g.getService(serviceId)?.getCharacteristic(UUID.fromString(BenchCapabilities.COMMAND))
                if (command == null || command.properties and BluetoothGattCharacteristic.PROPERTY_WRITE == 0) {
                    finish("Стендовый канал команд не найден"); return
                }
                val bytes = AdapterProtocol.encode(BenchRoundTrip.requests[step])
                onStatus("Проверка виртуального обмена: ${step+1}/${BenchRoundTrip.requests.size}")
                val started = if (Build.VERSION.SDK_INT >= 33)
                    g.writeCharacteristic(command,bytes,BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
                else {
                    command.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                    command.value = bytes
                    g.writeCharacteristic(command)
                }
                if (!started) finish("Не удалось записать тестовую команду")
            }
            override fun onCharacteristicWrite(g: BluetoothGatt,ch: BluetoothGattCharacteristic,status: Int) = post(g) {
                if (!roundTrip || ch.uuid != UUID.fromString(BenchCapabilities.COMMAND) ||
                    ch.service.uuid != serviceId || status != BluetoothGatt.GATT_SUCCESS) {
                    finish("Ошибка тестовой записи BLE"); return@post
                }
                val response = g.getService(serviceId)?.getCharacteristic(UUID.fromString(BenchCapabilities.REPLY))
                if (response == null || response.properties and BluetoothGattCharacteristic.PROPERTY_READ == 0 ||
                    !g.readCharacteristic(response)) finish("Не удалось прочитать ответ ESP32")
            }
            @Deprecated("Legacy Android callback")
            override fun onCharacteristicRead(g: BluetoothGatt,ch: BluetoothGattCharacteristic,status: Int) {
                received(g,ch,ch.value?.clone() ?: byteArrayOf(),status)
            }
            override fun onCharacteristicRead(g: BluetoothGatt,ch: BluetoothGattCharacteristic,value: ByteArray,status: Int) {
                received(g,ch,value.clone(),status)
            }
        }
        try {
            gatt = device.connectGatt(app,false,cb,BluetoothDevice.TRANSPORT_LE)
            if (gatt == null) finish("Не удалось соединиться")
        } catch (_: Exception) { finish("Не удалось соединиться") }
    }
}
