# TrackSOS Shop — catalog, fleet purchases and low-data mode

## Release lock (do not change)

- `settings.shop.enabled` stays **false** in production until the owner explicitly approves opening.
- The existing public text `shop.closedTitle` / `shop.closedText` remains unchanged; the disabled storefront cannot place an order.
- This feature can be built and deployed without enabling the shop. Do **not** switch it on during rollout or testing outside dedicated test databases.
- Order history remains readable when the storefront is closed.

## Customer experience

- Three navigation routes: part name/article/brand, visible categories, and (later, after license) VIN + assembly-level fitment.
- Every purchase may optionally link to a vehicle registered in the customer's Garage; only its owner or assigned driver may link it.
- Order line snapshots retain the part name/brand/article and the paid price; old orders remain readable even if the product is later hidden.
- From history, repeat the purchased line or open **verified** catalog cross-references.
- Do not label an analog **fits this VIN** based solely on a cross-reference. Current response carries `compatibilityConfirmed: false`.
- When the store is closed, the reorder/analogs controls are hidden; history remains visible.

## Data layers

1. **Packaged app/UI**: static shell and categories; optional **licensed** compact name+article packs can later be bundled into `web/public/` so APK builds include them. No supplier database has been bundled yet.
2. **IndexedDB (browser/WebView)**: text-only product index (ID, category, brand, article, name, search synonyms). Customer deliberately downloads up to 3,000 records per action, with cursor-resume and revision checks. Low-data mode does not silently fetch hundreds of thousands of records.
3. **Online API**: fresh prices, inventory, delivery lead times, checkout permissions, order status, VIN fitment validation and supplier orders. No stale cache checkout.
4. **Supplier adapter**: Autokontinent remains a planned server-side integration. API credentials and commercial price lists must never be shipped to WebView or browsers. Supplier permissions/data feed are pending.

## API contract

- `GET /api/shop?light=1` — settings + up to eight featured kits, no unbounded product list.
- `GET /api/shop/search?q=...&category=...&page=...&limit=24` — 24 items by default, max 48, live prices; disabled shop returns no items.
- `GET /api/shop/selection?ids=id,id` — up to 50 active cart products; fresh prices.
- `GET /api/shop/index/manifest` — catalog revision, count and enable state.
- `GET /api/shop/index/page?after=UUID&limit=750` — max 1000 **text-only** rows [id, category, brand, article, name, synonyms], cursor by UUID, no prices or private fields.
- `GET /api/shop/index/changes?after=SEQ&limit=750` — increments only; rows [sequence, id, category, brand, article, name, synonyms], or [sequence, id] to delete obsolete articles. A bounded sequence cursor and server revision prevent missed changes during sync.
- `GET /api/shop/history?vehicleId=UUID&page=0` — 20 orders per page, owner/driver scope preserved.
- `GET /api/shop/products/:id/analogs` — only admin-verified analog links; no VIN applicability claim.
- `POST /api/admin/shop/products/:id/analogs` — admin curates a linked in-catalog analog and cites evidence; links remain hidden until verified.

The old `GET /api/shop` and `GET /api/shop/orders` endpoints are retained for older APK versions.

## Internal Autokontinent procurement mapping (not a live integration)

- Admins can assign a preferred supplier article and supplier brand to a TrackSOS product, with a source note and evidence-verified flag.
- Stored separately in `shop_supplier_refs`. Values are never joined into `GET /api/shop`, search results, local article index, customer orders or Android static assets.
- `GET/PUT/DELETE /api/admin/shop/products/:id/supplier` and `GET /api/admin/shop/supplier/status` require the administrator role.
- The status always reports `connected: false`, `liveOffers: false` and `automaticOrders: false` until an authorized, tested provider integration is implemented. Saving a supplier SKU does not activate purchases.
- Real API parameters, credentials, rate limits and allowed data usage must be sourced from the official supplier agreement. Never guess endpoints or store secrets in app bundles or GitHub.

## Bulk reference import (no prices, no auto-publishing)

- The admin-only `Справочник` tab accepts UTF-8 CSV/TSV exported from authorized heavy-truck or trailer catalog data. Columns: `бренд;артикул;название;категория;синонимы` (English headers are accepted too). Column `категория` can be a TrackSOS key or the exact Russian label.
- Import is explicitly gated by a recorded data-source note and the administrator's rights confirmation. This is **not** a substitute for the actual licensing agreement; import only data the business is entitled to use.
- First use `Проверить перед загрузкой`. No data is changed during dry-run. Then `Загрузить на проверку` sends at most 150 records per request, up to 200 accepted by the server. Each request is atomic. Repeated imports use a normalized brand/article key and do not duplicate rows. Changing source/metadata revokes prior review.
- Imported records reside in `shop_catalog_entries`, **not** `shop_products`. They have **no price, stock or order button**. Newly staged rows default to `reviewed=false`, and must be checked manually before eventual display.
- Customer `GET /api/shop/catalog/search` returns only reviewed references and only when `settings.shop.enabled=true`. It never exposes importer source notes or supplier SKUs. Closed storefront still displays its original unchanged text.
- All new mutations require admin permissions; dry-run checks, duplicate/invalid-category rejection, changes invalidating review and inability to purchase a reference are tested.
- This staging index is currently online-only. A future iteration can merge approved reference metadata into versioned offline index packs once adequate source rights and bounded mobile cache sizes are established.

**Template (demonstration codes, not genuine part numbers):**

```csv
бренд;артикул;название;категория;синонимы
TEST-BPW;DEMO-001;Тестовая ступица прицепа;trailer_axles;ось ступица
TEST-WABCO;DEMO-002;Тестовый датчик ABS;trailer_ebs;датчик тормоза
```

## Offline cache of reviewed reference-only articles

- After the storefront is deliberately opened, the customer can opt to save both priced products and **approved reference-only articles** to local IndexedDB.
- Reviewed references have their **own** database and versioned delta feed. The app syncs at most two 500-row reference batches per tap (1,000 rows max), on top of the bounded product-name index. It resumes interrupted snapshots and applies deletions with atomic metadata checkpoints.
- `GET /api/shop/catalog/index/manifest`, `/page`, `/changes` are guarded by the existing shop enable flag. They never expose unreviewed entries, source/licensing notes, supplier numbers, prices, VINs, or customer/order information.
- Importing or editing an unreviewed reference never sends it to a customer. Approving generates an add/update event; revoking review or editing an already-approved reference generates a deletion event, so the phone discards obsolete records on the next sync.
- Offline references are **informational only**: no price, no stock, no guaranteed fitment and no offline checkout. The UI shows this distinction.
- The catalog is not silently preloaded: the user explicitly chooses to save the text index, protecting low-bandwidth connections. The code contains no commercial or unlicensed part-number dataset.

## Next data steps

- Obtain a licensed cross-reference and VIN-fitment source covering heavy trucks, trailers, axle brands and brake systems. Vehicle VIN alone may not identify replacement axles, engines and brakes.
- Validate Autokontinent credentials/API terms, update cadence and reserve/checkout behavior. Add supplier SKU to catalog mapping only after permission.
- Import legally licensed external catalog data in **small, versioned category/manufacturer packs**; measure network payload sizes and APK growth before bundling. Updates use a database change journal and tombstones, not full downloads. 
- A text-only index can grow large; keep it separate from the APK until licensed data and mobile-size measurements justify shipping a specific bounded starter pack.
- Group browsing by heavy truck systems, trailer components and universal roadside parts, preserving all old category keys.
- The supplier SKU mapping and actual Autokontinent sync still require documented API access, terms and credentials. Never expose them in the mobile bundle.
- Add safe offline search indexes for million-row catalogs instead of scanning IDB cursors; current IDB cursor scan bounds memory but is intended for modest initial catalogs.
- Test older Android APK compatibility, poor mobile connections, migrations on existing databases, photo placeholders and every click before release.
