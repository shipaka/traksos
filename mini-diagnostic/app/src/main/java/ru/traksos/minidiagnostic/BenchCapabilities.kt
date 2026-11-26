package ru.traksos.minidiagnostic

// USB-only bench capabilities. This is not device authentication or output authorization.
object BenchCapabilities {
    const val SERVICE = "7e625a10-5721-4cde-a84b-9e5fd1287410"
    const val CHARACTERISTIC = "7e625a11-5721-4cde-a84b-9e5fd1287410"
    const val COMMAND = "7e625a12-5721-4cde-a84b-9e5fd1287410"
    const val REPLY = "7e625a13-5721-4cde-a84b-9e5fd1287410"
    private val legacy = byteArrayOf(0x54,0x53,0x4D,0x44,1,0,1,0)
    private val duplex = byteArrayOf(0x54,0x53,0x4D,0x44,1,1,3,0)
    fun isCompatible(bytes: ByteArray): Boolean = bytes.contentEquals(legacy)
    fun isRoundTrip(bytes: ByteArray): Boolean = bytes.contentEquals(duplex)
}
