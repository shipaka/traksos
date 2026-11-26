package ru.traksos.minidiagnostic

import java.util.Locale

// Offline bridge; does not auto-identify ECU or infer a protocol from bus traffic.
// Preserve original CAN log separately. This report carries no proof of physical origin.
class IsoTpUdsImport(private val capture:DiagnosticCapture=DiagnosticCapture()) {
    fun importResponse(metadata:CaptureMetadata,frames:List<IsoTpCapturedFrame>,
        expected:IsoTpAddress,maxGapNanos:Long):CaptureResult =
        when(val assembled=IsoTpOffline.assemble(frames,expected,maxGapNanos)) {
            is IsoTpResult.Rejected -> CaptureResult.Rejected("ISOTP_"+assembled.reason)
            is IsoTpResult.Complete -> capture.importHex(metadata,
                assembled.payload.joinToString("") { String.format(Locale.ROOT,"%02X",it) })
        }
}
