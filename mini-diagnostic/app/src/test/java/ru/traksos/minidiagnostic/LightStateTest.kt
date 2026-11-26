package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class LightStateTest {
    @Test fun hazardsUseExactlyTwoChannels() {
        val s = LightState().toggle(Channel.STOP).turn(Turn.BOTH)
        assertEquals(setOf(Channel.LEFT,Channel.RIGHT,Channel.STOP),s.displayedOutputs(0))
        assertEquals(setOf(Channel.STOP),s.displayedOutputs(334))
        assertEquals(s.enabled,s.displayedOutputs(667))
    }
    @Test fun tripIsLatchedAndResetDoesNotEnergize() {
        val s = LightState().bothSides().trip(Channel.LEFT_SIDE)
        assertEquals(setOf(Channel.RIGHT_SIDE),s.enabled)
        assertEquals(s,s.toggle(Channel.LEFT_SIDE))
        val reset = s.resetFault(Channel.LEFT_SIDE)
        assertFalse(Channel.LEFT_SIDE in reset.enabled)
        assertTrue(reset.faults.isEmpty())
    }
    @Test fun offPreservesFaults() {
        val s = LightState().turn(Turn.BOTH).trip(Channel.FOG).allOff()
        assertTrue(s.enabled.isEmpty())
        assertEquals(setOf(Channel.FOG),s.faults)
    }
    @Test fun pinMappingUnique() {
        assertEquals(7,Channel.entries.map { it.gpio }.toSet().size)
        assertEquals(setOf(1,2,3,5,6,7,8),Channel.entries.map { it.isoPin }.toSet())
    }
}
