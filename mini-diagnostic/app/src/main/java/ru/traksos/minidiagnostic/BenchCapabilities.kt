package ru.traksos.minidiagnostic

// Read-only bench handshake. This does NOT authenticate a device or authorize electrical outputs.
object BenchCapabilities {
    const val SERVICE = "7e625a10-5721-4cde-a84b-9e5fd1287410"
    const val CHARACTERISTIC = "7e625a11-5721-4cde-a84b-9e5fd1287410"
    private val expected = byteArrayOf(0x54,0x53,0x4D,0x44,1,0,1,0)
    fun isCompatible(bytes: ByteArray): Boolean = bytes.contentEquals(expected)
}
