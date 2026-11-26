package ru.traksos.minidiagnostic

// Explicit OEM ECUtalk demonstration example. No inference of protocol, generation
// or physical ECU support. Available only in independent manual lookup.
object KnorrG2ExampleReference {
    const val SOURCE="https://8afjlxvy4piyx8zzzs6kqim.blob.core.windows.net/documents/EdJARuqtI0EBhB_Y136135-002-EN_WEB.pdf#page=2"
    private val rows=mapOf("001200" to ("Датчик скорости колеса S-C" to
        "Замыкание цепи на массу. Проверить проводку, разъёмы и датчик на повреждения и попадание влаги согласно руководству."))
    fun lookup(code:String):DisplayLookup? {
        val r=rows[code] ?: return null
        return DisplayLookup(r.first,r.second,SOURCE+" · Y136135, 2019, пример Demo Mode",true)
    }
    val count get()=rows.size
}
