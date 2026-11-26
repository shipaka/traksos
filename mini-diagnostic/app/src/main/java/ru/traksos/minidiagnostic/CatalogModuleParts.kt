package ru.traksos.minidiagnostic

// Published catalog associations only; not a diagnostic identity or permission to connect.
data class CatalogModulePart(val number:String,val targetId:String,val variant:String,val source:String)
object CatalogModuleParts {
    private val rows=listOf(
        // OEM replacement bulletin identifies original C part numbers; D replacements are not C identities.
        CatalogModulePart("4801020000","zf-tebs-c","TEBS C · EBS/BVA","https://www.wabco-customercentre.com/catalog/docs/doc_000130_en.pdf"),
        CatalogModulePart("4801020010","zf-tebs-c","TEBS C · EBS/BVA, Battery","https://www.wabco-customercentre.com/catalog/docs/doc_000130_en.pdf"),
        CatalogModulePart("4801020020","zf-tebs-c","TEBS C · EBS/Trailer Central Electronic","https://www.wabco-customercentre.com/catalog/docs/doc_000130_en.pdf"),
        CatalogModulePart("4801020040","zf-tebs-c","TEBS C · EBS/RSS/BVA","https://www.wabco-customercentre.com/catalog/docs/doc_000130_en.pdf"),
        CatalogModulePart("4801020050","zf-tebs-c","TEBS C · EBS/Trailer Central Electronic/RSS","https://www.wabco-customercentre.com/catalog/docs/doc_000130_en.pdf"),
        CatalogModulePart("K019300","kb-g20","Premium · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019302","kb-g20","Premium · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019309","kb-g20","Premium · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019340","kb-g20","Standard · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019342","kb-g20","Standard · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019349","kb-g20","Standard · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019310","kb-g21","Premium · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019312","kb-g21","Premium · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019319","kb-g21","Premium · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019350","kb-g21","Standard · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019352","kb-g21","Standard · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K019359","kb-g21","Standard · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("ES2060","kb-g20","Тип G2.0/G2.1 · поколение неоднозначно","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("ES2060","kb-g21","Тип G2.0/G2.1 · поколение неоднозначно","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K055332","kb-g22","Standard Plus · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K055372","kb-g22","Standard Plus · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K055379","kb-g22","Standard Plus · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K110612","kb-g22","Premium · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K110619","kb-g22","Premium · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("ES2095","kb-g22","Premium · тип блока","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/j3HA9rYqI0EBhB_Y142784-013-EN_WEB.pdf#page=2"),
        CatalogModulePart("K055342","kb-g22","Standard 2S/2M · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/OYLAJ4o5I0EBhB_Y136107-007-EN-WEB3.pdf#page=4"),
        CatalogModulePart("K055352","kb-g22","Standard 2S/2M · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/OYLAJ4o5I0EBhB_Y136107-007-EN-WEB3.pdf#page=4"),
        CatalogModulePart("K055362","kb-g22","Standard 2S/2M · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/OYLAJ4o5I0EBhB_Y136107-007-EN-WEB3.pdf#page=4"),
        CatalogModulePart("K055369","kb-g22","Standard 2S/2M · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/OYLAJ4o5I0EBhB_Y136107-007-EN-WEB3.pdf#page=4"),
        CatalogModulePart("ES2090","kb-g22","Standard / Standard Plus · обозначение типа","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/OYLAJ4o5I0EBhB_Y136107-007-EN-WEB3.pdf#page=4"),
        CatalogModulePart("4801020300","zf-tebs-e","TEBS E · 24 В без PEM","https://www.wabco-customercentre.com/catalog/en_US/4801020300"),
        CatalogModulePart("4801020320","zf-tebs-e","TEBS E · 24 В без PEM","https://www.wabco-customercentre.com/catalog/en_US/4801020320"),
        CatalogModulePart("4801020620","zf-tebs-e","TEBS E · Premium без PEM","https://www.wabco-customercentre.com/catalog/en_US/4801020620"),
        CatalogModulePart("4801020800","zf-tebs-e","TEBS E · Multivoltage без PEM","https://www.wabco-customercentre.com/catalog/en_US/4801020800"),
        CatalogModulePart("364564001","haldex-uabs","Premium · модулятор в сборе; CAN по документации","https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=8"),
        CatalogModulePart("364569001","haldex-uabs","Premium · отдельный ЭБУ; CAN по документации","https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=8"),
        CatalogModulePart("364565001","haldex-uabs","Standard · модулятор в сборе; CAN по документации","https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=8"),
        CatalogModulePart("364570001","haldex-uabs","Standard · отдельный ЭБУ; CAN по документации","https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=8"),
        CatalogModulePart("364566001","haldex-uabs","Basic · модулятор в сборе; электронной CAN-диагностики нет","https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=8"),
        CatalogModulePart("364571001","haldex-uabs","Basic · отдельный ЭБУ; электронной CAN-диагностики нет","https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=8"),
        CatalogModulePart("950364824","haldex-uabs","Premium · комплект замены ЭБУ, не номер установленного блока","https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=74"),
        CatalogModulePart("950364825","haldex-uabs","Standard · комплект замены ЭБУ, не номер установленного блока","https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=74"),
        CatalogModulePart("950364826","haldex-uabs","Basic · комплект замены ЭБУ; электронной CAN-диагностики нет","https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=74"),
        CatalogModulePart("820011001","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820011101","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820011111","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820011121","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820011131","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820019001","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-019-xxx/"),
        CatalogModulePart("820019101","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-019-xxx/"),
        CatalogModulePart("820019111","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-019-xxx/"),
        CatalogModulePart("820019121","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-019-xxx/"),
        CatalogModulePart("820008001","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820008101","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820008111","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820008121","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820008131","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820007001","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007101","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007111","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007121","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007131","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007141","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007151","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007161","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007171","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007181","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820026001","haldex-eb2","2M master в системе 3M","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/"),
        CatalogModulePart("810011001","haldex-eb2","Ведомый узел 3M; также встречается в Gen1","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/"),
        CatalogModulePart("812011001","haldex-eb2","Ведомый узел 3M; также встречается в Gen1","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/"),
        CatalogModulePart("4801021050","zf-iebs","Basic Steel","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801022010","zf-iebs","Basic Air","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801022020","zf-iebs","Basic Air","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801022030","zf-iebs","Basic Air","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023010","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023020","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023030","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023050","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023110","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023120","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023130","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023150","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024010","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024020","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024030","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024050","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024110","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024120","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024130","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024150","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("942013001","haldex-eb4","Premium+ 2M","https://www.haldex.com/en/eu/ebs-system/eb-system/942013001/"),
        CatalogModulePart("842005001","haldex-eb4","Basic 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842005011","haldex-eb4","Basic 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842006001","haldex-eb4","Basic 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842015001","haldex-eb4","Basic+ 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842015011","haldex-eb4","Basic+ 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842001001","haldex-eb4","Basic 2M с OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842001011","haldex-eb4","Basic 2M с OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842002001","haldex-eb4","Basic 2M с OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842011001","haldex-eb4","Basic+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842011121","haldex-eb4","Basic+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842011811","haldex-eb4","Basic+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842011401","haldex-eb4","Basic+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842003001","haldex-eb4","Premium 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842003011","haldex-eb4","Premium 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842004001","haldex-eb4","Premium 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842013001","haldex-eb4","Premium+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842013011","haldex-eb4","Premium+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842013131","haldex-eb4","Premium+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942015001","haldex-eb4","Basic+ 2M AM без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942011001","haldex-eb4","Basic+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942011121","haldex-eb4","Basic+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942011811","haldex-eb4","Basic+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942011401","haldex-eb4","Basic+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942013131","haldex-eb4","Premium+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("841001001","haldex-eb4","Ведомый модулятор 1M, не основной ECU","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("823034001","haldex-eb3","Master 2M в системе 3M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("810023001","haldex-eb3","Ведомый модулятор 1M, не основной ECU","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("K211213","kb-itebs-x","ECO · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("K211212","kb-itebs-x","PLUS · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("K211211","kb-itebs-x","LAC · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("K267862","kb-itebs-x","IAM ECO / PLUS · вариант не определён","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("K267861","kb-itebs-x","IAM LAC","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("ES2031","kb-itebs-x","ECO · тип блока","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("ES2033","kb-itebs-x","PLUS · тип блока","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("ES2035","kb-itebs-x","LAC · тип блока","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("4801020630","vie-tebs","ТСР · CAN 24 только при подтверждённой ревизии","https://vbsauto.ru/wp-content/uploads/2025/10/TEBS_%D0%A2%D0%A1%D0%90.pdf"),
        CatalogModulePart("4801020630","vie-tebs-subsystem","ТСР · SUBSYSTEM; наличие CAN 24 не установлено по номеру","https://vbsauto.ru/wp-content/uploads/2025/10/TEBS_%D0%A2%D0%A1%D0%90.pdf"),
        CatalogModulePart("4801020630","zf-tebs-e","WABCO Premium с PEM · отдельно сверить марку","https://www.wabco-customercentre.com/catalog/en_GB/4801020630"),
        CatalogModulePart("4801020640","vie-tebs","ТСР · CAN 24 только при подтверждённой ревизии","https://vbsauto.ru/wp-content/uploads/2025/10/TEBS_%D0%A2%D0%A1%D0%90.pdf"),
        CatalogModulePart("4801020640","vie-tebs-subsystem","ТСР · SUBSYSTEM; наличие CAN 24 не установлено по номеру","https://vbsauto.ru/wp-content/uploads/2025/10/TEBS_%D0%A2%D0%A1%D0%90.pdf"),
        CatalogModulePart("4801020640","zf-tebs-e","WABCO Premium с PEM · отдельно сверить марку","https://www.wabco-customercentre.com/catalog/en_GB/4801020640"),
        CatalogModulePart("АДЮИ.453633.005","ekran-ebp","ЭБП · АБС-П","https://b24truck.ru/files/catalog/%D0%90%D0%B2%D1%82%D0%BE%D0%BA%D0%BE%D0%BC%D0%BF%D0%BE%D0%BD%D0%B5%D0%BD%D1%82%D1%8B/ekran.pdf"),
        CatalogModulePart("АДЮИ.453633.024","ekran-ebpv","ЭБП-В · включая 4S/4M","https://b24truck.ru/files/catalog/%D0%90%D0%B2%D1%82%D0%BE%D0%BA%D0%BE%D0%BC%D0%BF%D0%BE%D0%BD%D0%B5%D0%BD%D1%82%D1%8B/ekran.pdf"),
        CatalogModulePart("35503100090","sorl-trailer-abs","TABS+RSS 4S/2M · отдельная конфигурация","https://sorl.ru/categories/upravlenie-tormoznoy-sistemoy"),
        CatalogModulePart("35682030050","sorl-research","ЭБУ TEBS 2S/2M, 4S/2M · каталог дистрибьютора, OEM-проверка нужна","https://optipart.ru/product/sorl/35682030050/")
    )
    init {
        check(rows.map { it.number to it.targetId }.distinct().size==rows.size)
    }
    private fun normalized(input:String):String? {
        if(input.length>120) return null
        // Knorr base/type lookup only. Vxx/Nxx suffixes describe software/packaging;
        // a match does not validate that this particular suffix combination exists.
        val label=input.trim().uppercase(java.util.Locale.ROOT)
        if(Regex("K[0-9]{6}(V[0-9]{2}N[0-9]{2})?").matches(label))
            return label.take(7)
        if(Regex("ES[0-9]{4}").matches(label)) return label
        if(Regex("АДЮИ[. ]?453633[. ]?[0-9]{3}").matches(label)) {
            val digits=label.filter { it in '0'..'9' }
            return "АДЮИ."+digits.take(6)+"."+digits.takeLast(3)
        }
        if(input.any { it !in '0'..'9' && it!=' ' && it!='-' })return null
        return input.filter { it in '0'..'9' }.takeIf { it.length in 9..11 }
    }
    fun find(input:String):List<CatalogModulePart> {
        val number=normalized(input) ?: return emptyList()
        return rows.filter { it.number==number }
    }
    // Include existing Gen1 lookup instead of short-circuiting on its first match.
    fun targetIds(input:String):List<String> =
        (find(input).map { it.targetId } +
            if(HaldexEarlyReference.isListedPart(input)) listOf("haldex-eb1") else emptyList()).distinct()
    // Strict ASCII part DID hints: no trim, alias, type designation, numeric range,
    // guessed padding, or transliteration. Knorr suffixes are base-number hints only.
    fun partDidCandidates(ascii:String):List<String> {
        if(ascii.length>120)return emptyList()
        val numeric=Regex("[0-9]+(?:[ -][0-9]+)*").matches(ascii) &&
            ascii.count { it in '0'..'9' } in 9..11
        val knorr=Regex("K[0-9]{6}(V[0-9]{2}N[0-9]{2})?").matches(ascii)
        return if(numeric || knorr) targetIds(ascii) else emptyList()
    }
    val count get()=rows.size
}
