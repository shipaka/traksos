package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class DiagnosticGuideTest {
    @Test fun allRoutesHaveWarningsAndNoUniversalPinout() {
        ConnectionPlace.entries.forEach {
            val e=DiagnosticGuide.entry(it)
            assertEquals(it,e.place)
            assertTrue(e.warning.isNotBlank())
            assertTrue(e.explanation.isNotBlank())
        }
        assertTrue(DiagnosticGuide.blocked.contains("не разрешено"))
    }
    @Test fun physicalPathsAreSeparated() {
        assertEquals(setOf(ElectricalPath.ISO11992),DiagnosticGuide.entry(ConnectionPlace.FRONT).possiblePaths)
        assertEquals(setOf(ElectricalPath.K_LINE,ElectricalPath.ISO11898),DiagnosticGuide.entry(ConnectionPlace.SIDE).possiblePaths)
        assertEquals(3,ElectricalPath.entries.size)
        assertTrue(DiagnosticGuide.entry(ConnectionPlace.UNKNOWN).possiblePaths.isEmpty())
        assertTrue(DiagnosticGuide.entry(ConnectionPlace.DIRECT).possiblePaths.contains(ElectricalPath.K_LINE))
    }
}
