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

// Read-only, foreground, explicitly initiated bench check. No GATT write operations.
@SuppressLint("MissingPermission")
class BenchBleProbe(context: Context, private val onStatus: (String) -> Unit) {
    private val app = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val manager = app.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val serviceId = UUID.fromString(BenchCapabilities.SERVICE)
    private val characteristicId = UUID.fromString(BenchCapabilities.CHARACTERISTIC)
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
                if (status == BluetoothGatt.GATT_SUCCESS && ch.uuid == characteristicId &&
                    ch.service.uuid == serviceId && BenchCapabilities.isCompatible(value))
                    finish("BLE: стендовый протокол v1 прочитан. Силовые выходы и CAN отключены.")
                else finish("Версия или формат ответа не поддерживается")
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
