package ru.traksos.minidiagnostic

// Explicit manufacturer examples from ECUtalk and TIM G2. Display only.
object KnorrG2ExampleReference {
    const val SOURCE="https://8afjlxvy4piyx8zzzs6kqim.blob.core.windows.net/documents/EdJARuqtI0EBhB_Y136135-002-EN_WEB.pdf#page=2"
    const val TIM_SOURCE="https://www.krakerparts.eu/uploads/pdf/Handleiding%20Knorr%20%28Tim%20G2%29.pdf#page=9"
    private val rows=mapOf(
        "001200" to DisplayLookup("Датчик скорости колеса S-C",
            "Замыкание цепи на массу. Проверить проводку, разъёмы и датчик на повреждения и попадание влаги согласно руководству.",
            SOURCE+" · Y136135, 2019, пример Demo Mode",true),
        "000D00" to DisplayLookup("Датчик скорости колеса S-C",
            "Обрыв цепи или замыкание на плюс питания. Точный вид повреждения требует проверки датчика и проводки.",
            TIM_SOURCE+" · Y054277 EN Rev.002, май 2022, пример TIM G2",true)
    )
    fun lookup(code:String):DisplayLookup? = rows[code]
    val count get()=rows.size
}
