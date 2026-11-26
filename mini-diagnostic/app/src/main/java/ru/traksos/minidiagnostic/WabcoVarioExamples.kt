package ru.traksos.minidiagnostic

// Only the two individually described examples in the training text.
// Other candidate rows are kept in research data, not compiled into the APK.
object WabcoVarioExamples {
    const val SOURCE="https://studylib.net/doc/18267640/trailer-abs-training---inform.wabco"
    private val rows=mapOf(
        "1/3" to ("Датчик колеса B" to "Нарушение зазора"),
        "2/3" to ("Датчик колеса E" to "Обрыв проводки")
    )
    fun lookup(code:String)=rows[code]
    val count get()=rows.size
}
