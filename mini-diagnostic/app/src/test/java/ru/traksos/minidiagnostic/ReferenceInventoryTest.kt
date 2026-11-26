package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class ReferenceInventoryTest {
    @Test fun actualMapsCountedOncePerEdition() {
        val rows=ReferenceInventory.counts()
        assertEquals(rows.size,rows.map { it.group }.distinct().size)
        assertTrue(rows.all { it.entries>0 })
        assertEquals(731,ReferenceInventory.total())
        assertEquals(listOf(168,125,41,72,73,71,125,52,4),rows.map { it.entries })
        assertEquals(293,rows.take(2).sumOf { it.entries })
        assertEquals(438,rows.drop(2).sumOf { it.entries })
    }
}
