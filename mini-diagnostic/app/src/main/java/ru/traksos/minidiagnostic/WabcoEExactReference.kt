package ru.traksos.minidiagnostic

// Explicit pair from WABCO SmartBoard OEM document, not raw wire mapping.
object WabcoEExactReference {
    const val SOURCE="https://www.wabco-customercentre.com/catalog/docs/8150101363.pdf#page=50"
    fun lookup(code:String):DisplayLookup? = if(code=="002/05")
        DisplayLookup("Датчик скорости колеса B","Обрыв питающей цепи датчика",SOURCE,true) else null
    val count get()=1
}
