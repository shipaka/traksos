package ru.traksos.minidiagnostic

enum class Channel(val isoPin: Int, val gpio: Int, val title: String) {
    LEFT(1,25,"Левый поворот"), RIGHT(2,26,"Правый поворот"),
    FOG(3,27,"Противотуманка"), LEFT_SIDE(5,32,"Левый габарит"),
    RIGHT_SIDE(6,33,"Правый габарит"), STOP(7,18,"Стоп-сигналы"),
    REVERSE(8,19,"Задний ход")
}
enum class Turn { OFF, LEFT, BOTH, RIGHT }
data class LightState(
    val enabled: Set<Channel> = emptySet(),
    val faults: Set<Channel> = emptySet()
) {
    fun toggle(channel: Channel): LightState =
        if (channel in faults) this else copy(enabled = if (channel in enabled) enabled - channel else enabled + channel)
    fun turn(mode: Turn): LightState {
        val requested = when(mode) {
            Turn.OFF -> emptySet()
            Turn.LEFT -> setOf(Channel.LEFT)
            Turn.RIGHT -> setOf(Channel.RIGHT)
            Turn.BOTH -> setOf(Channel.LEFT, Channel.RIGHT)
        }
        return copy(enabled = (enabled - Channel.LEFT - Channel.RIGHT) + (requested - faults))
    }
    fun bothSides(): LightState {
        val sides = setOf(Channel.LEFT_SIDE, Channel.RIGHT_SIDE)
        return copy(enabled = if (enabled.containsAll(sides)) enabled - sides else enabled + (sides - faults))
    }
    fun trip(channel: Channel): LightState = copy(enabled = enabled - channel, faults = faults + channel)
    fun resetFault(channel: Channel): LightState = copy(enabled = enabled - channel, faults = faults - channel)
    fun allOff(): LightState = copy(enabled = emptySet())
    // Only for the demo display. Real timing and protection belong to the adapter.
    fun displayedOutputs(elapsedMs: Long): Set<Channel> {
        val on = elapsedMs.mod(667L) < 333L
        return if (on) enabled else enabled - Channel.LEFT - Channel.RIGHT
    }
}
