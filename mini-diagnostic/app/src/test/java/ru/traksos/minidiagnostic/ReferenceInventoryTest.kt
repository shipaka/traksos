package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class ReferenceInventoryTest {
    @Test fun actualMapsCountedOncePerEdition() {
        val rows=ReferenceInventory.counts()
        assertEquals(rows.size,rows.map { it.group }.distinct().size)
        assertTrue(rows.all { it.entries>0 })
        assertEquals(871,ReferenceInventory.total())
    }
}
