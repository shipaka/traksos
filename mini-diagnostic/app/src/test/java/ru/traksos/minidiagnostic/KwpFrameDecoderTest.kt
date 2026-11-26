package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class KwpFrameDecoderTest {
    // Synthetic frame helper, test code only; arbitrary test addresses and bytes.
    private fun frame(vararg raw:Int):ByteArray =
        (raw.toList()+ (raw.sum() and 255)).map { it.toByte() }.toByteArray()
    private fun parse(bytes:ByteArray)=KwpFrameDecoder.decode(bytes)
    @Test fun shortHeadersAndAddressDirection() {
        val physical=parse(frame(0x82,0x12,0x34,0x55,0x66)) as KwpFrameResult.Frame
        assertEquals(KwpAddressMode.PHYSICAL,physical.mode)
        assertEquals(listOf(0x55,0x66),physical.payload)
        assertTrue(KwpResponseAddress.matches(physical,0x12,0x34))
        assertFalse(KwpResponseAddress.matches(physical,0x34,0x12))
        val functional=parse(frame(0xC1,0x12,0x34,0x55)) as KwpFrameResult.Frame
        assertEquals(KwpAddressMode.FUNCTIONAL,functional.mode)
        assertFalse(KwpResponseAddress.matches(functional,0x12,0x34))
        val unaddressed=parse(frame(0x01,0x55)) as KwpFrameResult.Frame
        assertNull(unaddressed.source)
        assertNull(unaddressed.target)
        assertFalse(KwpResponseAddress.matches(unaddressed,0x12,0x34))
    }
    @Test fun extraLengthAndMaximumSize() {
        val short=parse(frame(0x80,0x12,0x34,1,0x55)) as KwpFrameResult.Frame
        assertTrue(short.separateLength)
        assertEquals(listOf(0x55),short.payload)
        val longRaw=intArrayOf(0x80,0x12,0x34,255)+IntArray(255){it}
        val bytes=frame(*longRaw)
        assertEquals(260,bytes.size)
        assertEquals(255,(parse(bytes) as KwpFrameResult.Frame).payload.size)
        assertTrue((parse(frame(0,1,0x55)) as KwpFrameResult.Frame).separateLength)
    }
    @Test fun rejectBadFramesWithoutResynchronizing() {
        val good=frame(0x82,0x12,0x34,0x55,0x66)
        assertEquals(KwpFrameResult.Rejected("CHECKSUM"),parse(good.clone().apply { this[lastIndex]=(this[lastIndex].toInt() xor 1).toByte() }))
        assertTrue(parse(good+byteArrayOf(0)) is KwpFrameResult.Rejected)
        assertTrue(parse(good.copyOf(good.size-1)) is KwpFrameResult.Rejected)
        assertEquals(KwpFrameResult.Rejected("ZERO_PAYLOAD"),parse(frame(0,0)))
        assertEquals(KwpFrameResult.Rejected("UNSUPPORTED_CARB_HEADER"),parse(frame(0x41,0x55)))
        assertTrue(parse(ByteArray(261)) is KwpFrameResult.Rejected)
        assertTrue(parse(byteArrayOf()) is KwpFrameResult.Rejected)
    }
}
