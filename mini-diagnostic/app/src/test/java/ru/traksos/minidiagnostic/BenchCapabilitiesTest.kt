package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class BenchCapabilitiesTest {
    @Test fun onlyExactBenchVersionAccepted() {
        val valid = byteArrayOf(0x54,0x53,0x4D,0x44,1,0,1,0)
        assertTrue(BenchCapabilities.isCompatible(valid))
        assertFalse(BenchCapabilities.isCompatible(valid.copyOf(7)))
        assertFalse(BenchCapabilities.isCompatible(valid.clone().apply { this[4]=2 }))
        assertFalse(BenchCapabilities.isCompatible(valid.clone().apply { this[6]=0 }))
        assertFalse(BenchCapabilities.isCompatible(valid.clone().apply { this[6]=3 }))
        assertFalse(BenchCapabilities.isCompatible(valid.clone().apply { this[7]=1 }))
    }
}
