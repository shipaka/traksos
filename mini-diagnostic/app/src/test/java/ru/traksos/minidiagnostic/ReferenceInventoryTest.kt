package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class ReferenceInventoryTest {
    @Test fun actualMapsCountedOncePerEdition() {
        val rows=ReferenceInventory.counts()
        assertEquals(rows.size,rows.map { it.group }.distinct().size)
        assertTrue(rows.all { it.entries>0 })
        assertEquals(727,ReferenceInventory.total())
        assertEquals(listOf(168,125,41,72,73,71,125,52),rows.map { it.entries })
        assertEquals(293,rows.take(2).sumOf { it.entries })
        assertEquals(434,rows.drop(2).sumOf { it.entries })
    }
}
